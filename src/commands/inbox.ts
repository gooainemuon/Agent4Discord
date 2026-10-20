import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { requireSessionChannel } from './sessionChannel.js';
import { updateSessionInboxWatchInGuild } from '../sessions/sessionStore.js';
import { INBOX_CONFIG_FILE, loadLaneRule, type LaneRule, type RosterRoute } from '../sessions/inboxConfig.js';
import { inboxWatchStatus, startInboxWatch, stopInboxWatch } from '../sessions/inboxWatch.js';

export const INBOX_ACTIONS = ['on', 'off', 'status'] as const;

/**
 * Handle `/a4d inbox [on|off|status]` -- the bot's watch of the project inbox for this lane. On by
 * default for a named session in a project with .claude/a4d-inbox.json; `on` also re-reads that file.
 * The switch is kept across resume and /a4d clear.
 */
export async function handleInbox(interaction: ChatInputCommandInteraction): Promise<void> {
  const ctx = await requireSessionChannel(interaction);
  if (!ctx) return;
  const { guild, channel, session } = ctx;
  const action = interaction.options.getString('action') ?? 'status';

  if (action === 'on' || action === 'off') {
    session.inboxWatch = action === 'on';
    try {
      updateSessionInboxWatchInGuild(guild.id, channel.id, session.inboxWatch);
    } catch (err) {
      console.warn('[inbox] Failed to persist the inbox switch:', err);
    }
    if (action === 'off') {
      stopInboxWatch(channel.id);
      await interaction.reply({ content: '📭 인박스 감시를 껐습니다. `/a4d inbox on` 으로 다시 켭니다.' });
      return;
    }
    const live = session.state !== 'stopped' && session.state !== 'archived';
    const watch = live ? startInboxWatch(session) : { ok: false as const, reason: '세션이 멈춰 있습니다(재개하면 시작합니다)' };
    await interaction.reply({
      content: watch.ok
        ? `📬 인박스 \`${watch.dir}\` 감시를 켰습니다 (\`${INBOX_CONFIG_FILE}\` 를 다시 읽음). 이 레인 앞으로 새 파일이 오면 세션에 전달합니다.`
        : `감시를 켰지만 지금은 시작하지 못했습니다: ${watch.reason}.`,
    });
    return;
  }

  const status = inboxWatchStatus(channel.id);
  const lines = status
    ? [
        `📬 감시 중: \`${status.rule.dir}\` (레인 **${session.sessionName}**)`,
        ...(status.rule.roster ? [rosterLine(status.rule.roster)] : globLines(status.rule)),
        ...(status.waiting.length ? [`전달 대기: ${status.waiting.map((f) => `\`${f}\``).join(', ')}`] : []),
      ]
    : [
        session.inboxWatch === false
          ? '📭 감시 꺼짐 (`/a4d inbox on` 으로 켭니다).'
          : `📭 감시하고 있지 않습니다: ${startReason(session)}.`,
      ];
  await interaction.reply({ content: lines.join('\n').slice(0, 1900), flags: MessageFlags.Ephemeral });
}

function rosterLine({ lane, hub, names, everyone }: RosterRoute): string {
  const aliases = [...names].filter(([n, l]) => l === lane && n !== lane).map(([n]) => n);
  const known = aliases.length ? ` 파일명의 ${aliases.map((a) => `\`${a}\``).join(', ')} 도 이 레인입니다.` : '';
  return lane === hub
    ? `명부 기준: 총괄 레인이라 다른 레인이 보낸 파일을 모두 받습니다.${known}`
    : `명부 기준: 파일명에 이 레인이 받는이로 있거나 ${everyone.map((w) => `\`${w}\``).join(', ')} 가 있으면 받습니다.${known}`;
}

function globLines(rule: LaneRule): string[] {
  const list = (globs: string[]) => globs.map((g) => `\`${g}\``).join(', ');
  return [`include: ${list(rule.include)}`, ...(rule.exclude.length ? [`exclude: ${list(rule.exclude)}`] : [])];
}

/** Why there is no watch, without starting one. */
function startReason(session: { sessionName?: string; state: string; cwd: string }): string {
  if (!session.sessionName) return '세션명이 없습니다(`너는 <세션명>` 으로 시작하면 감시합니다)';
  if (session.state === 'stopped' || session.state === 'archived') return '세션이 멈춰 있습니다(재개하면 시작합니다)';
  const loaded = loadLaneRule(session.cwd, session.sessionName);
  return loaded.ok
    ? '규칙은 있지만 감시가 시작되지 않았습니다(`/a4d inbox on` 으로 다시 시작)'
    : `${loaded.reason}. 고친 뒤 \`/a4d inbox on\``;
}
