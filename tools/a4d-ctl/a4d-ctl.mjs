#!/usr/bin/env node
// a4d-ctl — run the Agent4Discord bot in tmux, with autostart and scheduled on/off.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  CTL_SCRIPT,
  NODE,
  REPO_DIR,
  TMUX_SESSION,
  TMUX_SOCKET,
  TRAY_LIB,
  botEnv,
  loadSettings,
  log,
  saveSettings,
} from './lib/settings.mjs';
import {
  botPid,
  botState,
  launchInTmux,
  paneInfo,
  signalBot,
  stopBotProcess,
  tmux,
  waitForNetwork,
} from './lib/bot.mjs';
import { decide, describeDays, nextOccurrence, parseDays, parseTime, stopDays } from './lib/schedule.mjs';

const platform =
  process.platform === 'darwin'
    ? await import('./lib/darwin.mjs')
    : process.platform === 'linux'
      ? await import('./lib/linux.mjs')
      : null;
if (!platform) {
  console.error('a4d-ctl은 Linux와 macOS만 지원해요.');
  process.exit(1);
}

const TITLE = 'Agent4Discord';
const WRAPPER = path.join(os.homedir(), '.local', 'bin', 'a4d-ctl');

function fmtTime(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDuration(ms) {
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h}시간 ${min % 60}분` : `${Math.floor(h / 24)}일 ${h % 24}시간`;
}

// --- Commands -------------------------------------------------------------

async function cmdStart(reason = 'manual') {
  if (botPid()) {
    console.log('봇이 이미 실행 중이에요.');
    return;
  }
  const settings = loadSettings();
  if (reason === 'autostart' && !(await waitForNetwork())) log('network wait timed out, starting anyway');
  platform.start(settings);
  for (let i = 0; i < 20 && !botPid(); i++) await new Promise((r) => setTimeout(r, 250));
  const pid = botPid();
  if (!pid) throw new Error(`봇이 바로 종료됐어요. \`a4d-ctl attach\`로 오류를 확인하세요.`);
  log(`started (${reason}) pid=${pid}`);
  console.log(`봇을 시작했어요 (PID ${pid}). 터미널 보기: a4d-ctl attach`);
}

async function cmdStop() {
  const wasRunning = await stopBotProcess();
  platform.afterStop();
  log(`stopped (manual) wasRunning=${wasRunning}`);
  console.log(wasRunning ? '봇을 종료했어요.' : '봇이 실행 중이 아니에요.');
}

function statusData() {
  const settings = loadSettings();
  const pid = botPid();
  const state = pid ? botState(pid) : null;
  const pane = paneInfo();
  const now = new Date();
  const s = settings.schedule;
  return {
    running: Boolean(pid),
    pid,
    startedAt: state?.startedAt ?? null,
    pendingShutdown: state?.pendingShutdown ?? null,
    crashed: Boolean(pane?.dead),
    autostart: platform.isAutostartEnabled(),
    schedule: {
      ...s,
      daysLabel: describeDays(s.days),
      nextStart: s.enabled ? nextOccurrence(now, s.start, s.days)?.toISOString() ?? null : null,
      nextStop: s.enabled ? nextOccurrence(now, s.stop, stopDays(s))?.toISOString() ?? null : null,
    },
    platform: process.platform,
  };
}

function cmdStatus(json) {
  const st = statusData();
  if (json) {
    console.log(JSON.stringify(st));
    return;
  }
  if (st.running) {
    const up = st.startedAt ? `, ${fmtDuration(Date.now() - Date.parse(st.startedAt))}째` : '';
    console.log(`봇:      ● 실행 중 (PID ${st.pid}${up})`);
  } else {
    console.log(`봇:      ○ 중지됨${st.crashed ? ' — 비정상 종료됨, `a4d-ctl attach`로 오류 확인' : ''}`);
  }
  if (st.pendingShutdown) {
    const label = st.pendingShutdown.phase === 'extended' ? '연장됨' : '종료 안내 중';
    console.log(`종료 예정: ${fmtTime(new Date(st.pendingShutdown.at))} (${label})`);
  }
  console.log(`자동 실행: ${st.autostart ? '켜짐' : '꺼짐'}`);
  const s = st.schedule;
  if (s.enabled) {
    console.log(`예약:    켜짐 — ${s.daysLabel} ${s.start} ~ ${s.stop}`);
    console.log(`         다음 켜기 ${fmtTime(new Date(s.nextStart))}, 다음 끄기 ${fmtTime(new Date(s.nextStop))}`);
  } else {
    console.log(`예약:    꺼짐 (${s.daysLabel} ${s.start} ~ ${s.stop})`);
  }
  console.log(`터미널:  a4d-ctl attach  (tmux -L ${TMUX_SOCKET} attach -t ${TMUX_SESSION})`);
}

