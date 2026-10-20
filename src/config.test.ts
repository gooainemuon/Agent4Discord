import fs from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let home: string;
const realHome = process.env.HOME;

async function loadWith(extra: Record<string, unknown>) {
  const dir = nodePath.join(home, '.agent4discord');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    nodePath.join(dir, 'config.json'),
    JSON.stringify({ discordToken: 't', discordClientId: 'c', ...extra }),
  );
  vi.resetModules(); // CONFIG_PATH is computed from the home directory at import time
  const { loadConfig } = await import('./config.js');
  return loadConfig(nodePath.join(home, 'no-shared-defaults.json')); // the built-in values
}

beforeEach(() => {
  home = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'a4d-config-'));
  process.env.HOME = home;
});

afterEach(() => {
  process.env.HOME = realHome;
  fs.rmSync(home, { recursive: true, force: true });
});

describe('maxSessionsPerUser', () => {
  it('defaults to 10 when missing', async () => {
    expect((await loadWith({})).maxSessionsPerUser).toBe(10);
  });

  it('uses a positive integer from config.json', async () => {
    expect((await loadWith({ maxSessionsPerUser: 6 })).maxSessionsPerUser).toBe(6);
  });

  it('ignores invalid values', async () => {
    for (const bad of [0, -1, 2.5, '8', null]) {
      expect((await loadWith({ maxSessionsPerUser: bad })).maxSessionsPerUser).toBe(10);
    }
  });
});

describe('shared defaults (a4d.defaults.json)', () => {
  async function loadWithDefaults(defaults: unknown, device: Record<string, unknown>) {
    const dir = nodePath.join(home, '.agent4discord');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(nodePath.join(dir, 'config.json'), JSON.stringify({ discordToken: 't', discordClientId: 'c', ...device }));
    const file = nodePath.join(home, 'a4d.defaults.json');
    fs.writeFileSync(file, typeof defaults === 'string' ? defaults : JSON.stringify(defaults));
    vi.resetModules();
    const { loadConfig } = await import('./config.js');
    return loadConfig(file);
  }

  it('applies the shared values, and a value in config.json overrides them on that device', async () => {
    const shared = { claudeModel: 'sonnet', maxSessionsPerUser: 50, toolThreadMode: 'each', autoResumeSessions: false };
    const config = await loadWithDefaults(shared, { claudeModel: 'opus' });
    expect(config).toMatchObject({ claudeModel: 'opus', maxSessionsPerUser: 50, toolThreadMode: 'each', autoResumeSessions: false });
  });

  it('never takes the bot identity from the shared file', async () => {
    const config = await loadWithDefaults({ discordToken: 'leak', discordClientId: 'x', ownerIds: ['1'] }, { ownerIds: ['2'] });
    expect(config).toMatchObject({ discordToken: 't', discordClientId: 'c', ownerIds: ['2'] });
  });

  it('falls back to the built-in values when the shared file is missing or broken', async () => {
    expect((await loadWithDefaults('{not json', {})).maxSessionsPerUser).toBe(10);
  });

  it('ships with the repository', async () => {
    vi.resetModules();
    const { REPO_DEFAULTS_PATH } = await import('./config.js');
    expect(JSON.parse(fs.readFileSync(REPO_DEFAULTS_PATH, 'utf8'))).toEqual(expect.objectContaining({ claudeModel: expect.any(String) }));
  });
});

describe('saveConfig', () => {
  it('writes only what config.json was given, so the shared values stay shared', async () => {
    vi.resetModules();
    const { saveConfig, CONFIG_PATH } = await import('./config.js');
    saveConfig({ discordToken: 't', discordClientId: 'c', ownerIds: ['1'] });
    expect(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))).toEqual({ discordToken: 't', discordClientId: 'c', ownerIds: ['1'] });
  });
});
