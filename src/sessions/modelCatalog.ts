import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk';
import { withProbeQuery } from '../utils/probeQuery.js';

/** Discord caps select menus and autocomplete results at 25 entries. */
export const MAX_DISCORD_CHOICES = 25;

const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Used until the first successful fetch, or if fetching fails. Aliases always resolve to the latest model. */
const FALLBACK_MODELS: ModelInfo[] = [
  { value: 'opus', displayName: 'Opus', description: 'Most capable' },
  { value: 'sonnet', displayName: 'Sonnet', description: 'Fast' },
  { value: 'haiku', displayName: 'Haiku', description: 'Fastest' },
];

let cached: ModelInfo[] | null = null;

/** Available models, in CLI order. 'default' is omitted since sessions default to the 'opus' alias. */
export function getModels(): ModelInfo[] {
  return cached ?? FALLBACK_MODELS;
}

export function getModelLabel(value: string): string {
  return getModels().find((m) => m.value === value)?.displayName ?? value;
}

export function isKnownModel(value: string): boolean {
  return getModels().some((m) => m.value === value);
}

/** Model preselected in the session picker: the 'opus' alias when offered, else the first listed. */
export function getDefaultModel(): string {
  return isKnownModel('opus') ? 'opus' : getModels()[0].value;
}

/** Replace the cached list; ignored if empty so a bad fetch never leaves users with no options. */
export function setModels(models: ModelInfo[]): void {
  const seen = new Set<string>();
  const usable: ModelInfo[] = [];
  for (const m of models) {
    // Discord rejects duplicate option values and empty labels
    if (!m.value || m.value === 'default' || seen.has(m.value)) continue;
    seen.add(m.value);
    usable.push({ ...m, displayName: m.displayName || m.value });
  }
  if (usable.length > 0) cached = usable;
}

/** Test helper: forget the fetched list and return to the fallback. */
export function resetModels(): void {
  cached = null;
}

export async function refreshModels(): Promise<void> {
  try {
    setModels(await withProbeQuery((q) => q.supportedModels()));
    console.log(`[models] Loaded ${getModels().length} models`);
  } catch (err) {
    console.error('[models] Failed to fetch model list, keeping current list:', err);
  }
}

/** Fetch now and periodically, so newly released models show up without a restart. */
export function setupModelCatalog(): void {
  void refreshModels();
  setInterval(() => void refreshModels(), REFRESH_INTERVAL_MS).unref();
}
