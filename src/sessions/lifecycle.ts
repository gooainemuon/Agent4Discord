// Process lifecycle: graceful shutdown and scheduled shutdown driven by a4d-ctl.
//
// Signals (sent by tools/a4d-ctl):
//   SIGTERM / SIGINT  -> notify active sessions, close them, exit now
//   SIGUSR2           -> scheduled shutdown: post a notice with extend/now buttons,
//                        wait the notice period, then wait for running sessions to go idle
//   SIGUSR1           -> cancel a pending scheduled shutdown
import fs from 'node:fs';
import path from 'node:path';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
  type Client,
  type Message,
  type TextChannel,
} from 'discord.js';
import { CONFIG_DIR } from '../config.js';
import { sessionManager } from './sessionManager.js';

const STATE_PATH = path.join(CONFIG_DIR, 'bot-state.json');
const CTL_CONFIG_PATH = path.join(CONFIG_DIR, 'ctl.json');
const IDLE_POLL_MS = 15_000;
const FORCE_EXIT_MS = 15_000;

interface ShutdownSettings {
  stopNoticeMinutes: number;
  maxIdleWaitMinutes: number;
  extendMinutes: number;
}

type PendingPhase = 'notice' | 'waiting-idle' | 'extended';

interface PendingShutdown {
  phase: PendingPhase;
  /** Epoch ms when the bot is expected to shut down. */
  at: number;
  timer: NodeJS.Timeout;
  notices: Message[];
}

let client: Client | null = null;
let pending: PendingShutdown | null = null;
let shuttingDown = false;
const startedAt = new Date().toISOString();

function loadSettings(): ShutdownSettings {
  const defaults: ShutdownSettings = { stopNoticeMinutes: 10, maxIdleWaitMinutes: 30, extendMinutes: 60 };
  try {
    const obj = JSON.parse(fs.readFileSync(CTL_CONFIG_PATH, 'utf-8')) as Record<string, unknown>;
    const num = (key: keyof ShutdownSettings): number =>
      typeof obj[key] === 'number' && (obj[key] as number) >= 0 ? (obj[key] as number) : defaults[key];
    return {
      stopNoticeMinutes: num('stopNoticeMinutes'),
      maxIdleWaitMinutes: num('maxIdleWaitMinutes'),
      extendMinutes: num('extendMinutes'),
    };
  } catch {
    return defaults;
  }
}

function writeState(): void {
  const state = {
    pid: process.pid,
    startedAt,
    pendingShutdown: pending ? { phase: pending.phase, at: new Date(pending.at).toISOString() } : null,
  };
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n', 'utf-8');
  } catch (err) {
    console.error('[lifecycle] Failed to write bot state:', err);
  }
}

function removeState(): void {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8')) as { pid?: number };
    if (raw.pid === process.pid) fs.unlinkSync(STATE_PATH);
  } catch {
    // already gone
  }
}

function activeChannels(): TextChannel[] {
  if (!client) return [];
  const channels: TextChannel[] = [];
  for (const session of sessionManager.getAllSessions()) {
    if (session.state === 'stopped' || session.state === 'archived') continue;
    const channel = client.channels.cache.get(session.channelId);
    if (channel?.isTextBased()) channels.push(channel as TextChannel);
  }
  return channels;
}

function anySessionRunning(): boolean {
  return sessionManager.getAllSessions().some((s) => s.state === 'running');
}

function discordTime(ms: number): string {
  const unix = Math.floor(ms / 1000);
  return `<t:${unix}:t> (<t:${unix}:R>)`;
}

function noticeButtons(extendMinutes: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('a4d:shutdown:extend')
      .setLabel(`${extendMinutes}분 연장`)
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('a4d:shutdown:now')
      .setLabel('지금 종료')
      .setStyle(ButtonStyle.Danger),
  );
}

async function editNotices(notices: Message[], content: string): Promise<void> {
  await Promise.all(notices.map((m) => m.edit({ content, components: [] }).catch(() => {})));
}

