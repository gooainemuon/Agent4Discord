import fs from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let home: string;
const realHome = process.env.HOME;
const GUILD = 'g1';

function writeGuild(activeSessions: Record<string, unknown>): string {
  const dir = nodePath.join(home, '.agent4discord', 'guilds');
  fs.mkdirSync(dir, { recursive: true });
  const file = nodePath.join(dir, `${GUILD}.json`);
  fs.writeFileSync(file, JSON.stringify({ guildId: GUILD, activeSessions }));
  return file;
}

beforeEach(() => {
  home = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'a4d-store-'));
  process.env.HOME = home;
  vi.resetModules(); // CONFIG_DIR is computed from the home directory at import time
});

afterEach(() => {
  process.env.HOME = realHome;
  fs.rmSync(home, { recursive: true, force: true });
});

describe('updateSessionIdInGuild', () => {
  it('fills in the id of a channel saved without one and keeps the other fields', async () => {
    const file = writeGuild({ c1: { sessionId: '', cwd: '/p', createdAt: 't0', userId: 'u' } });
    const { updateSessionIdInGuild } = await import('./sessionStore.js');
    updateSessionIdInGuild(GUILD, 'c1', 'sid-1');
    const saved = JSON.parse(fs.readFileSync(file, 'utf-8')).activeSessions.c1;
    expect(saved).toEqual({ sessionId: 'sid-1', cwd: '/p', createdAt: 't0', userId: 'u' });
  });

  it('ignores channels it does not know', async () => {
    const file = writeGuild({});
    const { updateSessionIdInGuild } = await import('./sessionStore.js');
    updateSessionIdInGuild(GUILD, 'missing', 'sid-1');
    expect(JSON.parse(fs.readFileSync(file, 'utf-8')).activeSessions).toEqual({});
  });
});
