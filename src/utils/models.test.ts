import { afterEach, describe, expect, it } from 'vitest';
import { resetModels } from '../sessions/modelCatalog.js';
import { getDefaultModel, modelLabel, modelSelectOptions } from './models.js';

describe('models', () => {
  afterEach(() => resetModels());

  it('offers the default model', () => {
    expect(modelSelectOptions(getDefaultModel()).some((o) => o.value === getDefaultModel())).toBe(true);
  });

  it('marks exactly the selected model as default', () => {
    const opts = modelSelectOptions('sonnet');
    expect(opts.filter((o) => o.default).map((o) => o.value)).toEqual(['sonnet']);
  });

  it('falls back to the raw value for unknown models', () => {
    expect(modelLabel('claude-opus-4-6')).toBe('claude-opus-4-6');
    expect(modelLabel('opus')).toContain('Opus');
  });
});
