import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getDefaultModel,
  getModelLabel,
  getModels,
  isKnownModel,
  resetModels,
  setModels,
} from '../src/sessions/modelCatalog.js';
import { resolveClaudeExecutable } from '../src/utils/claudeCli.js';

describe('modelCatalog', () => {
  beforeEach(() => resetModels());

  it('falls back to aliases before any fetch', () => {
    expect(getModels().map((m) => m.value)).toEqual(['opus', 'sonnet', 'haiku']);
    expect(getDefaultModel()).toBe('opus');
  });

  it('drops duplicate values and fills empty display names', () => {
    setModels([
      { value: 'opus', displayName: 'Opus 5.5', description: '' },
      { value: 'opus', displayName: 'Opus again', description: '' },
      { value: 'claude-opus-5', displayName: '', description: '' },
    ]);
    expect(getModels().map((m) => [m.value, m.displayName])).toEqual([
      ['opus', 'Opus 5.5'],
      ['claude-opus-5', 'claude-opus-5'],
    ]);
  });

  it('preselects the first model when the opus alias is not offered', () => {
    setModels([{ value: 'claude-sonnet-5', displayName: 'Sonnet 5', description: '' }]);
    expect(getDefaultModel()).toBe('claude-sonnet-5');
  });

  it('uses the fetched list, dropping the "default" entry', () => {
    setModels([
      { value: 'default', displayName: 'Default (recommended)', description: '' },
      { value: 'opus', displayName: 'Opus 5.5', description: 'For complex work' },
      { value: 'claude-fable-5-1', displayName: 'Fable 5.1', description: 'Toughest challenges' },
    ]);
    expect(getModels().map((m) => m.value)).toEqual(['opus', 'claude-fable-5-1']);
    expect(getModelLabel('opus')).toBe('Opus 5.5');
    expect(getModelLabel('unknown-model')).toBe('unknown-model');
    expect(isKnownModel('claude-fable-5-1')).toBe(true);
    expect(isKnownModel('default')).toBe(false);
  });

  it('keeps the previous list when a fetch returns nothing usable', () => {
    setModels([{ value: 'opus', displayName: 'Opus 5.5', description: '' }]);
    const before = getModels();
    setModels([{ value: 'default', displayName: 'Default', description: '' }]);
    expect(getModels()).toBe(before);
  });
});

describe('resolveClaudeExecutable', () => {
  const dirs: string[] = [];
  const tmp = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'a4d-cli-'));
    dirs.push(d);
    return d;
  };

  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it('finds the platform binary on PATH', () => {
    const bin = tmp();
    fs.writeFileSync(path.join(bin, 'claude.exe'), '');
    expect(resolveClaudeExecutable(bin, 'win32', tmp())).toBe(path.join(bin, 'claude.exe'));
  });

  it('ignores the npm .cmd shim on Windows', () => {
    const bin = tmp();
    fs.writeFileSync(path.join(bin, 'claude.cmd'), '');
    expect(resolveClaudeExecutable(bin, 'win32', tmp())).toBeUndefined();
  });

  it('checks ~/.local/bin when not on PATH', () => {
    const home = tmp();
    fs.mkdirSync(path.join(home, '.local', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(home, '.local', 'bin', 'claude'), '');
    expect(resolveClaudeExecutable('', 'linux', home)).toBe(path.join(home, '.local', 'bin', 'claude'));
  });

  it('returns undefined when no CLI is installed', () => {
    expect(resolveClaudeExecutable(tmp(), 'linux', tmp())).toBeUndefined();
  });
});
