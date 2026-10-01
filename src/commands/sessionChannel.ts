import { MessageFlags, type ChatInputCommandInteraction, type Guild, type TextChannel } from 'discord.js';
import { loadGuildConfig, type GuildConfig } from '../guild.js';
import { sessionManager, type ActiveSession } from '../sessions/sessionManager.js';

export interface SessionChannelContext {
  guild: Guild;
  guildConfig: GuildConfig;
  channel: TextChannel;
  session: ActiveSession;
}

/**
 * The checks every per-session slash command starts with: in a server, A4D set up, inside
 * "A4D - Sessions", and a session in this channel. Replies (ephemeral) and returns null on failure.
 * `liveOnly` also rejects a stopped or archived session.
 */
export async function requireSessionChannel(
  interaction: ChatInputCommandInteraction,
  { liveOnly = false }: { liveOnly?: boolean } = {},
): Promise<SessionChannelContext | null> {
  const fail = async (content: string) => {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    return null;
  };

  const guild = interaction.guild;
  if (!guild) return fail('This command can only be used in a server.');

  const guildConfig = loadGuildConfig(guild.id);
  if (!guildConfig) return fail('A4D is not set up. Run `/a4d init` first.');

  const channel = interaction.channel as TextChannel;
  if (channel.parentId !== guildConfig.sessionsCategoryId) {
    return fail('This command can only be used in a session channel under "A4D - Sessions".');
  }

  const session = sessionManager.getSession(channel.id);
  if (!session || (liveOnly && (session.state === 'stopped' || session.state === 'archived'))) {
    return fail('No active session in this channel.');
  }

  return { guild, guildConfig, channel, session };
}
