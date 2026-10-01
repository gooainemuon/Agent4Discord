import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type TextChannel,
} from 'discord.js';
import type { EffortLevel } from '@anthropic-ai/claude-agent-sdk';
import { sessionManager } from '../sessions/sessionManager.js';
import { loadGuildConfig } from '../guild.js';
import { updateSessionEffortInGuild } from '../sessions/sessionStore.js';

export const EFFORT_LEVELS: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/**
 * Handle `/a4d effort <level>` -- change the reasoning effort for the current session only.
 * Applied as a flag-layer setting, so settings.json and other sessions are untouched.
 */
export async function handleEffort(interaction: ChatInputCommandInteraction): Promise<void> {
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

  const channel = interaction.channel as TextChannel;
  if (channel.parentId !== guildConfig.sessionsCategoryId) {
    await interaction.reply({
      content: 'This command can only be used in a session channel under "A4D - Sessions".',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const session = sessionManager.getSession(channel.id);
  if (!session) {
    await interaction.reply({ content: 'No active session in this channel.', flags: MessageFlags.Ephemeral });
    return;
  }

  const level = interaction.options.getString('level', true) as EffortLevel;
  if (!EFFORT_LEVELS.includes(level)) {
    await interaction.reply({ content: `Unknown effort level: ${level}`, flags: MessageFlags.Ephemeral });
    return;
  }

  try {
    await session.query.applyFlagSettings({ effortLevel: level });
  } catch (err) {
    console.error('[effort] Failed to set effort:', err);
    await interaction.reply({ content: `Failed to change effort: ${err}`, flags: MessageFlags.Ephemeral });
    return;
  }

  session.effort = level;
  try {
    updateSessionEffortInGuild(guild.id, channel.id, level);
  } catch (err) {
    console.warn('[effort] Failed to persist effort:', err);
  }

  // Not ephemeral: the change stays visible in the channel history.
  await interaction.reply({ content: `Effort changed to **${level}** for this session (from the next turn).` });
}
