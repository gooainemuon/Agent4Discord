// Project inbox rules: which new files in the project's inbox folder are for which lane. Projects
// keep one message per file (e.g. .planning/inbox/2026-10-19-1910-총괄-답-모델생성-….md) and route by
// file name, with rules that differ per project, so the project states them in .claude/a4d-inbox.json:
//
//   {
//     "dir": ".planning/inbox",
//     "default": { "include": ["*총괄*{lane}*.md", "*총괄*-전레인-*.md"] },
//     "lanes": {
//       "증류-총괄": { "include": ["*.md"], "exclude": ["*총괄*"] },
//       "증류-데이터셋": { "match": "데이터셋" }
//     }
//   }
//
// `{lane}` stands for the lane's `match` (default: the session name). A lane entry's include/exclude
// replace the default ones. Patterns are file-name globs: `*` any run of characters, `?` one.
import fs from 'node:fs';
import path from 'node:path';

export const INBOX_CONFIG_FILE = path.join('.claude', 'a4d-inbox.json');
/** Never a message. */
const ALWAYS_EXCLUDED = new Set(['README.md']);

export interface LaneRule {
  /** Absolute inbox folder. */
  dir: string;
  include: string[];
  exclude: string[];
}

export type InboxConfigResult = { ok: true; rule: LaneRule } | { ok: false; reason: string };

function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((v) => typeof v === 'string') ? value : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The inbox rule of lane `name` in the project at `cwd`, or why there is none. */
export function loadLaneRule(cwd: string, name: string): InboxConfigResult {
  const file = path.join(cwd, INBOX_CONFIG_FILE);
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    const missing = (err as NodeJS.ErrnoException).code === 'ENOENT';
    return { ok: false, reason: missing ? `${INBOX_CONFIG_FILE} 가 없습니다` : `${INBOX_CONFIG_FILE} 를 읽지 못했습니다: ${(err as Error).message}` };
  }
  if (!isObject(raw) || typeof raw.dir !== 'string' || !raw.dir) {
    return { ok: false, reason: `${INBOX_CONFIG_FILE} 에 dir(인박스 폴더)이 없습니다` };
  }
  const base = isObject(raw.default) ? raw.default : {};
  const lane = isObject(raw.lanes) && isObject(raw.lanes[name]) ? raw.lanes[name] : {};
  const token = typeof lane.match === 'string' && lane.match ? lane.match : name;
  const include = stringList(lane.include) ?? stringList(base.include);
  const exclude = stringList(lane.exclude) ?? stringList(base.exclude) ?? [];
  if (!include?.length) {
    return { ok: false, reason: `${INBOX_CONFIG_FILE} 에 레인 ${name} 의 include 규칙이 없습니다` };
  }
  const fill = (p: string) => p.split('{lane}').join(token);
  return { ok: true, rule: { dir: path.resolve(cwd, raw.dir), include: include.map(fill), exclude: exclude.map(fill) } };
}

const globCache = new Map<string, RegExp>();

/** `*` = any characters, `?` = one character; everything else literal; whole name. */
export function globToRegExp(glob: string): RegExp {
  let re = globCache.get(glob);
  if (!re) {
    const body = [...glob]
      .map((c) => (c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[.+^${}()|[\]\\]/g, '\\$&')))
      .join('');
    re = new RegExp(`^${body}$`, 'u');
    globCache.set(glob, re);
  }
  return re;
}

/** Whether a file in the inbox folder is a message for the lane. */
export function isForLane(rule: LaneRule, fileName: string): boolean {
  if (ALWAYS_EXCLUDED.has(fileName)) return false;
  const nfc = fileName.normalize('NFC'); // macOS may hand back decomposed Hangul
  const hit = (g: string) => globToRegExp(g.normalize('NFC')).test(nfc);
  return rule.include.some(hit) && !rule.exclude.some(hit);
}
