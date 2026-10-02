// Re-attach a channel to its Claude session: shared by /a4d resume and auto-resume at startup.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Client, Message, TextChannel } from 'discord.js';
import { sessionManager } from './sessionManager.js';
import { getSessionsForGuild, saveSessionToGuild } from './sessionStore.js';
import { buildStatusEmbed, COLORS } from '../formatters/embedBuilder.js';
import { createPermissionCallback } from '../interactions/permissionHandler.js';

export type RestoreResult =
  | { ok: true; sessionId: string; cwd: string; effort?: string }
  | { ok: false; reason: string };

async function findStatusMessage(channel: TextChannel, botId: string | undefined): Promise<Message | null> {
  const isStatus = (m: Message) =>
    m.author.id === botId && m.embeds.length > 0 && m.embeds[0].fields.some((f) => f.name === 'Session ID');
  const pinned = await channel.messages.fetchPins();
  const fromPins = pinned.items.find((p) => isStatus(p.message))?.message;
  if (fromPins) return fromPins;
  const recent = await channel.messages.fetch({ limit: 50 });
  return recent.find(isStatus) ?? null;
}

/**
 * Resume the Claude session recorded for `channel`. Reads directory, model and session id from the
 * status embed, falling back to the id stored for this channel. Never picks "the newest session in
 * the directory", and refuses a session another channel already runs.
 */
/** Channels with a restore in flight: auto-resume and /a4d resume must not both attach one. */
const restoring = new Set<string>();

export async function restoreChannelSession(
  channel: TextChannel,
  guildId: string,
  userId: string,
  client: Client,
): Promise<RestoreResult> {
  if (restoring.has(channel.id)) return { ok: false, reason: 'This channel is already being resumed.' };
  restoring.add(channel.id);
  try {
    return await restoreUnlocked(channel, guildId, userId, client);
  } finally {
    restoring.delete(channel.id);
  }
}

async function restoreUnlocked(
  channel: TextChannel,
  guildId: string,
  userId: string,
  client: Client,
): Promise<RestoreResult> {
  const statusMsg = await findStatusMessage(channel, client.user?.id);
  if (!statusMsg) return { ok: false, reason: 'No session status embed found in this channel.' };

  const embed = statusMsg.embeds[0];
  const rawCwd = embed.fields.find((f) => f.name === 'Directory')?.value;
  if (!rawCwd) return { ok: false, reason: 'Could not find directory info in the status embed.' };
  const cwd = rawCwd.startsWith('~') ? path.join(os.homedir(), rawCwd.slice(1)) : rawCwd;
  const model = embed.fields.find((f) => f.name === 'Model')?.value || 'opus';

  const stored = getSessionsForGuild(guildId)[channel.id];
  let sessionId: string | undefined = embed.fields.find((f) => f.name === 'Session ID')?.value;
  if (!sessionId || sessionId === 'pending') {
    sessionId = stored?.sessionId || undefined;
  }
  if (!sessionId || sessionId === 'pending') {
    return { ok: false, reason: 'No session id recorded for this channel. Start a new session instead.' };
  }

  // Checked after the awaits above and with no await before resumeSession, so nothing can slip in.
  const live = sessionManager.getSession(channel.id);
  // Stop and Archive delete the stored entry, so fall back to the stopped session still in memory.
  const effort = stored?.effort ?? live?.effort;
  const permissionMode = stored?.permissionMode ?? live?.permissionMode;
  if (live && live.state !== 'stopped' && live.state !== 'archived') {
    return { ok: false, reason: 'This session is already active.' };
  }
  if (!sessionManager.claimSessionId(sessionId, channel.id)) {
    const holder = sessionManager.findActiveBySessionId(sessionId, channel.id);
    return {
      ok: false,
      reason: holder
        ? `This session is already open in <#${holder.channelId}>. Close it there first, or use \`/a4d fork\` there to branch it.`
        : 'This session is being opened in another channel right now.',
    };
  }
  sessionManager.releaseSessionId(sessionId); // resumeSession below registers it synchronously

  const session = sessionManager.resumeSession(
    guildId,
    userId,
    channel.id,
    sessionId,
    cwd,
    model,
    createPermissionCallback(channel, userId),
    client,
    permissionMode,
    false, // forkSession
    effort,
  );
  saveSessionToGuild(guildId, channel.id, sessionId, cwd, userId, effort, permissionMode);

  // Best-effort: the session is already running, so a failed edit must not report a failed resume.
  await statusMsg
    .edit({
      embeds: [
        buildStatusEmbed({
          status: 'Session Active',
          color: COLORS.IDLE,
          cwd: rawCwd,
          model,
          sessionId,
          costUsd: session.totalCostUsd,
          startedAt: new Date().toISOString(),
          permissionMode,
        }),
      ],
    })
    .catch((err) => console.warn('[restore] Failed to update status embed:', err));

  return { ok: true, sessionId, cwd, effort };
}

