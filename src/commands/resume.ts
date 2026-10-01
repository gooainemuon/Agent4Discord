import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type TextChannel,
} from 'discord.js';
import { sessionManager } from '../sessions/sessionManager.js';
import { loadGuildConfig } from '../guild.js';
import { restoreChannelSession } from '../sessions/restore.js';

/**
 * Handle `/a4d resume` -- resume a stopped/archived session in the current channel.
 * The lookup and the duplicate check live in restoreChannelSession.
 */
export async function handleResume(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
    return;
  }

  const guildConfig = loadGuildConfig(guild.id);
  if (!guildConfig) {
    await interaction.reply({ content: 'A4D is not set up. Run `/a4d init` first.', flags: MessageFlags.Ephemeral });
    return;
  }

  // Check if this channel is under the Sessions or Archive category
  const channel = interaction.channel as TextChannel;
  const isInSessions = channel.parentId === guildConfig.sessionsCategoryId;
  const isInArchive = channel.parentId === guildConfig.archiveCategoryId;

  if (!isInSessions && !isInArchive) {
    await interaction.reply({
      content: 'This command can only be used in a session channel under "A4D - Sessions" or "A4D - Archive".',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Check if there's already an active session in this channel
  const existing = sessionManager.getSession(channel.id);
  if (existing && existing.state !== 'stopped' && existing.state !== 'archived') {
    await interaction.reply({ content: 'This session is already active.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    // If channel was archived, move it back to Sessions category (inherits writable permissions)
    if (isInArchive) {
      await channel.setParent(guildConfig.sessionsCategoryId, {
        reason: 'A4D session resumed from archive',
        lockPermissions: true,
      }).catch((err) => {
        console.error('[resume] Failed to move channel to Sessions category:', err);
      });
    }

    const result = await restoreChannelSession(channel, guild.id, interaction.user.id, interaction.client);
    if (!result.ok) {
      await interaction.editReply({ content: result.reason });
      return;
    }

    await interaction.editReply({ content: 'Session resumed! You can start chatting again.' });

    // Auto-delete after 60 seconds
    setTimeout(async () => {
      try { await interaction.deleteReply(); } catch { /* already deleted */ }
    }, 60_000);
  } catch (err) {
    console.error('[resume] Failed to resume session:', err);
    await interaction.editReply({ content: 'Failed to resume session. Check the bot console for details.' });
  }
}
