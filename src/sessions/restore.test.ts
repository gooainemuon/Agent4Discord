import fs from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client, TextChannel } from 'discord.js';

let home: string;
const realHome = process.env.HOME;
const GUILD = 'g1';
const BOT = 'bot-1';

function writeGuild(activeSessions: Record<string, unknown>): void {
  const dir = nodePath.join(home, '.agent4discord', 'guilds');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, `${GUILD}.json`), JSON.stringify({ guildId: GUILD, activeSessions }));
}

function fakeChannel(id: string, sessionIdField: string) {
  const edit = vi.fn(async () => undefined);
  const statusMsg = {
    author: { id: BOT },
    embeds: [{ fields: [
      { name: 'Directory', value: '/proj' },
      { name: 'Model', value: 'opus' },
      { name: 'Session ID', value: sessionIdField },
    ] }],
    edit,
  };
  const channel = {
    id,
    messages: {
      fetchPins: async () => ({ items: [{ message: statusMsg }] }),
      fetch: async () => ({ find: () => undefined }),
    },
  } as unknown as TextChannel;
  return { channel, edit };
}

const client = { user: { id: BOT } } as unknown as Client;

beforeEach(() => {
  home = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'a4d-restore-'));
  process.env.HOME = home;
  vi.resetModules(); // CONFIG_DIR is computed from the home directory at import time
});

afterEach(() => {
  process.env.HOME = realHome;
  fs.rmSync(home, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function load() {
  const { sessionManager } = await import('./sessionManager.js');
  const resume = vi.spyOn(sessionManager, 'resumeSession').mockImplementation(
    () => ({ totalCostUsd: 0 }) as ReturnType<typeof sessionManager.resumeSession>,
  );
  const { restoreChannelSession } = await import('./restore.js');
  return { sessionManager, resume, restoreChannelSession };
}

describe('restoreChannelSession', () => {
  it('starts the resumed session with the effort stored for the channel and keeps it stored', async () => {
    writeGuild({ ch0: { sessionId: 'sid', cwd: '/proj', createdAt: 't', userId: 'u', effort: 'xhigh' } });
    const { resume, restoreChannelSession } = await load();
    const result = await restoreChannelSession(fakeChannel('ch0', 'sid').channel, GUILD, 'u', client);
    expect(result).toMatchObject({ ok: true, effort: 'xhigh' });
    expect(resume.mock.calls[0][10]).toBe('xhigh');
    const saved = JSON.parse(fs.readFileSync(nodePath.join(home, '.agent4discord', 'guilds', `${GUILD}.json`), 'utf-8'));
    expect(saved.activeSessions.ch0.effort).toBe('xhigh');
  });

  it('uses the id stored for the channel when the embed still says pending', async () => {
    writeGuild({ ch1: { sessionId: 'stored-id', cwd: '/proj', createdAt: 't', userId: 'u' } });
    const { resume, restoreChannelSession } = await load();
    const { channel, edit } = fakeChannel('ch1', 'pending');
    const result = await restoreChannelSession(channel, GUILD, 'u', client);
    expect(result).toMatchObject({ ok: true, sessionId: 'stored-id', cwd: '/proj' });
    expect(resume.mock.calls[0][3]).toBe('stored-id');
    expect(edit).toHaveBeenCalledOnce();
  });

  it('refuses a session that another channel already runs', async () => {
    writeGuild({});
    const { sessionManager, resume, restoreChannelSession } = await load();
    vi.spyOn(sessionManager, 'findActiveBySessionId').mockReturnValue(
      { channelId: 'other' } as ReturnType<typeof sessionManager.findActiveBySessionId>,
    );
    const result = await restoreChannelSession(fakeChannel('ch2', 'shared-id').channel, GUILD, 'u', client);
    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? '' : result.reason).toContain('<#other>');
    expect(resume).not.toHaveBeenCalled();
  });

  it('refuses when no id is known, instead of guessing the newest session in the directory', async () => {
    writeGuild({ ch3: { sessionId: '', cwd: '/proj', createdAt: 't', userId: 'u' } });
    const { resume, restoreChannelSession } = await load();
    const result = await restoreChannelSession(fakeChannel('ch3', 'pending').channel, GUILD, 'u', client);
    expect(result).toMatchObject({ ok: false });
    expect(resume).not.toHaveBeenCalled();
  });

  it('refuses a second restore of the same channel while the first is still running', async () => {
    writeGuild({ ch4: { sessionId: 'sid-4', cwd: '/proj', createdAt: 't', userId: 'u' } });
    const { resume, restoreChannelSession } = await load();
    const { channel } = fakeChannel('ch4', 'sid-4');
    const [a, b] = await Promise.all([
      restoreChannelSession(channel, GUILD, 'u', client),
      restoreChannelSession(channel, GUILD, 'u', client),
    ]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('refuses a session id that another path has claimed (Resume button in flight)', async () => {
    writeGuild({});
    const { sessionManager, resume, restoreChannelSession } = await load();
    expect(sessionManager.claimSessionId('sid-5')).toBe(true);
    const result = await restoreChannelSession(fakeChannel('ch5', 'sid-5').channel, GUILD, 'u', client);
    expect(result).toMatchObject({ ok: false });
    expect(resume).not.toHaveBeenCalled();
    sessionManager.releaseSessionId('sid-5');
  });
});

