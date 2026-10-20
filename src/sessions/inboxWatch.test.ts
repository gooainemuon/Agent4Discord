import fs from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A stand-in for the session manager: one session per channel, sent messages recorded.
const fakeManager = vi.hoisted(() => ({ current: null as any }));
vi.mock('./sessionManager.js', () => ({
  get sessionManager() {
    return fakeManager.current;
  },
}));
vi.mock('./eventHandler.js', () => ({ startTyping: vi.fn() }));

let home: string;
let proj: string;
let inbox: string;
const realHome = process.env.HOME;
const GUILD = 'g1';
const LANE = '증류-데이터셋';

class FakeManager extends EventEmitter {
  sessions = new Map<string, any>();
  sent: string[] = [];
  getSession(channelId: string) {
    return this.sessions.get(channelId) ?? null;
  }
  sendMessage(channelId: string, content: string) {
    this.sent.push(content);
    this.sessions.get(channelId).state = 'running';
  }
}

function writeGuild(entry: Record<string, unknown> = {}): void {
  const dir = nodePath.join(home, '.agent4discord', 'guilds');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    nodePath.join(dir, `${GUILD}.json`),
    JSON.stringify({
      guildId: GUILD,
      activeSessions: { c1: { sessionId: 's1', cwd: proj, createdAt: '', userId: 'u1', sessionName: LANE, ...entry } },
    }),
  );
}

function readEntry(): any {
  return JSON.parse(fs.readFileSync(nodePath.join(home, '.agent4discord', 'guilds', `${GUILD}.json`), 'utf8')).activeSessions.c1;
}

function writeRules(): void {
  fs.mkdirSync(nodePath.join(proj, '.claude'), { recursive: true });
  fs.writeFileSync(
    nodePath.join(proj, '.claude', 'a4d-inbox.json'),
    JSON.stringify({
      dir: '.planning/inbox',
      default: { include: ['*총괄*{lane}*.md', '*총괄*-전레인-*.md'] },
      lanes: { [LANE]: { match: '데이터셋' } },
    }),
  );
}

const put = (name: string, text = '# 제목\n본문\n') => fs.writeFileSync(nodePath.join(inbox, name), text);
const TO_ME = '2026-10-20-1100-총괄-답-데이터셋-확인부탁.md';

let manager: FakeManager;
let channelSend: ReturnType<typeof vi.fn>;

async function load(sessionOverrides: Record<string, unknown> = {}) {
  const mod = await import('./inboxWatch.js');
  channelSend = vi.fn(async () => {});
  const client = { channels: { cache: { get: () => ({ isTextBased: () => true, send: channelSend }) } } } as any;
  mod.setupInboxWatch(client);
  const session = { guildId: GUILD, channelId: 'c1', cwd: proj, sessionName: LANE, state: 'idle', ...sessionOverrides };
  manager.sessions.set('c1', session);
  return { ...mod, session: session as any };
}

beforeEach(() => {
  home = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'a4d-inbox-'));
  proj = nodePath.join(home, 'proj');
  inbox = nodePath.join(proj, '.planning', 'inbox');
  fs.mkdirSync(inbox, { recursive: true });
  process.env.HOME = home;
  manager = new FakeManager();
  fakeManager.current = manager;
  vi.resetModules(); // CONFIG_DIR is computed from the home directory at import time
});

afterEach(async () => {
  (await import('./inboxWatch.js')).stopAllInboxWatches();
  process.env.HOME = realHome;
  fs.rmSync(home, { recursive: true, force: true });
});