function cmdAttach() {
  if (!paneInfo()) {
    console.log('봇이 실행 중이 아니에요. `a4d-ctl start`로 시작하세요.');
    return;
  }
  const env = { ...process.env };
  delete env.TMUX; // allow attaching from inside another tmux
  const res = tmux(['attach', '-t', TMUX_SESSION], { stdio: 'inherit', env });
  process.exitCode = res.status ?? 0;
}

function cmdAutostart(arg) {
  if (arg !== 'on' && arg !== 'off') throw new Error('사용법: a4d-ctl autostart on|off');
  const settings = loadSettings();
  settings.autostart = arg === 'on';
  platform.setAutostart(settings, settings.autostart);
  saveSettings(settings);
  console.log(`로그인 시 자동 실행: ${settings.autostart ? '켜짐' : '꺼짐'}`);
}

function cmdSchedule(sub, args) {
  const settings = loadSettings();
  const s = settings.schedule;
  if (sub === 'set') {
    const [start, stop, days] = args;
    if (!start || !stop) throw new Error('사용법: a4d-ctl schedule set HH:MM HH:MM [all|weekdays|weekends|mon,wed,fri]');
    parseTime(start);
    parseTime(stop);
    if (start === stop) throw new Error('켜는 시간과 끄는 시간이 같아요.');
    s.start = start;
    s.stop = stop;
    if (days) s.days = parseDays(days);
    s.enabled = true;
  } else if (sub === 'on' || sub === 'off') {
    s.enabled = sub === 'on';
  } else if (sub && sub !== 'show') {
    throw new Error('사용법: a4d-ctl schedule show|on|off|set HH:MM HH:MM [days]');
  }
  if (sub && sub !== 'show') {
    platform.applySchedule(settings);
    saveSettings(settings);
  }
  console.log(`예약: ${s.enabled ? '켜짐' : '꺼짐'} — ${describeDays(s.days)} ${s.start} ~ ${s.stop}`);
}

/** Fired by the start timer. Late (missed) starts only run while still inside the window. */
async function cmdScheduledStart() {
  const settings = loadSettings();
  if (!settings.schedule.enabled) return;
  const { action, expected } = decide('start', new Date(), settings.schedule, settings.missedThresholdMinutes);
  log(`scheduled-start: ${action} (expected ${expected?.toISOString()})`);
  if (action === 'skip' || botPid()) return;

  await waitForNetwork();
  platform.start(settings);
  log(`started (schedule) pid=${botPid()}`);
  if (action === 'start-late') {
    platform.notify(TITLE, `예약 시간(${settings.schedule.start})을 놓쳐서 지금 봇을 켰어요.`);
  }
}

/** Fired by the stop timer. A missed stop never shuts down on its own — it asks. */
async function cmdScheduledStop() {
  const settings = loadSettings();
  if (!settings.schedule.enabled || !botPid()) return;
  const { action, expected } = decide('stop', new Date(), settings.schedule, settings.missedThresholdMinutes);
  log(`scheduled-stop: ${action} (expected ${expected?.toISOString()})`);

  if (action === 'stop') {
    signalBot('SIGUSR2'); // bot posts a notice, waits, then exits on its own
    return;
  }

  const choice = platform.ask(
    TITLE,
    `종료 예약(${settings.schedule.stop})을 놓쳐서 봇을 끄지 않았어요. 지금 끌까요?`,
    { keep: '계속 켜두기', stop: '지금 끄기' },
    30 * 60_000,
  );
  log(`scheduled-stop: missed, user chose ${choice}`);
  if (choice === 'stop') {
    await stopBotProcess();
    platform.afterStop();
  }
}

function cmdStopScheduled() {
  if (!signalBot('SIGUSR2')) return console.log('봇이 실행 중이 아니에요.');
  console.log('예약 종료 절차를 시작했어요 (디스코드에 안내 후 종료).');
}

function cmdCancelStop() {
  if (!signalBot('SIGUSR1')) return console.log('봇이 실행 중이 아니에요.');
  console.log('예약 종료를 취소했어요.');
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (res.status !== 0) throw new Error(`실패: ${cmd} ${args.join(' ')}`);
}