/** Start the scheduled-shutdown flow (SIGUSR2). */
async function scheduleShutdown(): Promise<void> {
  if (shuttingDown || (pending && pending.phase !== 'extended')) return;
  if (pending) clearTimeout(pending.timer);

  const settings = loadSettings();
  const channels = activeChannels();
  if (channels.length === 0) {
    pending = null;
    await shutdown('예약 종료');
    return;
  }

  const at = Date.now() + settings.stopNoticeMinutes * 60_000;
  const content =
    `⏰ **예약 종료** — ${discordTime(at)}에 봇이 종료됩니다.\n` +
    `진행 중인 작업이 있으면 끝날 때까지 최대 ${settings.maxIdleWaitMinutes}분 더 기다립니다.`;
  const notices = (
    await Promise.all(
      channels.map((ch) => ch.send({ content, components: [noticeButtons(settings.extendMinutes)] }).catch(() => null)),
    )
  ).filter((m): m is Message<true> => m !== null);

  pending = {
    phase: 'notice',
    at,
    notices,
    timer: setTimeout(() => void waitForIdleThenShutdown(), settings.stopNoticeMinutes * 60_000),
  };
  writeState();
  console.log(`[lifecycle] Scheduled shutdown at ${new Date(at).toISOString()}`);
}

async function waitForIdleThenShutdown(): Promise<void> {
  if (!pending) return;
  const settings = loadSettings();
  const giveUpAt = Date.now() + settings.maxIdleWaitMinutes * 60_000;
  pending.phase = 'waiting-idle';
  writeState();

  const check = async (): Promise<void> => {
    if (!pending || pending.phase !== 'waiting-idle') return;
    if (!anySessionRunning() || Date.now() >= giveUpAt) {
      await shutdown('예약 종료');
      return;
    }
    pending.timer = setTimeout(() => void check(), IDLE_POLL_MS);
  };
  await check();
}

async function cancelScheduledShutdown(): Promise<void> {
  if (!pending) return;
  clearTimeout(pending.timer);
  const notices = pending.notices;
  pending = null;
  writeState();
  await editNotices(notices, '✅ 예약 종료가 취소되었습니다.');
  console.log('[lifecycle] Scheduled shutdown cancelled');
}

/** Notify active sessions, close them, and exit. */
async function shutdown(reason: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[lifecycle] Shutting down: ${reason}`);
  setTimeout(() => process.exit(0), FORCE_EXIT_MS).unref();

  const notices = pending?.notices ?? [];
  if (pending) clearTimeout(pending.timer);
  pending = null;

  const message = `🔌 봇이 종료됩니다 (${reason}). 다시 켜지면 \`/a4d resume\`으로 세션을 이어갈 수 있어요.`;
  await editNotices(notices, message);
  const noticed = new Set(notices.map((m) => m.channelId));
  await Promise.all(
    activeChannels()
      .filter((ch) => !noticed.has(ch.id))
      .map((ch) => ch.send(message).catch(() => {})),
  );

  for (const session of sessionManager.getAllSessions()) {
    try {
      sessionManager.stopSession(session.channelId);
    } catch {
      // ignore
    }
  }
  await client?.destroy().catch(() => {});
  removeState();
  process.exit(0);
}

export async function handleShutdownButton(interaction: ButtonInteraction): Promise<void> {
  if (interaction.customId === 'a4d:shutdown:now') {
    await interaction.deferUpdate().catch(() => {});
    await shutdown('사용자 요청');
    return;
  }

  if (interaction.customId === 'a4d:shutdown:extend') {
    if (!pending || pending.phase === 'extended') {
      await interaction.reply({ content: '예약된 종료가 없어요.', ephemeral: true });
      return;
    }
    await interaction.deferUpdate().catch(() => {});
    clearTimeout(pending.timer);
    const settings = loadSettings();
    const extendMs = settings.extendMinutes * 60_000;
    const notices = pending.notices;
    pending = {
      phase: 'extended',
      at: Date.now() + extendMs + settings.stopNoticeMinutes * 60_000,
      notices: [],
      timer: setTimeout(() => void scheduleShutdown(), extendMs),
    };
    writeState();
    await editNotices(
      notices,
      `⏸ 종료를 ${settings.extendMinutes}분 연장했어요. ${discordTime(Date.now() + extendMs)}에 다시 알려드릴게요.`,
    );
    return;
  }

  await interaction.reply({ content: 'Unknown shutdown action.', ephemeral: true });
}

export function setupLifecycle(c: Client): void {
  client = c;
  writeState();

  process.on('SIGTERM', () => void shutdown('종료 요청'));
  process.on('SIGINT', () => {
    if (shuttingDown) process.exit(1);
    void shutdown('종료 요청');
  });
  if (process.platform !== 'win32') {
    process.on('SIGUSR2', () => void scheduleShutdown());
    process.on('SIGUSR1', () => void cancelScheduledShutdown());
  }
  process.on('exit', removeState);
}