describe('startInboxWatch', () => {
  it('needs a name, the watch on and the project rules', async () => {
    writeGuild();
    const { startInboxWatch, session } = await load();
    expect(startInboxWatch({ ...session, sessionName: undefined })).toEqual({ ok: false, reason: expect.any(String) });
    expect(startInboxWatch({ ...session, inboxWatch: false })).toEqual({ ok: false, reason: expect.any(String) });
    expect(startInboxWatch(session)).toEqual({ ok: false, reason: expect.stringContaining('a4d-inbox.json') });
    writeRules();
    expect(startInboxWatch(session)).toEqual({ ok: true, dir: inbox });
  });

  it('passes on a matching file written while the bot was down, not older ones', async () => {
    writeRules();
    put('2026-10-19-0900-총괄-답-데이터셋-옛날.md');
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(nodePath.join(inbox, '2026-10-19-0900-총괄-답-데이터셋-옛날.md'), old, old);
    writeGuild({ inboxCursor: { dir: inbox, since: Date.now() - 30_000 } });
    put(TO_ME);
    const { startInboxWatch, checkInbox, session } = await load();
    startInboxWatch(session);
    checkInbox('c1'); // settles
    expect(manager.sent).toHaveLength(1);
    expect(manager.sent[0]).toContain(TO_ME);
    expect(manager.sent[0]).not.toContain('옛날');
  });
  it('passes on a matching file that arrived after the session started, when no cursor is stored', async () => {
    // /a4d clear starts a fresh, unnamed session; a reply that lands before "너는 <세션명>" is still news.
    writeRules();
    writeGuild();
    const started = new Date(Date.now() - 30_000).toISOString();
    put('2026-10-19-0900-총괄-답-데이터셋-옛날.md');
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(nodePath.join(inbox, '2026-10-19-0900-총괄-답-데이터셋-옛날.md'), old, old);
    put(TO_ME);
    const { startInboxWatch, checkInbox, session } = await load({ createdAt: started });
    startInboxWatch(session);
    checkInbox('c1'); // settles
    expect(manager.sent).toHaveLength(1);
    expect(manager.sent[0]).toContain(TO_ME);
    expect(manager.sent[0]).not.toContain('옛날');
  });
});

describe('checkInbox', () => {
  it('passes on new files for this lane with their first lines, once their size settles', async () => {
    writeRules();
    writeGuild();
    put('2026-10-20-0900-총괄-답-데이터셋-이미있던것.md');
    const { startInboxWatch, checkInbox, session } = await load();
    startInboxWatch(session);

    put(TO_ME, '# 확인 부탁\n새 코퍼스 sha 확인\n');
    put('2026-10-20-1101-총괄-답-모델생성-다른레인.md');
    put('2026-10-20-1102-증류-데이터셋-보고.md'); // a lane report, for 총괄
    checkInbox('c1');
    expect(manager.sent).toEqual([]); // seen once; waits for the writer to finish

    checkInbox('c1');
    expect(manager.sent).toHaveLength(1);
    const msg = manager.sent[0];
    expect(msg).toContain('[A4D inbox]');
    expect(msg).toContain(`── ${nodePath.join(inbox, TO_ME)}\n# 확인 부탁\n새 코퍼스 sha 확인`);
    expect(msg).not.toContain('이미있던것');
    expect(msg).not.toContain('다른레인');
    expect(msg).not.toContain('보고.md');
    expect(channelSend).toHaveBeenCalledWith(expect.stringContaining(TO_ME));
    expect(readEntry().inboxCursor).toEqual({ dir: inbox, since: expect.any(Number) });
  });

  it('holds files while the session is busy and passes them on when the turn ends', async () => {
    writeRules();
    writeGuild();
    const { startInboxWatch, checkInbox, inboxWatchStatus, session } = await load({ state: 'running' });
    startInboxWatch(session);
    const since = readEntry().inboxCursor.since;
    put(TO_ME);
    checkInbox('c1');
    checkInbox('c1');
    expect(manager.sent).toEqual([]);
    expect(inboxWatchStatus('c1')?.waiting).toEqual([TO_ME]);
    expect(readEntry().inboxCursor.since).toBe(since); // a restart now would still find it

    session.state = 'idle';
    manager.emit('result', 'c1');
    expect(manager.sent).toHaveLength(1);
    expect(manager.sent[0]).toContain(TO_ME);
  });

  it('skips a file the session wrote itself', async () => {
    writeRules();
    writeGuild();
    const { startInboxWatch, checkInbox, session } = await load();
    startInboxWatch(session);
    const own = '2026-10-20-1105-데이터셋-총괄-데이터셋-질문.md'; // matches the rule, but is our own
    manager.emit('assistant', 'c1', {
      message: { content: [{ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: nodePath.join(inbox, own), content: 'q' } }] },
    });
    put(own);
    checkInbox('c1');
    checkInbox('c1');
    expect(manager.sent).toEqual([]);
  });

  it('stops when the session stops', async () => {
    writeRules();
    writeGuild();
    const { startInboxWatch, inboxWatchStatus, session } = await load();
    startInboxWatch(session);
    expect(inboxWatchStatus('c1')?.rule.dir).toBe(inbox);
    manager.emit('stopped', 'c1');
    expect(inboxWatchStatus('c1')).toBeNull();
  });
});
