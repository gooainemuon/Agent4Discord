import fs from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let home: string;
let proj: string;
const realHome = process.env.HOME;
const GUILD = 'g1';

function writeGuild(extra: Record<string, unknown> = {}): void {
  const dir = nodePath.join(home, '.agent4discord', 'guilds');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    nodePath.join(dir, `${GUILD}.json`),
    JSON.stringify({ guildId: GUILD, activeSessions: { c1: { sessionId: 's1', cwd: proj, createdAt: '', userId: 'u1' } }, ...extra }),
  );
}

function readGuild(): any {
  return JSON.parse(fs.readFileSync(nodePath.join(home, '.agent4discord', 'guilds', `${GUILD}.json`), 'utf8'));
}

function mkHandoff(root: string, folder: string, files: string[] = []): string {
  const dir = nodePath.join(root, folder);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of files) fs.writeFileSync(nodePath.join(dir, f), '#');
  return dir;
}

beforeEach(() => {
  home = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'a4d-handoff-'));
  proj = nodePath.join(home, 'proj');
  fs.mkdirSync(proj);
  process.env.HOME = home;
  vi.resetModules(); // CONFIG_DIR is computed from the home directory at import time
});

afterEach(() => {
  process.env.HOME = realHome;
  fs.rmSync(home, { recursive: true, force: true });
});

const load = () => import('./handoff.js');

describe('parseSessionName', () => {
  it('takes the first token after 너는', async () => {
    const { parseSessionName } = await load();
    expect(parseSessionName('너는 증류-모델생성')).toBe('증류-모델생성');
    expect(parseSessionName('  너는   lane_2.0\n어제 하던 거 이어서')).toBe('lane_2.0');
    expect(parseSessionName('너는 증류-모델생성. 이어서 해')).toBe('증류-모델생성');
  });

  it('rejects other messages and names that cannot be a folder', async () => {
    const { parseSessionName } = await load();
    expect(parseSessionName('안녕 너는 x')).toBeNull();
    expect(parseSessionName('너는 누구야?')).toBeNull();
    expect(parseSessionName('너는 a/b')).toBeNull();
    expect(parseSessionName('너는 -x')).toBeNull();
    expect(parseSessionName('너는')).toBeNull();
    expect(parseSessionName('')).toBeNull();
  });
});

describe('handoffFolderName / resolveHandoffRoot', () => {
  it('formats YYYY-MM-DD-hhmm-<name> in local time', async () => {
    const { handoffFolderName } = await load();
    expect(handoffFolderName('증류-모델생성', new Date(2026, 9, 19, 20, 13))).toBe('2026-10-19-2013-증류-모델생성');
    expect(handoffFolderName('x', new Date(2026, 0, 2, 3, 4))).toBe('2026-01-02-0304-x');
  });

  it('resolves relative dirs against cwd and expands ~', async () => {
    const { resolveHandoffRoot } = await load();
    expect(resolveHandoffRoot('.planning/handoff', '/w', '/h')).toBe('/w/.planning/handoff');
    expect(resolveHandoffRoot('~/notes', '/w', '/h')).toBe('/h/notes');
    expect(resolveHandoffRoot('/abs', '/w', '/h')).toBe('/abs');
  });
});

