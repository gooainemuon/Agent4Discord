import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

/** Where tool calls are shown: one thread per turn, one per tool call, or not at all. */
export type ThreadMode = 'off' | 'turn' | 'each';
export const THREAD_MODES: readonly ThreadMode[] = ['off', 'turn', 'each'];
export const DEFAULT_THREAD_MODE: ThreadMode = 'turn';

export function isThreadMode(value: unknown): value is ThreadMode {
  return typeof value === 'string' && (THREAD_MODES as readonly string[]).includes(value);
}

export interface AppConfig {
  discordToken: string;
  discordClientId: string;
  claudeModel: string;
  permissionMode: string;
  logLevel: string;
  /** PATCH: Discord user IDs allowed to use the bot. Empty = nobody. */
  ownerIds: string[];
  /** Active sessions one user may run at once (start, resume, fork). */
  maxSessionsPerUser: number;
  /** Resume the session channels that were active when the bot starts again. */
  autoResumeSessions: boolean;
  /** Default tool-thread mode for new sessions; `/a4d threads` changes it per session. */
  toolThreadMode: ThreadMode;
}

export const CONFIG_DIR: string = path.join(os.homedir(), '.agent4discord');
export const CONFIG_PATH: string = path.join(CONFIG_DIR, 'config.json');
/**
 * How the bot behaves on every device, kept in the repository (one level above src/ and dist/).
 * config.json holds the device's own bot and may override any of it for that device.
 */
export const REPO_DEFAULTS_PATH: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'a4d.defaults.json');

/** The device's own bot: written by --setup, never taken from the shared defaults. */
export type DeviceConfig = Pick<AppConfig, 'discordToken' | 'discordClientId' | 'ownerIds'> & Partial<AppConfig>;
const DEVICE_KEYS = ['discordToken', 'discordClientId', 'ownerIds'];

function readSharedDefaults(file: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([k]) => !DEVICE_KEYS.includes(k)));
  } catch {
    return {}; // missing or broken: the built-in values
  }
}

const DEFAULTS: Partial<AppConfig> = {
  claudeModel: 'opus',
  permissionMode: 'default',
  logLevel: 'info',
  maxSessionsPerUser: 10,
  autoResumeSessions: true,
};

export function loadConfig(sharedDefaultsFile: string = REPO_DEFAULTS_PATH): AppConfig {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(
      `Config file not found at ${CONFIG_PATH}. Run "agent4discord --setup" first.`
    );
  }

  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  const parsed: unknown = JSON.parse(raw);

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Invalid config file: expected a JSON object.');
  }

  // built-in < shared (a4d.defaults.json) < this device's config.json
  const obj = { ...readSharedDefaults(sharedDefaultsFile), ...(parsed as Record<string, unknown>) };

  if (typeof obj['discordToken'] !== 'string' || obj['discordToken'].length === 0) {
    throw new Error('Config missing required field: discordToken');
  }

  if (typeof obj['discordClientId'] !== 'string' || obj['discordClientId'].length === 0) {
    throw new Error('Config missing required field: discordClientId');
  }

  return {
    discordToken: obj['discordToken'] as string,
    discordClientId: obj['discordClientId'] as string,
    claudeModel: (typeof obj['claudeModel'] === 'string' ? obj['claudeModel'] : DEFAULTS.claudeModel) as string,
    permissionMode: (typeof obj['permissionMode'] === 'string' ? obj['permissionMode'] : DEFAULTS.permissionMode) as string,
    logLevel: (typeof obj['logLevel'] === 'string' ? obj['logLevel'] : DEFAULTS.logLevel) as string,
    ownerIds: Array.isArray(obj['ownerIds']) ? (obj['ownerIds'] as unknown[]).filter((x): x is string => typeof x === 'string') : [],
    maxSessionsPerUser: Number.isInteger(obj['maxSessionsPerUser']) && (obj['maxSessionsPerUser'] as number) > 0
      ? (obj['maxSessionsPerUser'] as number)
      : (DEFAULTS.maxSessionsPerUser as number),
    autoResumeSessions: typeof obj['autoResumeSessions'] === 'boolean' ? obj['autoResumeSessions'] : true,
    toolThreadMode: isThreadMode(obj['toolThreadMode']) ? obj['toolThreadMode'] : DEFAULT_THREAD_MODE,
  };
}

/** Write this device's config.json. Behaviour left out here comes from the shared defaults. */
export function saveConfig(config: DeviceConfig): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  const data = JSON.stringify(config, null, 2) + '\n';
  fs.writeFileSync(CONFIG_PATH, data, { encoding: 'utf-8', mode: 0o600 });
  fs.chmodSync(CONFIG_PATH, 0o600); // PATCH: bot token must not be world-readable

  // Set restrictive permissions on non-Windows platforms
  if (process.platform !== 'win32') {
    fs.chmodSync(CONFIG_PATH, 0o600);
  }
}

export function configExists(): boolean {
  return fs.existsSync(CONFIG_PATH);
}
