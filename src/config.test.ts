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
  return loadConfig();
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