function cmdTrayInstall(settings) {
  const missing = platform.trayPrerequisites();
  if (missing) {
    console.log(`⚠ 트레이 설치를 건너뛰었어요. ${missing}\n  설치 후 \`a4d-ctl tray install\`을 다시 실행하세요.`);
    return;
  }
  const requirements = path.join(REPO_DIR, 'tools', 'tray', 'requirements.txt');
  run(platform.trayCommand()[0], ['-m', 'pip', 'install', '-q', '--upgrade', '--target', TRAY_LIB, '-r', requirements]);
  platform.removeTray(); // stop a running tray before (re)starting it
  platform.installTray(settings);
  platform.startTray();
  console.log('상단바 아이콘을 설치하고 실행했어요 (로그인할 때 자동으로 뜹니다).');
}

function cmdInstall(flags) {
  const settings = loadSettings();
  settings.env = { PATH: process.env.PATH ?? '', ...(process.env.LANG ? { LANG: process.env.LANG } : {}) };
  saveSettings(settings);

  console.log('빌드 중… (npm run build)');
  run('npm', ['run', '-s', 'build'], { cwd: REPO_DIR, env: { ...process.env, ...botEnv(settings) } });

  fs.mkdirSync(path.dirname(WRAPPER), { recursive: true });
  fs.writeFileSync(WRAPPER, `#!/bin/sh\nexec '${NODE}' '${CTL_SCRIPT}' "$@"\n`, { mode: 0o755 });
  console.log(`명령어 설치: ${WRAPPER}`);

  platform.installBase(settings);
  platform.setAutostart(settings, settings.autostart);
  platform.applySchedule(settings);
  if (!flags.includes('--no-tray')) cmdTrayInstall(settings);

  if (!(process.env.PATH ?? '').split(path.delimiter).includes(path.dirname(WRAPPER))) {
    console.log(`⚠ ${path.dirname(WRAPPER)}가 PATH에 없어요. 셸 설정에 추가하세요.`);
  }
  console.log('설치 완료. `a4d-ctl status`로 상태를 확인하세요.');
}

async function cmdUninstall() {
  await stopBotProcess();
  platform.afterStop();
  platform.uninstall();
  fs.rmSync(WRAPPER, { force: true });
  console.log('자동 실행, 예약, 트레이, a4d-ctl 명령을 제거했어요. (설정 파일 ~/.agent4discord/ctl.json은 남겨둡니다)');
}

const HELP = `사용법: a4d-ctl <명령>

  start                 봇을 tmux 세션에서 시작
  stop                  봇 종료 (디스코드 세션에 알린 뒤 종료)
  restart               재시작
  status [--json]       상태 보기
  attach                봇 터미널(tmux)에 접속 — 나가기: Ctrl-b d
  open-terminal         새 터미널 창에서 attach

  autostart on|off      로그인 시 자동 실행
  schedule show|on|off
  schedule set 09:00 18:00 [all|weekdays|weekends|mon,wed,fri]
  stop-scheduled        예약 종료 절차를 지금 시작 (안내 → 대기 → 종료)
  cancel-stop           진행 중인 예약 종료 취소

  install [--no-tray]   빌드, a4d-ctl 명령, 서비스와 상단바 아이콘 설치
  uninstall             모두 제거
  tray install          상단바 아이콘만 (재)설치`;

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case 'start': {
      const i = args.indexOf('--reason');
      return cmdStart(i >= 0 ? args[i + 1] : 'manual');
    }
    case 'stop': return cmdStop();
    case 'restart': await cmdStop(); return cmdStart('restart');
    case 'status': return cmdStatus(args.includes('--json'));
    case 'attach': return cmdAttach();
    case 'open-terminal': return platform.openTerminal();
    case 'autostart': return cmdAutostart(args[0]);
    case 'schedule': return cmdSchedule(args[0], args.slice(1));
    case 'scheduled-start': return cmdScheduledStart();
    case 'scheduled-stop': return cmdScheduledStop();
    case 'stop-scheduled': return cmdStopScheduled();
    case 'cancel-stop': return cmdCancelStop();
    case 'install': return cmdInstall(args);
    case 'uninstall': return cmdUninstall();
    case 'tray':
      if (args[0] === 'install') return cmdTrayInstall(loadSettings());
      throw new Error('사용법: a4d-ctl tray install');
    // Internal: used by the systemd unit.
    case '_launch': return launchInTmux(loadSettings());
    case '_wait-network': await waitForNetwork(); return;
    case '_signal-stop': await stopBotProcess(); return;
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP);
      return;
    default:
      throw new Error(`알 수 없는 명령: ${cmd}\n\n${HELP}`);
  }
}

try {
  await main();
} catch (err) {
  log(`error: ${err.message}`);
  console.error(`오류: ${err.message}`);
  process.exit(1);
}
