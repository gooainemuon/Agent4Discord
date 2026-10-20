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
//
// Or route by the session roster in the inbox README (roster.ts) instead of globs:
//
//   { "dir": ".planning/inbox", "roster": { "hub": "증류-총괄", "everyone": ["전레인"] } }
//
// The hub gets every file it did not send; any other lane gets the files whose name lists it after the
// sender, or has an `everyone` word. `hub` defaults to the lane named or formerly named 총괄,
// `everyone` to 전레인. The roster is read when the watch starts (`/a4d inbox on` re-reads it).
import fs from 'node:fs';
import path from 'node:path';
import { laneNames, parseRoster, readMessageName, type RosterEntry } from './roster.js';

export const INBOX_CONFIG_FILE = path.join('.claude', 'a4d-inbox.json');
const DEFAULT_INBOX_DIR = path.join('.planning', 'inbox');
const HUB_NAME = '총괄';
/** Never a message. */
const ALWAYS_EXCLUDED = new Set(['README.md']);

export interface LaneRule {
  /** Absolute inbox folder. */
  dir: string;
  include: string[];
  exclude: string[];
  /** Routing by the session roster; include/exclude are then unused. */
  roster?: RosterRoute;
}

export interface RosterRoute {
  /** The lane's name in the roster. */
  lane: string;
  hub: string;
  /** Every name and previous name to its lane. */
  names: Map<string, string>;
  everyone: string[];
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
  const dir = path.resolve(cwd, raw.dir);
  if (isObject(raw.roster)) return loadRosterRoute(dir, raw.roster, name);
  const base = isObject(raw.default) ? raw.default : {};
  const lane = isObject(raw.lanes) && isObject(raw.lanes[name]) ? raw.lanes[name] : {};
  const token = typeof lane.match === 'string' && lane.match ? lane.match : name;
  const include = stringList(lane.include) ?? stringList(base.include);
  const exclude = stringList(lane.exclude) ?? stringList(base.exclude) ?? [];
  if (!include?.length) {
    return { ok: false, reason: `${INBOX_CONFIG_FILE} 에 레인 ${name} 의 include 규칙이 없습니다` };
  }
  const fill = (p: string) => p.split('{lane}').join(token);
  return { ok: true, rule: { dir, include: include.map(fill), exclude: exclude.map(fill) } };
}

function readRosterIn(dir: string): RosterEntry[] | null {
  try {
    return parseRoster(fs.readFileSync(path.join(dir, 'README.md'), 'utf8'));
  } catch {
    return null;
  }
}

function loadRosterRoute(dir: string, config: Record<string, unknown>, name: string): InboxConfigResult {
  const roster = readRosterIn(dir);
  if (!roster?.length) return { ok: false, reason: `${path.join(dir, 'README.md')} 에 세션 명부(## 세션)가 없습니다` };
  const names = laneNames(roster);
  const lane = names.get(name.normalize('NFC'));
  if (!lane) return { ok: false, reason: `레인 ${name} 이 인박스 README 세션 명부에 없습니다` };
  const hub =
    typeof config.hub === 'string' && config.hub
      ? names.get(config.hub.normalize('NFC'))
      : (names.get(HUB_NAME) ?? roster.find((e) => e.name.endsWith(`-${HUB_NAME}`))?.name);
  if (!hub) return { ok: false, reason: `${INBOX_CONFIG_FILE} 의 roster.hub 레인을 명부에서 찾지 못했습니다` };
  const everyone = stringList(config.everyone) ?? ['전레인'];
  return { ok: true, rule: { dir, include: [], exclude: [], roster: { lane, hub, names, everyone } } };
}

/** The roster of the project at `cwd` (README.md in its inbox folder), or null when there is none. */
export function readRoster(cwd: string): RosterEntry[] | null {
  let dir = path.resolve(cwd, DEFAULT_INBOX_DIR);
  try {
    const config = JSON.parse(fs.readFileSync(path.join(cwd, INBOX_CONFIG_FILE), 'utf8'));
    if (typeof config?.dir === 'string' && config.dir) dir = path.resolve(cwd, config.dir);
  } catch {
    // no inbox rules: the usual folder
  }
  return readRosterIn(dir);
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
  if (rule.roster) {
    const { lane, hub, names, everyone } = rule.roster;
    if (!nfc.endsWith('.md')) return false;
    const m = readMessageName(nfc, names);
    if (m.sender === lane) return false;
    return lane === hub || m.recipients.has(lane) || m.tokens.some((t) => everyone.includes(t));
  }
  const hit = (g: string) => globToRegExp(g.normalize('NFC')).test(nfc);
  return rule.include.some(hit) && !rule.exclude.some(hit);
}
