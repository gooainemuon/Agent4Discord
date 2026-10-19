import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { isThreadMode } from '../config.js';
import { requireSessionChannel } from './sessionChannel.js';
import { updateSessionThreadModeInGuild } from '../sessions/sessionStore.js';
import { endTurn } from '../sessions/toolThreads.js';

const DESCRIPTIONS = {
  turn: '턴마다 스레드 하나(🔧 앵커 메시지에 붙음). 인박스 폴링은 비공개 🔁 polling 스레드로.',
  each: '도구 호출마다 스레드 하나. 인박스 폴링은 비공개 🔁 polling 스레드로.',
  off: '도구 호출을 표시하지 않음.',
} as const;

/** Handle `/a4d threads <mode>` -- change how this session's tool calls are shown (kept across resume). */
export async function handleThreads(interaction: ChatInputCommandInteraction): Promise<void> {
  const ctx = await requireSessionChannel(interaction);
  if (!ctx) return;
  const { guild, channel, session } = ctx;

  const mode = interaction.options.getString('mode', true);
  if (!isThreadMode(mode)) {
    await interaction.reply({ content: `Unknown thread mode: ${mode}`, flags: MessageFlags.Ephemeral });
    return;
  }

  session.threadMode = mode;
  endTurn(channel.id); // the next tool call starts under the new mode
  try {
    updateSessionThreadModeInGuild(guild.id, channel.id, mode);
  } catch (err) {
    console.warn('[threads] Failed to persist thread mode:', err);
  }

  // Not ephemeral: the change stays visible in the channel history.
  await interaction.reply({ content: `도구 스레드 모드를 **${mode}** 로 바꿨습니다. ${DESCRIPTIONS[mode]}` });
}
