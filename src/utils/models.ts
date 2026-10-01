// Models offered in the session picker and `/a4d model`.
// Values are Claude Code aliases, so they follow the newest model of each family.
// Labels name what each alias resolves to with the bundled SDK; after an SDK upgrade,
// check them against `query.supportedModels()`.

export interface ModelChoice {
  value: string;
  label: string;
}

export const MODEL_CHOICES: readonly ModelChoice[] = [
  { value: 'opus', label: 'Opus 5.5 (complex and everyday work)' },
  { value: 'fable', label: 'Fable 5.1 (toughest, longest tasks)' },
  { value: 'sonnet', label: 'Sonnet 5.5 (fast)' },
  { value: 'haiku', label: 'Haiku 4.5 (fastest)' },
];

export const DEFAULT_MODEL = 'opus';

export function modelLabel(value: string): string {
  return MODEL_CHOICES.find((m) => m.value === value)?.label ?? value;
}

/** Options for a StringSelectMenuBuilder, with `selected` marked as the default. */
export function modelSelectOptions(selected: string): { label: string; value: string; default: boolean }[] {
  return MODEL_CHOICES.map((m) => ({ label: m.label, value: m.value, default: m.value === selected }));
}
