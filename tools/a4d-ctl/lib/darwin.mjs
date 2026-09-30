// macOS backend: launchd LaunchAgents, caffeinate, osascript notifications.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { CTL_SCRIPT, LOG_PATH, NODE, TRAY_LIB, TRAY_SCRIPT, botEnv } from './settings.mjs';
import { botPid, findBinary, killTmuxSession, launchInTmux } from './bot.mjs';
import { stopDays } from './schedule.mjs';

const AGENTS_DIR = path.join(os.homedir(), 'Library', 'LaunchAgents');
const LABELS = {
  autostart: 'com.agent4discord.autostart',
  scheduleStart: 'com.agent4discord.schedule-start',
  scheduleStop: 'com.agent4discord.schedule-stop',
  tray: 'com.agent4discord.tray',
};
const DOMAIN = `gui/${process.getuid?.() ?? 501}`;

const plistPath = (label) => path.join(AGENTS_DIR, `${label}.plist`);

function xml(value, indent = '  ') {
  if (Array.isArray(value)) {
    return `<array>\n${value.map((v) => `${indent}  ${xml(v, indent + '  ')}`).join('\n')}\n${indent}</array>`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value)
      .map(([k, v]) => `${indent}  <key>${esc(k)}</key>\n${indent}  ${xml(v, indent + '  ')}`)
      .join('\n');
    return `<dict>\n${entries}\n${indent}</dict>`;
  }
  if (typeof value === 'boolean') return value ? '<true/>' : '<false/>';
  if (typeof value === 'number') return `<integer>${value}</integer>`;
  return `<string>${esc(String(value))}</string>`;
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function writePlist(label, body) {
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
${xml({ Label: label, StandardOutPath: LOG_PATH, StandardErrorPath: LOG_PATH, ...body }, '')}
</plist>
`;
  fs.mkdirSync(AGENTS_DIR, { recursive: true });
  fs.writeFileSync(plistPath(label), content);
}

function launchctl(...args) {
  return spawnSync('launchctl', args, { encoding: 'utf-8' });
}

function reload(label) {
  launchctl('bootout', `${DOMAIN}/${label}`);
  const res = launchctl('bootstrap', DOMAIN, plistPath(label));
  if (res.status !== 0) throw new Error(`launchctl bootstrap 실패 (${label}): ${res.stderr.trim()}`);
}

function unload(label) {
  launchctl('bootout', `${DOMAIN}/${label}`);
  fs.rmSync(plistPath(label), { force: true });
}

export function installBase() {
  // Nothing to install: the bot runs directly under tmux.
}

export function start(settings) {
  launchInTmux(settings);
  const pid = botPid();
  if (pid && settings.keepAwake) {
    // Keep the Mac from idle-sleeping while the bot runs; exits with the bot.
    spawn('caffeinate', ['-i', '-w', String(pid)], { detached: true, stdio: 'ignore' }).unref();
  }
}

export function afterStop() {
  killTmuxSession();
}

export function setAutostart(settings, on) {
  if (!on) {
    unload(LABELS.autostart);
    return;
  }
  // Written but not bootstrapped: RunAtLoad would start the bot right now.
  // launchd loads it at the next login.
  writePlist(LABELS.autostart, {
    ProgramArguments: [NODE, CTL_SCRIPT, 'start', '--reason', 'autostart'],
    EnvironmentVariables: botEnv(settings),
    RunAtLoad: true,
    AbandonProcessGroup: true,
  });
}

export function isAutostartEnabled() {
  return fs.existsSync(plistPath(LABELS.autostart));
}

function calendar(days, time) {
  const [Hour, Minute] = time.split(':').map(Number);
  return days.map((Weekday) => ({ Hour, Minute, Weekday }));
}

export function applySchedule(settings) {
  const s = settings.schedule;
  for (const [label, kind, days, time] of [
    [LABELS.scheduleStart, 'start', s.days, s.start],
    [LABELS.scheduleStop, 'stop', stopDays(s), s.stop],
  ]) {
    if (!s.enabled) {
      unload(label);
      continue;
    }
    writePlist(label, {
      ProgramArguments: [NODE, CTL_SCRIPT, `scheduled-${kind}`],
      EnvironmentVariables: botEnv(settings),
      StartCalendarInterval: calendar(days, time),
      AbandonProcessGroup: true,
    });
    reload(label);
  }
}

export function uninstall() {
  for (const label of [LABELS.autostart, LABELS.scheduleStart, LABELS.scheduleStop]) unload(label);
  removeTray();
}

// --- Tray ---------------------------------------------------------------

export function trayPrerequisites() {
  return null;
}

export function trayCommand() {
  return [findBinary('python3') ?? 'python3', TRAY_SCRIPT, '--node', NODE, '--ctl', CTL_SCRIPT];
}

export function installTray(settings) {
  writePlist(LABELS.tray, {
    ProgramArguments: trayCommand(),
    EnvironmentVariables: { ...botEnv(settings), PYTHONPATH: TRAY_LIB },
    RunAtLoad: true,
    ProcessType: 'Interactive',
  });
}

export function startTray() {
  reload(LABELS.tray);
}

export function removeTray() {
  unload(LABELS.tray);
}

// --- Desktop integration ------------------------------------------------

function osascript(script, timeoutMs = 10_000) {
  return spawnSync('osascript', ['-e', script], { encoding: 'utf-8', timeout: timeoutMs });
}

function asString(s) {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function openTerminal() {
  osascript(`tell application "Terminal"
  activate
  do script ${asString(`'${NODE}' '${CTL_SCRIPT}' attach`)}
end tell`);
}

export function notify(title, body) {
  osascript(`display notification ${asString(body)} with title ${asString(title)}`);
}

/** Show a dialog with buttons; returns the chosen action key or null (timed out). */
export function ask(title, body, actions, timeoutMs) {
  const entries = Object.entries(actions);
  const buttons = entries.map(([, label]) => asString(label)).join(', ');
  const res = osascript(
    `display dialog ${asString(body)} with title ${asString(title)} buttons {${buttons}} ` +
      `default button 1 giving up after ${Math.floor(timeoutMs / 1000)}`,
    timeoutMs + 5_000,
  );
  const match = /button returned:([^,]*)/.exec(res.stdout ?? '');
  const label = match?.[1]?.trim();
  return entries.find(([, l]) => l === label)?.[0] ?? null;
}
