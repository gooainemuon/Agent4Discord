// Bot process control through a dedicated tmux server (`tmux -L a4d`).
import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns/promises';
import { spawnSync } from 'node:child_process';
import {
  BOT_ENTRY,
  BOT_STATE_PATH,
  CTL_DIR,
  NODE,
  REPO_DIR,
  TMUX_SESSION,
  TMUX_SOCKET,
  botEnv,
} from './settings.mjs';

const EXTRA_BIN_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];

export function findBinary(name) {
  const dirs = [...(process.env.PATH ?? '').split(path.delimiter), ...EXTRA_BIN_DIRS];
  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

function tmuxBin() {
  const bin = findBinary('tmux');
  if (!bin) {
    throw new Error(
      process.platform === 'darwin'
        ? 'tmux가 없어요. `brew install tmux`로 설치하세요.'
        : 'tmux가 없어요. `sudo apt install tmux`로 설치하세요.',
    );
  }
  return bin;
}

export function tmux(args, opts = {}) {
  return spawnSync(tmuxBin(), ['-L', TMUX_SOCKET, ...args], { encoding: 'utf-8', ...opts });
}

/** { pid, dead, exitStatus } of the bot pane, or null when the tmux session doesn't exist. */
export function paneInfo() {
  let res;
  try {
    res = tmux(['list-panes', '-t', TMUX_SESSION, '-F', '#{pane_pid} #{pane_dead} #{pane_dead_status}']);
  } catch {
    return null;
  }
  if (res.status !== 0 || !res.stdout.trim()) return null;
  const [pid, dead, exitStatus] = res.stdout.trim().split('\n')[0].split(' ');
  return { pid: Number(pid), dead: dead === '1', exitStatus: exitStatus ? Number(exitStatus) : null };
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The running bot's pid, or null. */
export function botPid() {
  const pane = paneInfo();
  if (!pane || pane.dead || !pidAlive(pane.pid)) return null;
  return pane.pid;
}

/** State the bot writes about itself (start time, pending scheduled shutdown). */
export function botState(pid) {
  try {
    const state = JSON.parse(fs.readFileSync(BOT_STATE_PATH, 'utf-8'));
    return state.pid === pid ? state : null;
  } catch {
    return null;
  }
}

/** Start the bot inside a detached tmux session. Replaces a leftover session (e.g. a crashed pane). */
export function launchInTmux(settings) {
  if (!fs.existsSync(BOT_ENTRY)) {
    throw new Error(`빌드 결과물이 없어요: ${BOT_ENTRY}\n  먼저 \`npm run build\`를 실행하세요.`);
  }
  if (paneInfo()) tmux(['kill-session', '-t', TMUX_SESSION]);

  const envArgs = Object.entries(botEnv(settings)).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  const res = tmux([
    '-f', path.join(CTL_DIR, 'tmux.conf'),
    'new-session', '-d', '-s', TMUX_SESSION, '-c', REPO_DIR, ...envArgs,
    NODE, BOT_ENTRY,
  ]);
  if (res.status !== 0) throw new Error(`tmux 세션을 만들지 못했어요: ${res.stderr.trim()}`);
}

export function killTmuxSession() {
  try {
    if (paneInfo()) tmux(['kill-session', '-t', TMUX_SESSION]);
  } catch {
    // tmux missing → nothing to kill
  }
}

export function signalBot(signal) {
  const pid = botPid();
  if (!pid) return false;
  process.kill(pid, signal);
  return true;
}

export async function waitForExit(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!botPid()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return !botPid();
}

/** Ask the bot to shut down now (it notifies Discord first), force-kill if it hangs. */
export async function stopBotProcess() {
  if (!signalBot('SIGTERM')) return false;
  if (!(await waitForExit(25_000))) {
    const pid = botPid();
    if (pid) process.kill(pid, 'SIGKILL');
    await waitForExit(5_000);
  }
  return true;
}

/** Wait until discord.com resolves (network is up after login/wake). */
export async function waitForNetwork(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await dns.lookup('discord.com');
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }
  return false;
}
