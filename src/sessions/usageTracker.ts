import type { Query, SDKControlGetUsageResponse } from '@anthropic-ai/claude-agent-sdk';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type ButtonInteraction,
  type Client,
  type TextChannel,
} from 'discord.js';
import { COLORS } from '../formatters/embedBuilder.js';
import { loadGuildConfig } from '../guild.js';
import { withProbeQuery } from '../utils/probeQuery.js';
import { sessionManager } from './sessionManager.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type UsageResponse = NonNullable<SDKControlGetUsageResponse['rate_limits']>;
type RateLimit = { utilization: number | null; resets_at: string | null };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_POLL_INTERVAL = 300_000;     // 5 min — the usage endpoint rate-limits aggressively
const MAX_POLL_INTERVAL = 1_800_000;   // 30 min
const BACKOFF_MULTIPLIER = 2;
const EVENT_REFRESH_COOLDOWN = 60_000; // min gap between event-triggered refreshes

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let cachedUsage: UsageResponse | null = null;
let lastFetchedAt = 0;
let lastAttemptAt = 0;
let currentPollInterval = MIN_POLL_INTERVAL;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let trackerClient: Client | null = null;
let isOAuthAvailable = true;
let inFlight: Promise<UsageResponse | null> | null = null;

// ---------------------------------------------------------------------------
// Usage API
// ---------------------------------------------------------------------------

// The SDK's /usage control request lets the Claude CLI handle credentials (Keychain on
// macOS, token refresh) instead of us touching OAuth tokens. It is marked experimental.
function requestUsage(q: Query): Promise<SDKControlGetUsageResponse> {
  return q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true });
}

async function queryUsage(): Promise<SDKControlGetUsageResponse> {
  // Reuse a live session's CLI process when there is one, to avoid spawning another
  const live = sessionManager.getAllSessions().find((s) => s.state === 'idle' || s.state === 'running');
  if (live) {
    try {
      return await requestUsage(live.query);
    } catch (err) {
      console.error('[usage] Live session usage request failed, using probe:', err);
    }
  }
  return withProbeQuery(requestUsage);
}

function backOff(reason: string): void {
  currentPollInterval = Math.min(currentPollInterval * BACKOFF_MULTIPLIER, MAX_POLL_INTERVAL);
  console.log(`[usage] ${reason}, backing off to ${currentPollInterval / 1000}s`);
}

async function doFetchUsage(): Promise<UsageResponse | null> {
  lastAttemptAt = Date.now();
  try {
    const res = await queryUsage();

    if (!res.rate_limits_available) {
      // API key / Bedrock / Vertex — plan limits do not apply
      isOAuthAvailable = false;
      currentPollInterval = MAX_POLL_INTERVAL;
      return null;
    }
    isOAuthAvailable = true;

    if (!res.rate_limits) {
      // Usually the upstream endpoint answering 429
      backOff('No rate limit data returned');
      return cachedUsage;
    }

    currentPollInterval = MIN_POLL_INTERVAL;
    cachedUsage = res.rate_limits;
    lastFetchedAt = Date.now();
    return cachedUsage;
  } catch (err) {
    console.error('[usage] Fetch error:', err);
    backOff('Fetch failed');
    return cachedUsage;
  }
}

/** Fetch usage, sharing one in-flight request between concurrent callers. */
export function fetchUsage(): Promise<UsageResponse | null> {
  inFlight ??= doFetchUsage().finally(() => { inFlight = null; });
  return inFlight;
}

// ---------------------------------------------------------------------------
// Embed builder
// ---------------------------------------------------------------------------

function progressBar(utilization: number, length = 20): string {
  const clamped = Math.max(0, Math.min(1, utilization));
  const filled = Math.round(clamped * length);
  return '\u2588'.repeat(filled) + '\u2591'.repeat(length - filled);
}

function formatResetTime(resetsAt: string | null): string {
  if (!resetsAt) return '';
  const ts = Math.floor(new Date(resetsAt).getTime() / 1000);
  return `Resets <t:${ts}:R>`;
}

function utilizationColor(usage: UsageResponse | null): number {
  if (!usage) return COLORS.ARCHIVED;
  // API returns utilization as 0-100 percentage
  const fiveHour = usage.five_hour?.utilization ?? 0;
  const sevenDay = usage.seven_day?.utilization ?? 0;
  const maxUtil = Math.max(fiveHour, sevenDay);
  if (maxUtil >= 90) return COLORS.STOPPED;          // red
  if (maxUtil >= 70) return COLORS.STREAMING;         // yellow
  return COLORS.IDLE;                                 // green
}

function formatLimit(label: string, limit: RateLimit | null | undefined): string | null {
  if (!limit || limit.utilization == null) return null;
  // API returns utilization as 0-100 percentage
  const pct = Math.round(limit.utilization);
  const bar = progressBar(limit.utilization / 100);
  const reset = formatResetTime(limit.resets_at);
  return `${bar} **${pct}%**${reset ? `\n${reset}` : ''}`;
}

