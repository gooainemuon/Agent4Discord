import {
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { EffortLevel } from '@anthropic-ai/claude-agent-sdk';
import { requireSessionChannel } from './sessionChannel.js';
import { updateSessionEffortInGuild } from '../sessions/sessionStore.js';

export const EFFORT_LEVELS: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/**
 * Handle `/a4d effort <level>` -- change the reasoning effort for the current session only.
 * Applied as a flag-layer setting, so settings.json and other sessions are untouched.
 */
export async function handleEffort(interaction: ChatInputCommandInteraction): Promise<void> {
  const ctx = await requireSessionChannel(interaction, { liveOnly: true });
  if (!ctx) return;
  const { guild, channel, session } = ctx;

  const level = interaction.options.getString('level', true) as EffortLevel;
  if (!EFFORT_LEVELS.includes(level)) {
    await interaction.reply({ content: `Unknown effort level: ${level}`, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply(); // the SDK call may take longer than Discord's 3 s ack window
  try {
    await session.query.applyFlagSettings({ effortLevel: level });
  } catch (err) {
    console.error('[effort] Failed to set effort:', err);
    await interaction.editReply({ content: `Failed to change effort: ${err}` });
    return;
  }

  session.effort = level;
  try {
    updateSessionEffortInGuild(guild.id, channel.id, level);
  } catch (err) {
    console.warn('[effort] Failed to persist effort:', err);
  }

  // Not ephemeral: the change stays visible in the channel history.
  await interaction.editReply({ content: `Effort changed to **${level}** for this session (from the next turn).` });
}