describe('findLatestHandoff', () => {
  it('returns the newest folder of that name across roots and reports which files exist', async () => {
    const { findLatestHandoff, HANDOFF_FILES } = await load();
    const other = nodePath.join(home, 'other');
    mkHandoff(proj, '2026-10-18-0900-lane', [HANDOFF_FILES.note]);
    const newest = mkHandoff(other, '2026-10-19-2013-lane', [HANDOFF_FILES.note, HANDOFF_FILES.inbox]);
    mkHandoff(proj, '2026-10-20-0000-otherlane');
    fs.writeFileSync(nodePath.join(proj, '2026-10-21-0000-lane'), 'a file, not a folder');

    const found = findLatestHandoff([proj, other, nodePath.join(home, 'missing')], 'lane');
    expect(found?.kind).toBe('folder');
    expect(found?.path).toBe(newest);
    expect(found?.stamp).toBe('2026-10-19-2013');
    expect(found?.kind === 'folder' && found.present).toEqual({ note: true, inbox: true, worklog: false });
  });

  it('also finds note files (YYYY-MM-DD-hhmm-<name>.md), newest stamp first', async () => {
    const { findLatestHandoff } = await load();
    const root = nodePath.join(proj, '.planning', 'handoff');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(nodePath.join(root, '2026-10-19-1836-증류-데이터셋.md'), '#');
    const newest = nodePath.join(root, '2026-10-19-2012-증류-데이터셋.md');
    fs.writeFileSync(newest, '#');
    fs.writeFileSync(nodePath.join(root, '2026-10-20-0900-증류-총괄.md'), '#');
    fs.writeFileSync(nodePath.join(root, '2026-10-21-0900-데이터셋.md'), '#'); // another lane name
    mkHandoff(proj, '2026-10-18-0900-증류-데이터셋');

    expect(findLatestHandoff([root, proj], '증류-데이터셋')).toEqual({ kind: 'note', path: newest, stamp: '2026-10-19-2012' });
    expect(findLatestHandoff([root], '증류-데이터셋'.normalize('NFD'))?.path).toBe(newest);
    expect(findLatestHandoff([root], '증류-데이터셋', newest)?.stamp).toBe('2026-10-19-1836');
  });

  it('skips the excluded folder and returns null when nothing matches', async () => {
    const { findLatestHandoff } = await load();
    const only = mkHandoff(proj, '2026-10-19-2013-lane');
    expect(findLatestHandoff([proj], 'lane', only)).toBeNull();
    expect(findLatestHandoff([proj], 'nope')).toBeNull();
  });
});

describe('handoffRootsFor / usesHandoffNotes', () => {
  it("puts the project's .planning/handoff/ after a remembered root and before the directory", async () => {
    writeGuild();
    const { handoffRootsFor, usesHandoffNotes } = await load();
    const project = nodePath.join(proj, '.planning', 'handoff');
    // New handoffs go to .planning/handoff/ even before it exists; the directory is only searched.
    expect(handoffRootsFor(GUILD, proj)).toEqual([project, proj]);
    fs.mkdirSync(project, { recursive: true });
    expect(handoffRootsFor(GUILD, proj)).toEqual([project, proj]);
    expect(usesHandoffNotes(project, proj)).toBe(true);
    expect(usesHandoffNotes(proj, proj)).toBe(false);

    const other = nodePath.join(home, 'notes');
    fs.mkdirSync(other);
    expect(usesHandoffNotes(other, proj)).toBe(false);
    fs.writeFileSync(nodePath.join(other, '2026-10-19-2012-lane.md'), '#');
    expect(usesHandoffNotes(other, proj)).toBe(true);
  });
});