/**
 * Project file whose text is sent to a session right after an automatic resume. A restart ends the
 * session's background watches (e.g. an inbox Monitor); the project says here how to set them up again.
 */
export const RESUME_PROMPT_FILE = path.join('.claude', 'a4d-on-resume.md');

/** The resume instructions of the project at `cwd`, or null when it has none. */
export function readResumePrompt(cwd: string): string | null {
  try {
    return fs.readFileSync(path.join(cwd, RESUME_PROMPT_FILE), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/**
 * After a bot restart, resume every session channel that was active, one at a time.
 * Each channel gets a one-line notice of the outcome, and the project's resume instructions if it has any.
 */
export async function autoResumeSessions(
  client: Client,
  guilds: { guildId: string; sessionsCategoryId: string; entries: Record<string, { userId: string }> }[],
): Promise<void> {
  for (const { guildId, sessionsCategoryId, entries } of guilds) {
    for (const [channelId, entry] of Object.entries(entries)) {
      // Re-read: while earlier channels were being resumed the user may have closed or stopped this one.
      if (!getSessionsForGuild(guildId)[channelId]) continue;
      const existing = sessionManager.getSession(channelId);
      if (existing && existing.state !== 'stopped' && existing.state !== 'archived') continue;
      let channel: TextChannel | null = null;
      try {
        channel = (await client.channels.fetch(channelId)) as TextChannel | null;
      } catch {
        channel = null; // deleted channel
      }
      if (!channel || channel.parentId !== sessionsCategoryId) continue;
      try {
        const result = await restoreChannelSession(channel, guildId, entry.userId, client);
        console.log(`[auto-resume] ${channelId}: ${result.ok ? `resumed ${result.sessionId}` : result.reason}`);
        const prompt = result.ok ? readResumePrompt(result.cwd) : null;
        await channel.send(
          result.ok
            ? `🔄 봇이 다시 켜져서 이 세션을 자동으로 이어받았습니다(effort: ${result.effort ?? 'settings.json'}). ` +
              (prompt ? `\`${RESUME_PROMPT_FILE}\` 의 재개 지시를 보냈습니다.` : '하던 일이 있으면 이어서 시켜 주세요.')
            : `⚠️ 자동 복구를 건너뛰었습니다: ${result.reason}`,
        );
        if (prompt) {
          try {
            sessionManager.sendMessage(
              channelId,
              `[A4D auto-resume] The bot restarted and resumed this session. This message comes from the bot, ` +
                `not from the user. Instructions from ${RESUME_PROMPT_FILE}:\n\n${prompt}`,
            );
          } catch (err) {
            console.error(`[auto-resume] ${channelId}: failed to send the resume instructions:`, err);
            await channel.send(`⚠️ \`${RESUME_PROMPT_FILE}\` 의 재개 지시를 보내지 못했습니다.`).catch(() => {});
          }
        }
      } catch (err) {
        console.error(`[auto-resume] ${channelId} failed:`, err);
        await channel.send('⚠️ 자동 복구에 실패했습니다. `/a4d resume` 으로 다시 시도하세요.').catch(() => {});
      }
    }
  }
}
