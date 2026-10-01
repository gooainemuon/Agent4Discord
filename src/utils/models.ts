// Models offered in the session picker, backed by the list the CLI reports (see modelCatalog.ts).

import { getDefaultModel, getModelLabel, getModels, MAX_DISCORD_CHOICES } from '../sessions/modelCatalog.js';

export { getDefaultModel };

export function modelLabel(value: string): string {
  return getModelLabel(value);
}

/** Options for a StringSelectMenuBuilder, with `selected` marked as the default. */
export function modelSelectOptions(
  selected: string,
): { label: string; value: string; description?: string; default: boolean }[] {
  return getModels().slice(0, MAX_DISCORD_CHOICES).map((m) => ({
    label: m.displayName.slice(0, 100),
    value: m.value,
    ...(m.description && { description: m.description.slice(0, 100) }),
    default: m.value === selected,
  }));
}
