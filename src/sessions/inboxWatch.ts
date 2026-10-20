// Lane inbox watch: the bot, not the Claude session, watches the project's inbox folder for new
// message files addressed to the lane (rules in .claude/a4d-inbox.json, see inboxConfig.ts). A watch
// the session runs itself (Monitor, background Bash loops) dies with every restart, /a4d clear and
// compaction and costs tokens; this one is restarted from the guild config.
//
// The folder is listed every few seconds. A new file that matches the lane's rule is passed on once
// its size has stopped changing and the session is idle: its path and first lines. Files the session
// wrote itself are skipped. After a restart, matching files changed since the last delivery count as
// new, so nothing written while the bot was down is lost.
import fs from 'node:fs';
import path from 'node:path';
import type { Client, TextChannel } from 'discord.js';
import type { SDKAssistantMessage } from '@anthropic-ai/claude-agent-sdk';
import { sessionManager, type ActiveSession } from './sessionManager.js';
import { INBOX_CONFIG_FILE, isForLane, loadLaneRule, type LaneRule } from './inboxConfig.js';
import { getSessionsForGuild, updateSessionInboxCursorInGuild } from './sessionStore.js';
import { startTyping } from './eventHandler.js';

export const POLL_MS = 3000;
/** Lines of each new file shown to the session; it reads the rest itself. */
const HEAD_LINES = 20;
const HEAD_CHARS = 1500;
const MAX_MESSAGE_CHARS = 6000;
/** Recent tool inputs kept per channel to recognise files the session wrote itself. */
const RECENT_INPUTS = 100;

interface Watch {
  channelId: string;
  guildId: string;
  name: string;
  rule: LaneRule;
  /** Every file name seen in the folder; only names not in here are new. */
  known: Set<string>;
  /** New matching files and their size at the last check, waiting for the writer to finish. */
  settling: Map<string, number>;
  /** Files ready to be passed on once the session is idle. */
  ready: string[];
  timer: ReturnType<typeof setInterval>;
}

export type StartResult = { ok: true; dir: string } | { ok: false; reason: string };

const watches = new Map<string, Watch>();
const recentInputs = new Map<string, string[]>();
let discord: Client | null = null;

function listMessages(dir: string): string[] | null {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch {
    return null;
  }
}

function stat(file: string): fs.Stats | null {
  try {
    return fs.statSync(file);
  } catch {
    return null;
  }
}

/** Remember that everything up to `at` has been passed on (only when nothing is still waiting). */
function persist(w: Watch, at: number): void {
  if (w.settling.size || w.ready.length) return;
  try {
    updateSessionInboxCursorInGuild(w.guildId, w.channelId, { dir: w.rule.dir, since: at });
  } catch (err) {
    console.warn('[inbox] Failed to persist the inbox cursor:', err);
  }
}

/**
 * Start (or restart, re-reading the project rules) the inbox watch of a named session. Does nothing
 * when the session has no name, the watch is off, or the project has no inbox rules.
 */
export function startInboxWatch(session: ActiveSession): StartResult {
  stopInboxWatch(session.channelId);
  if (session.inboxWatch === false) return { ok: false, reason: '감시가 꺼져 있습니다' };
  if (!session.sessionName) return { ok: false, reason: '세션명이 없습니다' };
  const loaded = loadLaneRule(session.cwd, session.sessionName);
  if (!loaded.ok) return loaded;
  const { rule } = loaded;
  const names = listMessages(rule.dir);
  if (!names) return { ok: false, reason: `인박스 폴더가 없습니다: ${rule.dir}` };

  const now = Date.now();
  const stored = getSessionsForGuild(session.guildId)[session.channelId]?.inboxCursor;
  // No cursor yet (a new lane, or a fresh session after /a4d clear): files since the session started
  // are news, so a reply that lands before "너는 <세션명>" is not lost.
  const started = Date.parse(session.createdAt);
  const since = stored?.dir === rule.dir ? stored.since : Number.isNaN(started) ? now : Math.min(started, now);
  const w: Watch = {
    channelId: session.channelId,
    guildId: session.guildId,
    name: session.sessionName,
    rule,
    known: new Set(names),
    settling: new Map(),
    ready: [],
    timer: setInterval(() => checkInbox(session.channelId), POLL_MS),
  };
  w.timer.unref?.();
  // Matching files changed since the last delivery arrived while nobody was watching.
  for (const f of names) {
    if (!isForLane(rule, f)) continue;
    const st = stat(path.join(rule.dir, f));
    // mtime, like the projects' own `find -newer` watches; ctime also moves on chmod or touch -r.
    if (st && st.mtimeMs > since) w.settling.set(f, st.size);
  }
  watches.set(session.channelId, w);
  persist(w, now);
  return { ok: true, dir: rule.dir };
}

/** Told to the session when the bot watches its inbox, so it does not start its own watch loop. */
export function inboxWatchNote(dir: string): string {
  return `[A4D inbox] 봇이 인박스 ${dir} 를 감시하다가 이 레인 앞으로 온 새 파일을 [A4D inbox] 메시지로 전해 준다. ` +
    '프로젝트 규칙에 있는 인박스 감시 루프(백그라운드 Bash, Monitor)는 띄우지 마라. 다른 감시는 규칙대로 한다.';
}

