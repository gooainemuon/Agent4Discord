// Linux backend: systemd --user units, XDG autostart for the tray, notify-send.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { CTL_SCRIPT, NODE, REPO_DIR, TRAY_LIB, TRAY_SCRIPT, botEnv } from './settings.mjs';
import { botPid, findBinary } from './bot.mjs';
import { stopDays } from './schedule.mjs';

const UNIT_DIR = path.join(os.homedir(), '.config', 'systemd', 'user');
const AUTOSTART_DIR = path.join(os.homedir(), '.config', 'autostart');
const TRAY_DESKTOP = path.join(AUTOSTART_DIR, 'agent4discord-tray.desktop');
const BOT_UNIT = 'a4d-bot.service';
const SYSTEMD_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function systemctl(...args) {
  const res = spawnSync('systemctl', ['--user', ...args], { encoding: 'utf-8' });
  return { ok: res.status === 0, out: (res.stdout ?? '').trim(), err: (res.stderr ?? '').trim() };
}

function q(arg) {
  return /[\s"\\]/.test(arg) ? `"${arg.replace(/(["\\])/g, '\\$1')}"` : arg;
}

function ctlCommand(...args) {
  return [NODE, CTL_SCRIPT, ...args].map(q).join(' ');
}

/** Write a file only when its content changed. Returns true if written. */
function writeIfChanged(file, content) {
  try {
    if (fs.readFileSync(file, 'utf-8') === content) return false;
  } catch {
    // new file
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return true;
}

function environmentLines(settings) {
  return Object.entries(botEnv(settings))
    .map(([k, v]) => `Environment=${q(`${k}=${v}`)}`)
    .join('\n');
}

export function installBase(settings) {
  const unit = `[Unit]
Description=Agent4Discord bot (tmux -L a4d)

[Service]
Type=forking
WorkingDirectory=${REPO_DIR}
${environmentLines(settings)}
ExecStartPre=${ctlCommand('_wait-network')}
ExecStart=${ctlCommand('_launch')}
ExecStop=${ctlCommand('_signal-stop')}
TimeoutStartSec=150
TimeoutStopSec=60

[Install]
WantedBy=default.target
`;
  if (writeIfChanged(path.join(UNIT_DIR, BOT_UNIT), unit)) systemctl('daemon-reload');
}

export function start(settings) {
  installBase(settings);
  // A crashed bot leaves the unit active (its tmux pane is kept for inspection).
  if (systemctl('is-active', BOT_UNIT).ok && !botPid()) systemctl('stop', BOT_UNIT);
  const res = systemctl('start', BOT_UNIT);
  if (!res.ok) throw new Error(`봇 서비스를 시작하지 못했어요: ${res.err}\n  journalctl --user -u ${BOT_UNIT}`);
}

export function afterStop() {
  systemctl('stop', BOT_UNIT);
}

export function setAutostart(settings, on) {
  installBase(settings);
  const res = systemctl(on ? 'enable' : 'disable', BOT_UNIT);
  if (!res.ok) throw new Error(res.err);
}

export function isAutostartEnabled() {
  return systemctl('is-enabled', BOT_UNIT).out === 'enabled';
}

function onCalendar(days, time) {
  const prefix = days.length === 7 ? '' : days.map((d) => SYSTEMD_DAYS[d]).join(',') + ' ';
  return `${prefix}*-*-* ${time}:00`;
}

export function applySchedule(settings) {
  const s = settings.schedule;
  let changed = false;
  for (const kind of ['start', 'stop']) {
    const name = `a4d-schedule-${kind}`;
    const days = kind === 'start' ? s.days : stopDays(s);
    const time = kind === 'start' ? s.start : s.stop;
    changed = writeIfChanged(
      path.join(UNIT_DIR, `${name}.service`),
      `[Unit]
Description=Agent4Discord scheduled ${kind}

[Service]
Type=oneshot
${environmentLines(settings)}
ExecStart=${ctlCommand(`scheduled-${kind}`)}
TimeoutStartSec=45min
`,
    ) || changed;
    changed = writeIfChanged(
      path.join(UNIT_DIR, `${name}.timer`),
      `[Unit]
Description=Agent4Discord scheduled ${kind} (${time})

[Timer]
OnCalendar=${onCalendar(days, time)}
Persistent=true

[Install]
WantedBy=timers.target
`,
    ) || changed;
  }
  if (changed) systemctl('daemon-reload');

  for (const kind of ['start', 'stop']) {
    const timer = `a4d-schedule-${kind}.timer`;
    if (s.enabled) {
      systemctl('enable', timer);
      systemctl('restart', timer); // pick up new OnCalendar
    } else {
      systemctl('disable', '--now', timer);
    }
  }
}

export function uninstall() {
  systemctl('disable', '--now', 'a4d-schedule-start.timer', 'a4d-schedule-stop.timer');
  systemctl('disable', BOT_UNIT);
  for (const f of [
    BOT_UNIT,
    'a4d-schedule-start.service',
    'a4d-schedule-start.timer',
    'a4d-schedule-stop.service',
    'a4d-schedule-stop.timer',
  ]) {
    fs.rmSync(path.join(UNIT_DIR, f), { force: true });
  }
  systemctl('daemon-reload');
  removeTray();
}

// --- Tray ---------------------------------------------------------------

export function trayPrerequisites() {
  const res = spawnSync(
    'python3',
    ['-c', "import gi; gi.require_version('AyatanaAppIndicator3', '0.1')"],
    { encoding: 'utf-8' },
  );
  if (res.status !== 0) {
    return '상단바 아이콘에 필요한 패키지가 없어요:\n  sudo apt install gir1.2-ayatanaappindicator3-0.1';
  }
  return null;
}

export function trayCommand() {
  return [findBinary('python3') ?? 'python3', TRAY_SCRIPT, '--node', NODE, '--ctl', CTL_SCRIPT];
}

export function installTray() {
  writeIfChanged(
    TRAY_DESKTOP,
    `[Desktop Entry]
Type=Application
Name=Agent4Discord Tray
Comment=Agent4Discord 봇 상단바 메뉴
Exec=env PYTHONPATH=${q(TRAY_LIB)} PYSTRAY_BACKEND=appindicator ${trayCommand().map(q).join(' ')}
X-GNOME-Autostart-enabled=true
NoDisplay=true
`,
  );
}

export function startTray() {
  const [cmd, ...args] = trayCommand();
  spawn(cmd, args, { detached: true, stdio: 'ignore', env: { ...process.env, PYTHONPATH: TRAY_LIB, PYSTRAY_BACKEND: 'appindicator' } }).unref();
}

export function removeTray() {
  fs.rmSync(TRAY_DESKTOP, { force: true });
  spawnSync('pkill', ['-f', TRAY_SCRIPT]);
}

// --- Desktop integration ------------------------------------------------

export function openTerminal() {
  const attach = [NODE, CTL_SCRIPT, 'attach'];
  for (const [bin, args] of [
    ['gnome-terminal', ['--title=Agent4Discord', '--', ...attach]],
    ['ptyxis', ['--', ...attach]],
    ['kgx', ['--', ...attach]],
    ['konsole', ['-e', ...attach]],
    ['xterm', ['-T', 'Agent4Discord', '-e', ...attach]],
  ]) {
    if (findBinary(bin)) {
      spawn(bin, args, { detached: true, stdio: 'ignore' }).unref();
      return;
    }
  }
  throw new Error('터미널 프로그램을 찾지 못했어요. 직접 `a4d-ctl attach`를 실행하세요.');
}

export function notify(title, body) {
  spawnSync('notify-send', ['-a', 'Agent4Discord', title, body], { timeout: 10_000 });
}

/** Show a notification with buttons; returns the chosen action key or null. */
export function ask(title, body, actions, timeoutMs) {
  const args = ['-a', 'Agent4Discord', '-u', 'critical', '--wait'];
  for (const [key, label] of Object.entries(actions)) args.push(`--action=${key}=${label}`);
  const res = spawnSync('notify-send', [...args, title, body], { encoding: 'utf-8', timeout: timeoutMs });
  const choice = (res.stdout ?? '').trim();
  return choice in actions ? choice : null;
}