export function buildUsageEmbed(): EmbedBuilder {
  if (!isOAuthAvailable) {
    return new EmbedBuilder()
      .setTitle('\ud83d\udcca Claude Usage')
      .setColor(COLORS.ARCHIVED)
      .setDescription('Usage tracking is only available for Claude.ai subscribers (Pro/Max).\nPlease authenticate with `claude login`.');
  }

  if (!cachedUsage) {
    return new EmbedBuilder()
      .setTitle('\ud83d\udcca Claude Usage')
      .setColor(COLORS.ARCHIVED)
      .setDescription('Waiting for usage data...');
  }

  const embed = new EmbedBuilder()
    .setTitle('\ud83d\udcca Claude Usage')
    .setColor(utilizationColor(cachedUsage));

  // 5-hour limit
  const fiveHourText = formatLimit('5-Hour', cachedUsage.five_hour);
  if (fiveHourText) {
    embed.addFields({ name: '\u23f0 Session (5h)', value: fiveHourText });
  }

  // 7-day limit
  const sevenDayText = formatLimit('Weekly', cachedUsage.seven_day);
  if (sevenDayText) {
    embed.addFields({ name: '\ud83d\udcc5 Weekly (7d)', value: sevenDayText });
  }

  // Model-specific limits (inline)
  const opusText = formatLimit('Opus', cachedUsage.seven_day_opus);
  const sonnetText = formatLimit('Sonnet', cachedUsage.seven_day_sonnet);
  if (opusText) {
    embed.addFields({ name: '\ud83d\udcc5 Weekly Opus', value: opusText, inline: true });
  }
  if (sonnetText) {
    embed.addFields({ name: '\ud83d\udcc5 Weekly Sonnet', value: sonnetText, inline: true });
  }
  // Per-model weekly buckets reported by the server (e.g. Fable)
  for (const scoped of cachedUsage.model_scoped ?? []) {
    const text = formatLimit(scoped.display_name, scoped);
    if (text) {
      embed.addFields({ name: `\ud83d\udcc5 Weekly ${scoped.display_name}`.slice(0, 256), value: text, inline: true });
    }
  }

  // Extra usage
  if (cachedUsage.extra_usage?.is_enabled) {
    const extra = cachedUsage.extra_usage;
    const parts: string[] = [];
    if (extra.utilization != null) {
      parts.push(`${progressBar(extra.utilization / 100)} **${Math.round(extra.utilization)}%**`);
    }
    if (extra.used_credits != null && extra.monthly_limit != null) {
      parts.push(`$${(extra.used_credits / 100).toFixed(2)} / $${(extra.monthly_limit / 100).toFixed(2)}`);
    }
    if (parts.length > 0) {
      embed.addFields({ name: '\ud83d\udcb3 Extra Usage', value: parts.join('\n') });
    }
  }

  // No data at all
  if (!cachedUsage.five_hour && !cachedUsage.seven_day && !cachedUsage.seven_day_opus && !cachedUsage.seven_day_sonnet
    && !cachedUsage.model_scoped?.length) {
    embed.setDescription('No rate limit data available.');
  }

  // Footer with last updated
  if (lastFetchedAt > 0) {
    embed.setFooter({ text: `Polling every ${currentPollInterval / 1000}s` });
    embed.setTimestamp(lastFetchedAt);
  }

  return embed;
}

// ---------------------------------------------------------------------------
// Button row
// ---------------------------------------------------------------------------

export function buildUsageRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('a4d:usage:refresh')
      .setLabel('Refresh')
      .setEmoji('\ud83d\udd04')
      .setStyle(ButtonStyle.Secondary),
  );
}

export async function handleUsageRefresh(interaction: ButtonInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const result = await fetchUsage();
  if (!result) {
    const reply = await interaction.editReply({ content: 'Failed to fetch usage data.' });
    setTimeout(() => reply.delete().catch(() => {}), 10_000);
    return;
  }

  // Update the embed on the original message
  try {
    await interaction.message.edit({
      embeds: [buildUsageEmbed()],
      components: [buildUsageRow()],
    });
  } catch { /* best-effort */ }

  const reply = await interaction.editReply({ content: '\u2705 Usage refreshed.' });
  setTimeout(() => reply.delete().catch(() => {}), 10_000);
}

// ---------------------------------------------------------------------------
// Embed update
// ---------------------------------------------------------------------------

async function updateAllGuilds(): Promise<void> {
  if (!trackerClient) return;

  for (const guild of trackerClient.guilds.cache.values()) {
    const config = loadGuildConfig(guild.id);
    if (!config?.usageChannelId || !config?.usageMessageId) continue;

    const channel = trackerClient.channels.cache.get(config.usageChannelId);
    if (!channel?.isTextBased()) continue;

    try {
      const textChannel = channel as TextChannel;
      const msg = await textChannel.messages.fetch(config.usageMessageId).catch(() => null);
      if (msg) {
        await msg.edit({ embeds: [buildUsageEmbed()], components: [buildUsageRow()] });
      }
    } catch (err) {
      console.error(`[usage] Failed to update embed for guild ${guild.id}:`, err);
    }
  }
}

// ---------------------------------------------------------------------------
// Polling loop
// ---------------------------------------------------------------------------

async function poll(): Promise<void> {
  await fetchUsage();
  await updateAllGuilds();
  schedulePoll();
}

function schedulePoll(): void {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(() => void poll(), currentPollInterval);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function setupUsageTracker(client: Client): void {
  trackerClient = client;

  // Sessions emit rate_limit events when utilization changes; refresh promptly
  // (rate-limited) rather than waiting for the next poll.
  sessionManager.on('rate_limit', () => {
    if (Date.now() - lastAttemptAt < EVENT_REFRESH_COOLDOWN) return;
    void fetchUsage().then(() => updateAllGuilds());
  });

  // Initial fetch + start polling
  void poll();
}