describe('prepareSessionMessage', () => {
  function session(sessionName?: string) {
    return { guildId: GUILD, channelId: 'c1', cwd: proj, sessionName } as any;
  }

  it('names the session once, persists it and prepends the start procedure with the folder paths', async () => {
    writeGuild();
    const { prepareSessionMessage, HANDOFF_FILES } = await load();
    const dir = mkHandoff(proj, '2026-10-19-2013-lane', [HANDOFF_FILES.note, HANDOFF_FILES.worklog]);
    const s = session();

    const first = prepareSessionMessage(s, '너는 lane\n어제 하던 거 이어서');
    expect(s.sessionName).toBe('lane');
    expect(readGuild().activeSessions.c1.sessionName).toBe('lane');
    expect(first.notice).toContain('lane');
    expect(first.notice).toContain(dir);
    expect(first.content).toContain(nodePath.join(dir, HANDOFF_FILES.note));
    expect(first.content).toContain(nodePath.join(dir, HANDOFF_FILES.inbox));
    expect(first.content).toContain('없는 파일: 인박스(INBOX.md)');
    expect(first.content.endsWith('---\n너는 lane\n어제 하던 거 이어서')).toBe(true);

    const second = prepareSessionMessage(s, '너는 other');
    expect(second).toEqual({ content: '너는 other' });
    expect(s.sessionName).toBe('lane');
  });

  it('looks in the remembered handoff root for this directory first', async () => {
    const root = nodePath.join(home, 'planning');
    writeGuild({ handoffRoots: { [proj]: root } });
    const { prepareSessionMessage } = await load();
    mkHandoff(proj, '2026-10-18-0900-lane');
    const newest = mkHandoff(root, '2026-10-19-2013-lane');
    const out = prepareSessionMessage(session(), '너는 lane');
    expect(out.content).toContain(`인계 폴더: ${newest}`);
  });

  it('starts from the newest note in .planning/handoff/', async () => {
    writeGuild();
    const { prepareSessionMessage } = await load();
    const root = nodePath.join(proj, '.planning', 'handoff');
    fs.mkdirSync(root, { recursive: true });
    const note = nodePath.join(root, '2026-10-19-2012-증류-데이터셋.md');
    fs.writeFileSync(note, '#');
    const out = prepareSessionMessage(session(), '너는 증류-데이터셋');
    expect(out.notice).toContain(`인계 노트 \`${note}\``);
    expect(out.content).toContain(`인계 노트: ${note}`);
    expect(out.content).toContain('받는 쪽이 먼저 읽을 것');
    expect(out.content).toContain(`## HH:MM 이어받음 (${note})`);
    expect(out.content).not.toContain('INBOX.md');
  });

  it('starts a new lane when no folder exists and passes other messages through', async () => {
    writeGuild();
    const { prepareSessionMessage } = await load();
    const s = session();
    const out = prepareSessionMessage(s, '너는 fresh');
    expect(s.sessionName).toBe('fresh');
    expect(out.notice).toContain('새 레인');
    expect(out.content).toContain('찾지 못했다');
    expect(out.content).toContain(proj);

    expect(prepareSessionMessage(session(), '그냥 질문')).toEqual({ content: '그냥 질문' });
    expect(prepareSessionMessage(session(), '')).toEqual({ content: '' });
  });
});

describe('buildHandoffPrompt', () => {
  it('names the folder, the three files and the previous folder', async () => {
    const { buildHandoffPrompt, HANDOFF_FILES } = await load();
    const prev = { kind: 'folder' as const, path: '/p/2026-10-18-0900-lane', stamp: '2026-10-18-0900', present: { note: true, inbox: true, worklog: true } };
    const text = buildHandoffPrompt('lane', '/p/2026-10-19-2013-lane', prev);
    expect(text).toContain('/p/2026-10-19-2013-lane');
    expect(text).toContain('이전 인계 폴더: /p/2026-10-18-0900-lane');
    for (const f of Object.values(HANDOFF_FILES)) expect(text).toContain(f);
    expect(buildHandoffPrompt('lane', '/p/x', null)).toContain('첫 인계');
  });

  it('asks for one new note file in note form', async () => {
    const { buildHandoffPrompt } = await load();
    const prev = { kind: 'note' as const, path: '/p/.planning/handoff/2026-10-18-0900-lane.md', stamp: '2026-10-18-0900' };
    const text = buildHandoffPrompt('lane', '/p/.planning/handoff/2026-10-19-2013-lane.md', prev, 'note');
    expect(text).toContain('인계 노트: /p/.planning/handoff/2026-10-19-2013-lane.md (아직 없다');
    expect(text).toContain('이전 인계 노트: /p/.planning/handoff/2026-10-18-0900-lane.md');
    expect(text).toContain('이미 있는 노트는 고치지 않는다');
    expect(text).not.toContain('INBOX.md');
  });
});
