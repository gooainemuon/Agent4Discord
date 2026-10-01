import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SDKControlGetUsageResponse } from '@anthropic-ai/claude-agent-sdk';

const usageMock = vi.fn<() => Promise<SDKControlGetUsageResponse>>();

vi.mock('../src/utils/probeQuery.js', () => ({
  withProbeQuery: (fn: (q: unknown) => Promise<unknown>) =>
    fn({ usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: usageMock }),
}));
vi.mock('../src/sessions/sessionManager.js', () => ({
  sessionManager: { getAllSessions: () => [], on: vi.fn() },
}));

function response(overrides: Partial<SDKControlGetUsageResponse>): SDKControlGetUsageResponse {
  return {
    session: {} as SDKControlGetUsageResponse['session'],
    subscription_type: 'max',
    rate_limits_available: true,
    rate_limits: null,
    behaviors: null,
    ...overrides,
  } as SDKControlGetUsageResponse;
}

async function load() {
  vi.resetModules();
  return import('../src/sessions/usageTracker.js');
}

describe('usageTracker', () => {
  beforeEach(() => usageMock.mockReset());

  it('renders plan limits including per-model weekly buckets', async () => {
    usageMock.mockResolvedValue(response({
      rate_limits: {
        five_hour: { utilization: 42, resets_at: '2026-10-01T12:00:00Z' },
        seven_day: { utilization: 10, resets_at: null },
        model_scoped: [{ display_name: 'Fable', utilization: 75, resets_at: null }],
      },
    }));
    const { fetchUsage, buildUsageEmbed } = await load();
    await fetchUsage();

    const fields = buildUsageEmbed().toJSON().fields ?? [];
    expect(fields.map((f) => f.name)).toEqual(['⏰ Session (5h)', '📅 Weekly (7d)', '📅 Weekly Fable']);
    expect(fields[2].value).toContain('**75%**');
  });

  it('keeps the last data and backs off when no rate limits come back (upstream 429)', async () => {
    const { fetchUsage, buildUsageEmbed } = await load();
    usageMock.mockResolvedValueOnce(response({ rate_limits: { seven_day: { utilization: 5, resets_at: null } } }));
    await fetchUsage();
    usageMock.mockResolvedValueOnce(response({ rate_limits: null }));
    await fetchUsage();

    const embed = buildUsageEmbed().toJSON();
    expect(embed.fields?.[0].value).toContain('**5%**');
    expect(embed.footer?.text).toBe('Polling every 600s');
  });

  it('shows the subscriber-only notice for API key sessions', async () => {
    usageMock.mockResolvedValue(response({ subscription_type: null, rate_limits_available: false }));
    const { fetchUsage, buildUsageEmbed } = await load();
    await fetchUsage();

    expect(buildUsageEmbed().toJSON().description).toContain('only available for Claude.ai subscribers');
  });

  it('shares one in-flight request between concurrent callers', async () => {
    usageMock.mockResolvedValue(response({ rate_limits: {} }));
    const { fetchUsage } = await load();
    await Promise.all([fetchUsage(), fetchUsage(), fetchUsage()]);
    expect(usageMock).toHaveBeenCalledTimes(1);
  });
});
