import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_DAYS } from './schedule.mjs';

export const CONFIG_DIR = path.join(os.homedir(), '.agent4discord');
export const CTL_CONFIG_PATH = path.join(CONFIG_DIR, 'ctl.json');
export const BOT_STATE_PATH = path.join(CONFIG_DIR, 'bot-state.json');
export const LOG_PATH = path.join(CONFIG_DIR, 'ctl.log');

export const CTL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CTL_SCRIPT = path.join(CTL_DIR, 'a4d-ctl.mjs');
export const REPO_DIR = path.resolve(CTL_DIR, '..', '..');
export const BOT_ENTRY = path.join(REPO_DIR, 'dist', 'cli.js');
export const TRAY_SCRIPT = path.join(REPO_DIR, 'tools', 'tray', 'a4d_tray.py');
export const TRAY_LIB = path.join(CONFIG_DIR, 'tray-lib');
export const NODE = process.execPath;

export const TMUX_SOCKET = 'a4d';
export const TMUX_SESSION = 'a4d';

const DEFAULTS = {
  autostart: false,
  schedule: { enabled: false, start: '09:00', stop: '18:00', days: ALL_DAYS },
  missedThresholdMinutes: 5,
  stopNoticeMinutes: 10,
  maxIdleWaitMinutes: 30,
  extendMinutes: 60,
  keepAwake: true,
  env: {},
};

export function loadSettings() {
  let obj = {};
  try {
    obj = JSON.parse(fs.readFileSync(CTL_CONFIG_PATH, 'utf-8'));
  } catch {
    // defaults
  }
  return { ...DEFAULTS, ...obj, schedule: { ...DEFAULTS.schedule, ...(obj.schedule ?? {}) } };
}

export function saveSettings(settings) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CTL_CONFIG_PATH, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}

/** Environment the bot and scheduled jobs should run with (captured at install time). */
export function botEnv(settings) {
  return {
    PATH: settings.env.PATH || process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
    ...(settings.env.LANG ? { LANG: settings.env.LANG } : {}),
  };
}

export function log(message) {
  const line = `${new Date().toISOString()} ${message}\n`;
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.appendFileSync(LOG_PATH, line);
  } catch {
    // ignore
  }
}
