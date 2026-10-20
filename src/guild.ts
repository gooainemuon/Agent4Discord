import * as fs from 'node:fs';
import * as path from 'node:path';
import type { EffortLevel, PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import { CONFIG_DIR, type ThreadMode } from './config.js';

export interface GuildConfig {
  guildId: string;
  generalCategoryId: string;
  sessionsCategoryId: string;
  archiveCategoryId: string;
  generalChannelId: string;
  sessionChannelId: string;
  usageChannelId?: string;
  usageMessageId?: string;
  initializedAt: string;
  initializedBy: string;
  activeSessions: Record<string, SessionEntry>;
  /** Where /a4d handoff puts handoff folders, per session directory. Absent = the directory itself. */
  handoffRoots?: Record<string, string>;
}

export interface SessionEntry {
  sessionId: string;
  cwd: string;
  createdAt: string;
  userId: string;
  /** Effort picked at start or with /a4d effort; reapplied on resume. Absent = settings.json. */
  effort?: EffortLevel;
  /** Permission mode picked at start or with /a4d permission; reapplied on resume. */
  permissionMode?: PermissionMode;
  /** Lane name set with "너는 <세션명>"; kept across resume so the start procedure runs only once. */
  sessionName?: string;
  /** Tool-thread mode picked with /a4d threads; absent = config.json default. */
  threadMode?: ThreadMode;
  /** false after /a4d inbox off; absent = the bot watches the lane inbox. Kept across /a4d clear. */
  inboxWatch?: false;
  /** How far the lane's inbox has been passed on to the session; a resume picks up from here. */
  inboxCursor?: InboxCursor;
}

export interface InboxCursor {
  /** The inbox folder the cursor belongs to. */
  dir: string;
  /** Epoch ms up to which matching files have been passed on; newer ones count as new after a restart. */
  since: number;
}

const GUILDS_DIR = path.join(CONFIG_DIR, 'guilds');

function guildPath(guildId: string): string {
  return path.join(GUILDS_DIR, `${guildId}.json`);
}

export function loadGuildConfig(guildId: string): GuildConfig | null {
  const filePath = guildPath(guildId);
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as GuildConfig;
}

export function saveGuildConfig(config: GuildConfig): void {
  if (!fs.existsSync(GUILDS_DIR)) {
    fs.mkdirSync(GUILDS_DIR, { recursive: true });
  }

  const data = JSON.stringify(config, null, 2) + '\n';
  const target = guildPath(config.guildId);
  const tmp = target + '.tmp';

  // Atomic write: write to temp file, then rename
  fs.writeFileSync(tmp, data, { encoding: 'utf-8' });
  fs.renameSync(tmp, target);
}

export function updateGuildConfig(
  guildId: string,
  partial: Partial<Omit<GuildConfig, 'guildId'>>,
): GuildConfig | null {
  const config = loadGuildConfig(guildId);
  if (!config) return null;

  const updated = { ...config, ...partial, guildId: config.guildId };
  saveGuildConfig(updated);
  return updated;
}

export function deleteGuildSession(guildId: string, channelId: string): void {
  const config = loadGuildConfig(guildId);
  if (!config) return;

  delete config.activeSessions[channelId];
  saveGuildConfig(config);
}
