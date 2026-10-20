import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { sessionManager } from '../sessions/sessionManager.js';
import { requireSessionChannel } from './sessionChannel.js';
import { saveSessionToGuild } from '../sessions/sessionStore.js';
import { findStatusMessage } from '../sessions/restore.js';
import { stopTyping } from '../sessions/eventHandler.js';
import { createPermissionCallback } from '../interactions/permissionHandler.js';
import { buildStatusEmbed, COLORS } from '../formatters/embedBuilder.js';
import { displayPath } from '../interactions/directoryBrowser.js';
import { loadConfig } from '../config.js';
import { endTurn } from '../sessions/toolThreads.js';

/**
 * Handle `/a4d clear` -- drop the conversation and start a fresh Claude session in this channel:
 * same directory, model, permission mode and effort, new session id, no session name. The old
 * session is stopped; `/a4d resume` cannot bring it back here, so hand off first if it matters.
 */
export async function handleClear(interaction: ChatInputCommandInteraction): Promise<void> {
  const ctx = await requireSessionChannel(interaction);
  if (!ctx) return;
  const { guild, channel, session } = ctx;

  const wasLive = session.state !== 'stopped' && session.state !== 'archived';
  if (!wasLive) {
    const maxSessions = loadConfig().maxSessionsPerUser;
    if (sessionManager.liveSessionCount(session.userId, guild.id) >= maxSessions) {
      await interaction.reply({
        content: `You already have ${maxSessions} active sessions. Close one before starting a new one.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  await interaction.deferReply();

  const statusMsg = await findStatusMessage(channel, interaction.client.user?.id).catch(() => null);
  const rawCwd = statusMsg?.embeds[0]?.fields.find((f) => f.name === 'Directory')?.value ?? displayPath(session.cwd);
  const model = statusMsg?.embeds[0]?.fields.find((f) => f.name === 'Model')?.value || 'opus';
  const previousName = session.sessionName;

  if (wasLive) sessionManager.stopSession(channel.id);
  stopTyping(channel.id);
  endTurn(channel.id);

  const fresh = sessionManager.createSession(
    guild.id,
    session.userId,
    channel.id,
    session.cwd,
    model,
    createPermissionCallback(channel, session.userId),
    interaction.client,
    session.permissionMode,
    session.effort,
  );
  fresh.threadMode = session.threadMode;
  fresh.inboxWatch = session.inboxWatch; // the watch starts again once the fresh session is named
  // The new id arrives with the init message and is persisted then. No session name: the next
  // "너는 <세션명>" message runs the start procedure.
  saveSessionToGuild(guild.id, channel.id, '', session.cwd, session.userId, session.effort, session.permissionMode, undefined, session.threadMode);

  if (statusMsg) {
    await statusMsg
      .edit({
        embeds: [
          buildStatusEmbed({
            status: 'Session Active',
            color: COLORS.IDLE,
            cwd: rawCwd,
            model,
            sessionId: fresh.sessionId || 'pending',
            costUsd: 0,
            startedAt: fresh.createdAt,
            permissionMode: session.permissionMode,
          }),
        ],
      })
      .catch((err) => console.warn('[clear] Failed to update status embed:', err));
  }

  await interaction.editReply({
    content:
      `🧹 대화 컨텍스트를 비우고 새 세션을 시작했습니다 (\`${rawCwd}\`, ${model}).` +
      (previousName ? ` 이전 세션명: **${previousName}**.` : '') +
      ` \`너는 <세션명>\` 으로 시작하면 그 이름의 최신 인계 폴더를 읽고 이어갑니다.`,
  });
}
