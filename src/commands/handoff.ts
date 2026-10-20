import fs from 'node:fs';
import path from 'node:path';
import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { sessionManager } from '../sessions/sessionManager.js';
import { requireSessionChannel } from './sessionChannel.js';
import { startTyping } from '../sessions/eventHandler.js';
import { rememberHandoffRoot, updateSessionNameInGuild } from '../sessions/sessionStore.js';
import {
  buildHandoffPrompt,
  findLatestHandoff,
  handoffFolderName,
  handoffRootsFor,
  isValidSessionName,
  resolveHandoffRoot,
  usesHandoffNotes,
} from '../sessions/handoff.js';
import { displayPath } from '../interactions/directoryBrowser.js';
import { startInboxWatch } from '../sessions/inboxWatch.js';

/**
 * Handle `/a4d handoff [dir] [name]` -- ask the session to hand over to the next session of its lane.
 * In a note root (the project's .planning/handoff/) it writes a new `<root>/YYYY-MM-DD-hhmm-<세션명>.md`;
 * elsewhere the bot makes `<root>/YYYY-MM-DD-hhmm-<세션명>/` for its 인계 노트, 인박스 and 작업 로그.
 * `dir` (default: .planning/handoff/ if the project has one, else the session directory) is remembered
 * for this directory; `name` sets the session name when the session has none.
 */
export async function handleHandoff(interaction: ChatInputCommandInteraction): Promise<void> {
  const ctx = await requireSessionChannel(interaction, { liveOnly: true });
  if (!ctx) return;
  const { guild, channel, session } = ctx;

  const nameOpt = interaction.options.getString('name')?.trim();
  if (nameOpt && !isValidSessionName(nameOpt)) {
    await interaction.reply({
      content: '세션명은 글자/숫자로 시작하고 글자, 숫자, `.`, `_`, `-` 만 쓸 수 있습니다 (60자 이내).',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const name = nameOpt ?? session.sessionName;
  if (!name) {
    await interaction.reply({
      content: '이 세션에는 세션명이 없습니다. `name` 옵션을 주거나, 세션을 `너는 <세션명>` 으로 시작하세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const dirOpt = interaction.options.getString('dir')?.trim();
  const root = dirOpt ? resolveHandoffRoot(dirOpt, session.cwd) : handoffRootsFor(guild.id, session.cwd)[0];
  const kind = usesHandoffNotes(root, session.cwd) ? 'note' : 'folder';
  const target = path.join(root, handoffFolderName(name) + (kind === 'note' ? '.md' : ''));

  await interaction.deferReply();
  if (kind === 'note' && fs.existsSync(target)) {
    // Notes are never edited once written; a second handoff in the same minute must wait.
    await interaction.editReply({ content: `이미 같은 이름의 인계 노트가 있습니다: \`${displayPath(target)}\`. 1분 뒤에 다시 실행하세요.` });
    return;
  }
  try {
    fs.mkdirSync(kind === 'note' ? root : target, { recursive: true });
  } catch (err) {
    console.error('[handoff] Failed to create handoff folder:', err);
    await interaction.editReply({ content: `인계 폴더를 만들지 못했습니다: \`${displayPath(kind === 'note' ? root : target)}\`` });
    return;
  }

  // Persist what the user told us before the session starts writing.
  if (nameOpt && session.sessionName !== nameOpt) {
    session.sessionName = nameOpt;
    try { updateSessionNameInGuild(guild.id, channel.id, nameOpt); } catch (err) { console.error('[handoff] Failed to persist session name:', err); }
    startInboxWatch(session); // the lane's inbox rule follows the name
  }
  if (dirOpt) {
    try { rememberHandoffRoot(guild.id, session.cwd, root); } catch (err) { console.error('[handoff] Failed to persist handoff root:', err); }
  }

  const previous = findLatestHandoff(handoffRootsFor(guild.id, session.cwd), name, target);

  try {
    startTyping(channel);
    sessionManager.sendMessage(channel.id, buildHandoffPrompt(name, target, previous, kind));
  } catch (err) {
    console.error('[handoff] Failed to send the handoff request:', err);
    await interaction.editReply({ content: '세션에 인계 요청을 보내지 못했습니다. 세션이 살아 있는지 확인하세요.' });
    return;
  }

  await interaction.editReply({
    content:
      `📝 **${name}** 인계 요청을 보냈습니다. ${kind === 'note' ? '인계 노트' : '폴더'}: \`${displayPath(target)}\`` +
      (previous ? ` (이전: \`${displayPath(previous.path)}\`)` : '') +
      `\nClaude 가 ${kind === 'note' ? '인계 노트를' : '인계 노트·인박스·작업 로그를'} 쓰고 나면 \`/a4d clear\` 로 컨텍스트를 비운 뒤 \`너는 ${name}\` 으로 이어가세요.`,
  });
}
