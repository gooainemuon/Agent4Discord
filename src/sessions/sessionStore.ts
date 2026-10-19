// Persist session metadata to guild config -- AGE-016
import type { EffortLevel, PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import type { ThreadMode } from '../config.js';
import {
  loadGuildConfig,
  saveGuildConfig,
  type SessionEntry,
} from '../guild.js';

export function saveSessionToGuild(
  guildId: string,
  channelId: string,
  sessionId: string,
  cwd: string,
  userId: string,
  effort?: EffortLevel,
  permissionMode?: PermissionMode,
  sessionName?: string,
  threadMode?: ThreadMode,
): void {
  const config = loadGuildConfig(guildId);
  if (!config) {
    throw new Error(`Guild config not found for guild ${guildId}`);
  }

  config.activeSessions[channelId] = {
    sessionId,
    cwd,
    createdAt: new Date().toISOString(),
    userId,
    ...(effort && { effort }),
    ...(permissionMode && permissionMode !== 'default' && { permissionMode }),
    ...(sessionName && { sessionName }),
    ...(threadMode && { threadMode }),
  };

  saveGuildConfig(config);
}

/** Record the real session id once the SDK reports it (new sessions and forks start without one). */
export function updateSessionIdInGuild(guildId: string, channelId: string, sessionId: string): void {
  const config = loadGuildConfig(guildId);
  const entry = config?.activeSessions[channelId];
  if (!config || !entry || entry.sessionId === sessionId) return;
  entry.sessionId = sessionId;
  saveGuildConfig(config);
}

/** Remember a channel's effort so a resume after a restart starts with it again. */
export function updateSessionEffortInGuild(guildId: string, channelId: string, effort: EffortLevel): void {
  const config = loadGuildConfig(guildId);
  const entry = config?.activeSessions[channelId];
  if (!config || !entry || entry.effort === effort) return;
  entry.effort = effort;
  saveGuildConfig(config);
}

/** Remember a channel's permission mode so a resume starts with it again. */
export function updateSessionPermissionInGuild(guildId: string, channelId: string, mode: PermissionMode): void {
  const config = loadGuildConfig(guildId);
  const entry = config?.activeSessions[channelId];
  if (!config || !entry || entry.permissionMode === mode) return;
  entry.permissionMode = mode;
  saveGuildConfig(config);
}

/** Remember the lane name of a channel so a resume after a restart does not run the start procedure again. */
export function updateSessionNameInGuild(guildId: string, channelId: string, sessionName: string): void {
  const config = loadGuildConfig(guildId);
  const entry = config?.activeSessions[channelId];
  if (!config || !entry || entry.sessionName === sessionName) return;
  entry.sessionName = sessionName;
  saveGuildConfig(config);
}

/** Remember a channel's tool-thread mode so a resume keeps it. */
export function updateSessionThreadModeInGuild(guildId: string, channelId: string, threadMode: ThreadMode): void {
  const config = loadGuildConfig(guildId);
  const entry = config?.activeSessions[channelId];
  if (!config || !entry || entry.threadMode === threadMode) return;
  entry.threadMode = threadMode;
  saveGuildConfig(config);
}

/** Remember where /a4d handoff puts handoff folders for sessions in `cwd`. */
export function rememberHandoffRoot(guildId: string, cwd: string, root: string): void {
  const config = loadGuildConfig(guildId);
  if (!config) return;
  if (config.handoffRoots?.[cwd] === root) return;
  config.handoffRoots = { ...config.handoffRoots, [cwd]: root };
  saveGuildConfig(config);
}

/** The remembered handoff root for `cwd`, as a list (empty when none was ever given). */
export function knownHandoffRoots(guildId: string, cwd: string): string[] {
  const root = loadGuildConfig(guildId)?.handoffRoots?.[cwd];
  return root ? [root] : [];
}

export function removeSessionFromGuild(
  guildId: string,
  channelId: string,
): void {
  const config = loadGuildConfig(guildId);
  if (!config) return;

  delete config.activeSessions[channelId];
  saveGuildConfig(config);
}

export function getSessionsForGuild(
  guildId: string,
): Record<string, SessionEntry> {
  const config = loadGuildConfig(guildId);
  if (!config) return {};
  return config.activeSessions;
}
