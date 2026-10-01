import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL, MODEL_CHOICES, modelLabel, modelSelectOptions } from './models.js';

describe('models', () => {
  it('fits Discord limits for select options and slash command choices', () => {
    expect(MODEL_CHOICES.length).toBeLessThanOrEqual(25);
    for (const m of MODEL_CHOICES) expect(m.label.length).toBeLessThanOrEqual(100);
    expect(new Set(MODEL_CHOICES.map((m) => m.value)).size).toBe(MODEL_CHOICES.length);
  });

  it('offers the default model', () => {
    expect(MODEL_CHOICES.some((m) => m.value === DEFAULT_MODEL)).toBe(true);
  });

  it('marks exactly the selected model as default', () => {
    const opts = modelSelectOptions('fable');
    expect(opts.filter((o) => o.default).map((o) => o.value)).toEqual(['fable']);
  });

  it('falls back to the raw value for unknown models', () => {
    expect(modelLabel('claude-opus-4-6')).toBe('claude-opus-4-6');
    expect(modelLabel('opus')).toContain('Opus');
  });
});