export function stopInboxWatch(channelId: string): void {
  const w = watches.get(channelId);
  if (!w) return;
  clearInterval(w.timer);
  watches.delete(channelId);
}

export function stopAllInboxWatches(): void {
  for (const channelId of [...watches.keys()]) stopInboxWatch(channelId);
}

export interface InboxWatchStatus {
  rule: LaneRule;
  waiting: string[];
}

export function inboxWatchStatus(channelId: string): InboxWatchStatus | null {
  const w = watches.get(channelId);
  return w ? { rule: w.rule, waiting: [...w.settling.keys(), ...w.ready] } : null;
}

/** Whether the session named this file in a recent Write/Edit/Bash call, i.e. wrote it itself. */
function wroteItself(channelId: string, fileName: string): boolean {
  const nfc = fileName.normalize('NFC');
  return (recentInputs.get(channelId) ?? []).some((input) => input.includes(nfc));
}

/** List the folder, pick up new matching files and pass them on if the session is idle. Runs on every poll. */
export function checkInbox(channelId: string): void {
  const w = watches.get(channelId);
  if (!w) return;
  const at = Date.now();
  const names = listMessages(w.rule.dir);
  if (!names) return;

  // Settled since the last check: the size did not change.
  for (const [f, size] of w.settling) {
    const st = stat(path.join(w.rule.dir, f));
    if (!st) w.settling.delete(f);
    else if (st.size === size) {
      w.settling.delete(f);
      if (!wroteItself(channelId, f)) w.ready.push(f);
    } else w.settling.set(f, st.size);
  }
  for (const f of names) {
    if (w.known.has(f) || !isForLane(w.rule, f) || wroteItself(channelId, f)) continue;
    w.settling.set(f, stat(path.join(w.rule.dir, f))?.size ?? 0);
  }
  w.known = new Set(names); // a deleted file that comes back counts as new

  deliver(w);
  persist(w, at);
}

function head(file: string): string {
  try {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split('\n');
    let out = lines.slice(0, HEAD_LINES).join('\n');
    if (out.length > HEAD_CHARS) out = out.slice(0, HEAD_CHARS);
    return out.length < text.length ? `${out.trimEnd()}\n…` : out.trimEnd();
  } catch {
    return '(읽지 못함)';
  }
}

function deliver(w: Watch): void {
  if (!w.ready.length) return;
  const session = sessionManager.getSession(w.channelId);
  if (!session || session.state !== 'idle') return; // passed on when the turn ends

  const files = [...w.ready].sort();
  const parts: string[] = [];
  let length = 0;
  for (const f of files) {
    const full = path.join(w.rule.dir, f);
    const block = `── ${full}\n${head(full)}`;
    if (length + block.length > MAX_MESSAGE_CHARS) {
      parts.push(`── ${full}`); // over the budget: path only
    } else {
      parts.push(block);
      length += block.length;
    }
  }
  const message = [
    `[A4D inbox] 이 메시지는 사용자가 아니라 봇이 보냈다. 인박스 ${w.rule.dir} 에 이 레인(${w.name}) 앞으로 ` +
      `새 파일 ${files.length}개가 왔다 (${INBOX_CONFIG_FILE} 규칙). 봇이 계속 감시하므로 따로 감시 루프를 띄우지 않아도 된다.`,
    '',
    ...parts,
    '',
    '파일 전문을 읽고 프로젝트 규칙대로 처리하라.',
  ].join('\n');
  try {
    sessionManager.sendMessage(w.channelId, message);
  } catch (err) {
    console.warn(`[inbox] Failed to deliver to ${w.channelId}:`, err);
    return;
  }
  w.ready = [];

  const channel = discord?.channels.cache.get(w.channelId) as TextChannel | undefined;
  if (channel?.isTextBased()) {
    startTyping(channel);
    const list = files.slice(0, 5).map((f) => `\`${f}\``).join(', ') + (files.length > 5 ? ` 외 ${files.length - 5}개` : '');
    channel.send(`📥 인박스 새 파일 ${files.length}개를 세션에 전달했습니다: ${list}`.slice(0, 1900)).catch(() => {});
  }
}

/** Hook the watch into session events. Call once at startup. */
export function setupInboxWatch(client: Client): void {
  discord = client;

  // Remember what the session's own tool calls named, to skip the files it writes into the inbox.
  sessionManager.on('assistant', (channelId: string, msg: SDKAssistantMessage) => {
    const content = msg.message?.content;
    if (!Array.isArray(content)) return;
    for (const block of content as any[]) {
      if (block?.type !== 'tool_use' || !['Write', 'Edit', 'MultiEdit', 'Bash'].includes(block.name)) continue;
      let input: string;
      try {
        input = JSON.stringify(block.input ?? {}).normalize('NFC');
      } catch {
        continue;
      }
      const list = recentInputs.get(channelId) ?? [];
      list.push(input);
      if (list.length > RECENT_INPUTS) list.shift();
      recentInputs.set(channelId, list);
    }
  });

  sessionManager.on('result', (channelId: string) => checkInbox(channelId));
  sessionManager.on('stopped', (channelId: string) => {
    stopInboxWatch(channelId);
    recentInputs.delete(channelId);
  });
}
