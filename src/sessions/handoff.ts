// Session lanes: a session named with "너는 <세션명>" hands its work over to the next session of the
// same name through a dated handoff folder (인계 노트, 인박스, 작업 로그).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ActiveSession } from './sessionManager.js';
import { knownHandoffRoots, updateSessionNameInGuild } from './sessionStore.js';

/** Files inside a handoff folder. */
export const HANDOFF_FILES = {
  note: 'HANDOFF.md', // 인계 노트
  inbox: 'INBOX.md', // 인박스
  worklog: 'WORKLOG.md', // 작업 로그
} as const;

const FILE_LABELS: Record<keyof typeof HANDOFF_FILES, string> = {
  note: '인계 노트',
  inbox: '인박스',
  worklog: '작업 로그',
};

/** Letters, digits, `.`, `_`, `-`; starts with a letter or digit; fits a folder name. */
const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,59}$/u;
const STAMP_PATTERN = /^(\d{4}-\d{2}-\d{2}-\d{4})-(.+)$/;

export function isValidSessionName(name: string): boolean {
  return NAME_PATTERN.test(name);
}

/**
 * The session name a message starting with "너는 <세션명>" assigns, or null. The name is the first
 * token after 너는; trailing clause punctuation (`.` `,` `:` `;`) is dropped so "너는 x. 이어서 해" works.
 */
