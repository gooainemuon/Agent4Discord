// Where tool calls are shown. Discord posts a "started a thread" system message for every thread
// made without a parent message, so one thread per tool call fills the channel with grey lines.
//   turn  — one thread per turn, attached to a short "🔧 ..." anchor message (default)
//   each  — one thread per tool call (the old behaviour)
//   off   — tool calls are not shown at all
// In turn and each mode, inbox-polling calls go to one private thread per channel instead: a
// private thread without a parent message gets no system message, and polling is noise anyway.
import { ChannelType, ThreadAutoArchiveDuration, type Message, type TextChannel, type ThreadChannel } from 'discord.js';

export { THREAD_MODES, DEFAULT_THREAD_MODE, isThreadMode, type ThreadMode } from '../config.js';

export const POLLING_THREAD_NAME = '🔁 polling';
/** Read-only tools whose input mentions an inbox, or a Bash command that sleeps, count as polling. */
const POLLING_TOOLS = new Set(['Bash', 'Read', 'Glob', 'Grep', 'LS', 'Monitor']);
const POLLING_PATTERN = /inbox|인박스|\bsleep\s+\d/iu;

export function isPollingCall(toolName: string, input: Record<string, unknown> | undefined): boolean {
  if (!POLLING_TOOLS.has(toolName)) return false;
  let text: string;
  try {
    text = JSON.stringify(input ?? {});
  } catch {
    return false;
  }
  return POLLING_PATTERN.test(text);
}

interface TurnState {
  thread: ThreadChannel | null;
  anchor: Message | null;
  creating: Promise<ThreadChannel> | null;
  counts: Map<string, number>;
  editTimer: ReturnType<typeof setTimeout> | null;
}

const turns = new Map<string, TurnState>();
const pollingThreads = new Map<string, ThreadChannel>();
const pollingCreating = new Map<string, Promise<ThreadChannel | null>>();
const pollingUnavailable = new Set<string>();

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** `🔧 Bash ×5 · Read ×2`, the anchor text that shows what the turn's thread holds. */
export function formatAnchor(counts: Map<string, number>): string {
  const parts = [...counts.entries()].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name));
  return parts.length ? `🔧 ${parts.join(' · ')}` : '🔧 도구 호출';
}

function state(channelId: string): TurnState {
  let s = turns.get(channelId);
  if (!s) {
    s = { thread: null, anchor: null, creating: null, counts: new Map(), editTimer: null };
    turns.set(channelId, s);
  }
  return s;
}

/**
 * The current turn's thread for `channel`, created on first use: a short anchor message with the
 * thread attached to it. The anchor's text is kept up to date with the tool counts.
 * Returns null if the thread cannot be created (the caller then shows nothing for the call).
 */
export async function getTurnThread(channel: TextChannel, toolName: string): Promise<ThreadChannel | null> {
  const s = state(channel.id);
  s.counts.set(toolName, (s.counts.get(toolName) ?? 0) + 1);
  scheduleAnchorEdit(s);

  if (s.thread) return s.thread;
  if (!s.creating) {
    s.creating = (async () => {
      const now = new Date();
      const anchor = await channel.send(formatAnchor(s.counts));
      const thread = await anchor.startThread({
        name: `🔧 도구 · ${pad(now.getHours())}:${pad(now.getMinutes())}`,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneHour,
        reason: 'A4D tool calls of this turn',
      });
      s.anchor = anchor;
      s.thread = thread;
      return thread;
    })();
  }
  try {
    return await s.creating;
  } catch (err) {
    console.error('[threads] Failed to create the turn thread:', err);
    s.creating = null;
    return null;
  }
}

function scheduleAnchorEdit(s: TurnState): void {
  if (s.editTimer) return;
  s.editTimer = setTimeout(() => {
    s.editTimer = null;
    const text = formatAnchor(s.counts);
    if (s.anchor && s.anchor.content !== text) {
      s.anchor.edit(text).catch(() => {});
    }
  }, 1500);
}

/** The turn is over (result arrived or the user sent the next message): the next call opens a new thread. */
export function endTurn(channelId: string): string | null {
  const s = turns.get(channelId);
  if (!s) return null;
  turns.delete(channelId);
  if (s.editTimer) {
    clearTimeout(s.editTimer);
    const text = formatAnchor(s.counts);
    if (s.anchor && s.anchor.content !== text) s.anchor.edit(text).catch(() => {});
  }
  return s.thread?.id ?? null;
}

/**
 * The channel's private polling thread, created on first use and reused (also across restarts: an
 * active thread of that name is picked up). Null when private threads are unavailable here, after
 * which the caller falls back to the turn thread; the failure is logged once per channel.
 */
export async function getPollingThread(channel: TextChannel, userId: string): Promise<ThreadChannel | null> {
  const cached = pollingThreads.get(channel.id);
  if (cached) return cached;
  if (pollingUnavailable.has(channel.id)) return null;

  let creating = pollingCreating.get(channel.id);
  if (!creating) {
    creating = (async () => {
      try {
        const active = await channel.threads.fetchActive();
        const existing = active.threads.find(
          (t) => t.name === POLLING_THREAD_NAME && t.type === ChannelType.PrivateThread,
        );
        const thread =
          existing ??
          (await channel.threads.create({
            name: POLLING_THREAD_NAME,
            type: ChannelType.PrivateThread,
            invitable: false,
            autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
            reason: 'A4D inbox polling (kept out of the channel)',
          }));
        await thread.members.add(userId).catch(() => {});
        pollingThreads.set(channel.id, thread);
        return thread;
      } catch (err) {
        console.warn(`[threads] Private polling thread unavailable in ${channel.id}, using the turn thread:`, err);
        pollingUnavailable.add(channel.id);
        return null;
      } finally {
        pollingCreating.delete(channel.id);
      }
    })();
    pollingCreating.set(channel.id, creating);
  }
  return creating;
}

/** Forget a channel's threads (channel deleted or session cleared). */
export function forgetChannelThreads(channelId: string): void {
  endTurn(channelId);
  pollingThreads.delete(channelId);
  pollingUnavailable.delete(channelId);
}
