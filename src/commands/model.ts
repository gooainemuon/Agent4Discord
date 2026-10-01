import {
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { requireSessionChannel } from './sessionChannel.js';
import { buildStatusEmbed, COLORS } from '../formatters/embedBuilder.js';

/**
 * Handle `/a4d model <model>` -- change the model for the current session.
 */
export async function handleModel(interaction: ChatInputCommandInteraction): Promise<void> {
  const ctx = await requireSessionChannel(interaction);
  if (!ctx) return;
  const { channel, session } = ctx;

  const model = interaction.options.getString('model', true);

  try {
    await session.query.setModel(model);
  } catch (err) {
    console.error('[model] Failed to set model:', err);
    await interaction.reply({ content: `Failed to change model: ${err}`, flags: MessageFlags.Ephemeral });
    return;
  }

  // Update the pinned status embed
  try {
    const pinned = await channel.messages.fetchPins();
    const statusMsg = pinned.items.find(
      (p) => p.message.author.id === interaction.client.user?.id && p.message.embeds.length > 0,
    )?.message;
    if (statusMsg) {
      const embed = statusMsg.embeds[0];
      const updatedEmbed = buildStatusEmbed({
        status: 'Session Active',
        color: COLORS.IDLE,
        cwd: embed.fields.find((f) => f.name === 'Directory')?.value ?? session.cwd,
        model,
        sessionId: session.sessionId || 'pending',
        costUsd: session.totalCostUsd,
        startedAt: session.createdAt,
      });
      await statusMsg.edit({ embeds: [updatedEmbed] });
    }
  } catch {
    // Status embed update is best-effort
  }

  await interaction.reply({ content: `Model changed to **${model}**.`, flags: MessageFlags.Ephemeral });
}
