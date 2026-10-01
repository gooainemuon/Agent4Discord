// Persist session metadata to guild config -- AGE-016
import type { EffortLevel, PermissionMode } from '@anthropic-ai/claude-agent-sdk';
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