export function parseSessionName(content: string): string | null {
  const m = /^\s*너는\s+(\S+)/u.exec(content);
  if (!m) return null;
  const name = m[1].replace(/[,.:;]+$/u, '');
  return isValidSessionName(name) ? name : null;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** `YYYY-MM-DD-hhmm-<세션명>` in local time. */
export function handoffFolderName(name: string, date: Date = new Date()): string {
  const stamp =
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}`;
  return `${stamp}-${name}`;
}

/** `dir` as given by the user: `~` expanded, relative paths taken from `cwd`. */
export function resolveHandoffRoot(dir: string, cwd: string, homeDir: string = os.homedir()): string {
  const expanded = dir === '~' ? homeDir : dir.startsWith('~/') ? path.join(homeDir, dir.slice(2)) : dir;
  return path.resolve(cwd, expanded);
}

/** Folders to look in for a session's handoffs: the remembered root for this cwd, then cwd itself. */
export function handoffRootsFor(guildId: string, cwd: string): string[] {
  return [...new Set([...knownHandoffRoots(guildId, cwd), cwd])];
}

export interface HandoffFolder {
  dir: string;
  /** The `YYYY-MM-DD-hhmm` prefix; sorts chronologically. */
  stamp: string;
  /** Which of the three files are present. */
  present: Record<keyof typeof HANDOFF_FILES, boolean>;
}

/** The newest `YYYY-MM-DD-hhmm-<name>` folder across `roots`, or null. Unreadable roots are skipped. */
export function findLatestHandoff(roots: string[], name: string, exclude?: string): HandoffFolder | null {
  let best: { dir: string; stamp: string } | null = null;
  for (const root of roots) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const m = STAMP_PATTERN.exec(entry.name);
      if (!m || m[2] !== name) continue;
      const dir = path.join(root, entry.name);
      if (exclude && path.resolve(dir) === path.resolve(exclude)) continue;
      if (!best || m[1] > best.stamp) best = { dir, stamp: m[1] };
    }
  }
  if (!best) return null;
  const present = Object.fromEntries(
    Object.entries(HANDOFF_FILES).map(([key, file]) => [key, fs.existsSync(path.join(best!.dir, file))]),
  ) as HandoffFolder['present'];
  return { ...best, present };
}

/** The bot's message to the session when the user runs /a4d handoff. */
export function buildHandoffPrompt(name: string, dir: string, previous: HandoffFolder | null): string {
  const prevNote = previous
    ? `이전 인계 폴더: ${previous.dir} (여기의 ${HANDOFF_FILES.inbox} 미처리 항목과 ${HANDOFF_FILES.worklog} 를 이어받아라)`
    : '이전 인계 폴더: 없음 (이 레인의 첫 인계다)';
  return [
    `[A4D handoff] 이 메시지는 사용자가 아니라 봇(/a4d handoff)이 보냈다.`,
    `세션명: ${name}`,
    `인계 폴더: ${dir} (이미 만들어져 있다)`,
    prevNote,
    '',
    `다음 세션이 "너는 ${name}"으로 시작하면 이 폴더의 세 파일을 읽고 이어간다. 지금 바로 세 파일을 작성하라.`,
    `1. ${HANDOFF_FILES.note} (인계 노트): 목표, 현재 상태, 결정 사항과 이유, 진행 중이거나 막힌 일, 다음 세션이 바로 할 일, 참고할 파일과 명령. ` +
      `백그라운드 감시(Monitor 등)는 이 세션이 끝나면 같이 꺼지므로 다시 띄우는 방법을 적어라.`,
    `2. ${HANDOFF_FILES.inbox} (인박스): 다른 세션이나 사람이 이 레인에 남긴 메시지 중 아직 처리하지 않은 것. ` +
      `이전 인계 폴더가 있으면 그곳의 미처리 항목을 옮겨 적어라. 없으면 "비어 있음"이라고 적어라.`,
    `3. ${HANDOFF_FILES.worklog} (작업 로그): 이전 작업 로그를 이어서, 이번 세션에서 한 일을 날짜와 시간과 함께 추가하라.`,
    '',
    `작성이 끝나면 사용자에게 폴더 경로와 한 단락 요약을 한 번만 보고하고, 새 작업은 시작하지 마라. ` +
      `이 세션은 사용자가 /a4d clear 또는 /a4d close 로 정리한다.`,
  ].join('\n');
}

/** Instructions prepended to the first user message of a session named with "너는 <세션명>". */
export function buildStartPrompt(
  name: string,
  found: HandoffFolder | null,
  roots: string[],
  userContent: string,
): string {
  const header = `[A4D session start] 이 세션의 이름은 "${name}"이다 (봇이 "너는 ${name}" 메시지에서 인식했다). 이 안내는 봇이 붙였다.`;
  let body: string;
  if (found) {
    const missing = (Object.keys(HANDOFF_FILES) as (keyof typeof HANDOFF_FILES)[])
      .filter((k) => !found.present[k])
      .map((k) => `${FILE_LABELS[k]}(${HANDOFF_FILES[k]})`);
    body = [
      `인계 폴더: ${found.dir}`,
      '시작 절차를 먼저 수행하라:',
      `1. 인계 노트 ${path.join(found.dir, HANDOFF_FILES.note)} 를 읽는다.`,
      `2. 인박스 ${path.join(found.dir, HANDOFF_FILES.inbox)} 를 읽고 미처리 항목을 확인한다.`,
      `3. 작업 로그 ${path.join(found.dir, HANDOFF_FILES.worklog)} 를 읽고 마지막 작업을 확인한다.`,
      '4. 사용자에게 보고한다: 현재 상태 요약, 인박스 미처리 항목, 마지막 작업, 다음에 할 일. ' +
        '인계 노트에 다시 띄우라고 적힌 백그라운드 작업이 있으면 보고한 뒤 띄운다.',
      ...(missing.length ? [`없는 파일: ${missing.join(', ')}. 없다고 보고하고 있는 파일만 읽는다.`] : []),
      '보고를 마친 뒤 아래 사용자 메시지를 처리한다.',
    ].join('\n');
  } else {
    body =
      `인계 폴더(YYYY-MM-DD-hhmm-${name})를 ${roots.join(', ')} 에서 찾지 못했다. ` +
      '이 레인은 새로 시작한다는 것을 사용자에게 한 줄로 알리고 아래 사용자 메시지를 처리한다. ' +
      '나중에 사용자가 /a4d handoff 를 실행하면 인계 폴더가 만들어진다.';
  }
  return `${header}\n${body}\n---\n${userContent}`;
}

export interface PreparedMessage {
  /** What goes to the session: the user's text, with the start procedure in front when a name was set. */
  content: string;
  /** One line for the channel when a session name was just recognised. */
  notice?: string;
}

/**
 * Recognise "너는 <세션명>" on a session that has no name yet: record the name, look up the newest
 * handoff folder for it and prepend the start procedure. Any other message passes through unchanged.
 */
export function prepareSessionMessage(session: ActiveSession, content: string): PreparedMessage {
  if (session.sessionName) return { content };
  const name = parseSessionName(content);
  if (!name) return { content };

  session.sessionName = name;
  try {
    updateSessionNameInGuild(session.guildId, session.channelId, name);
  } catch (err) {
    console.error('[handoff] Failed to persist session name:', err);
  }

  const roots = handoffRootsFor(session.guildId, session.cwd);
  const found = findLatestHandoff(roots, name);
  const notice = found
    ? `🏷️ 세션명 **${name}** 등록. 인계 폴더 \`${found.dir}\` 의 인계 노트·인박스·작업 로그를 읽고 보고하도록 시작 절차를 보냈습니다.`
    : `🏷️ 세션명 **${name}** 등록. 인계 폴더가 없어 새 레인으로 시작합니다. \`/a4d handoff\` 로 인계 폴더를 만들 수 있습니다.`;
  return { content: buildStartPrompt(name, found, roots, content), notice };
}
