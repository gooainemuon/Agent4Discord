// The project's session roster: the `## 세션` section of README.md in its inbox folder, kept by the
// project (usually 총괄), one lane per line:
//
//   ## 세션
//   - 증류-총괄: 레인 조율, 사용자 보고
//   - 증류-데이터셋: 코퍼스 수집·검증 (이전: 데이터셋)
//
// "이전 세션명 a, b" at the end of a line works too. The bot warns when "너는 <세션명>" names a lane
// the roster does not list, and a project can route its inbox by the roster (see inboxConfig.ts):
// a file name says who sent it and whom it is for, by the lanes' names or previous names.
import { isValidSessionName } from './handoff.js';

export interface RosterEntry {
  name: string;
  role: string;
  previous: string[];
}

const PREVIOUS = [
  /\s*\(\s*이전(?:\s*세션명)?\s*:?\s*([^)]*)\)\s*$/u, // (이전: a, b)
  /\s*,?\s*이전\s*세션명\s*:?\s*(.+)$/u, // , 이전 세션명 a, b
];

/** The roster in a README, or null when it has no `## 세션` section. */
export function parseRoster(markdown: string): RosterEntry[] | null {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+세션/u.test(l.normalize('NFC')));
  if (start < 0) return null;
  const entries: RosterEntry[] = [];
  for (const raw of lines.slice(start + 1)) {
    const line = raw.normalize('NFC');
    if (/^#{1,2}\s/u.test(line)) break;
    const m = /^\s*[-*]\s+(.+?)\s*:\s*(.*)$/u.exec(line);
    if (!m) continue;
    const name = m[1].replace(/[*`]/gu, '').trim();
    if (!isValidSessionName(name)) continue;
    let role = m[2].trim();
    let previous: string[] = [];
    for (const re of PREVIOUS) {
      const p = re.exec(role);
      if (!p) continue;
      previous = p[1].split(',').map((s) => s.replace(/[*`]/gu, '').trim()).filter(Boolean);
      role = role.slice(0, p.index).trim();
      break;
    }
    entries.push({ name, role, previous });
  }
  return entries;
}

/** A line for the channel when `name` is not a current lane of the roster, otherwise null. */
export function rosterWarning(roster: RosterEntry[] | null, name: string): string | null {
  if (!roster) return null;
  const n = name.normalize('NFC');
  if (roster.some((e) => e.name === n)) return null;
  const renamed = roster.find((e) => e.previous.includes(n));
  if (renamed) return `⚠️ \`${n}\` 은 이전 세션명입니다. 지금 이름은 \`${renamed.name}\` 입니다(인박스 README 명부).`;
  const names = roster.map((e) => e.name).join(', ') || '(비어 있음)';
  return `⚠️ \`${n}\` 은 인박스 README 세션 명부에 없습니다. 명부: ${names}. 새 레인이면 총괄에게 명부에 올려 달라고 하세요.`;
}

/** Every name a lane goes by (its name and previous names) to the lane's name. The first lane wins. */
export function laneNames(roster: RosterEntry[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const e of roster) {
    for (const n of [e.name, ...e.previous]) if (!names.has(n)) names.set(n, e.name);
  }
  return names;
}

export interface MessageName {
  /** The lane that wrote the file, when its first word names one. */
  sender: string | undefined;
  /** Lanes named after the sender. */
  recipients: Set<string>;
  /** The words of the name after the date and time. */
  tokens: string[];
}

/** 2026-10-19-, 2026-10-19-1920-, 2026-10-19-1920b- */
const DATE_TIME = /^\d{4}-\d{2}-\d{2}-(?:\d{4}[a-z]*-)?/u;

/**
 * Read an inbox file name like `2026-10-20-0017-분리-앱-p4-총괄-<제목>.md`: the first word is the
 * sender, later words that are lane names are recipients. Names with hyphens (esptts-총괄) count as
 * one word, the longest match first.
 */
export function readMessageName(fileName: string, names: ReadonlyMap<string, string>): MessageName {
  const tokens = fileName.normalize('NFC').replace(/\.md$/u, '').replace(DATE_TIME, '').split('-').filter(Boolean);
  const longest = Math.max(1, ...[...names.keys()].map((n) => n.split('-').length));
  const laneAt = (i: number): { lane: string; words: number } | undefined => {
    for (let words = Math.min(longest, tokens.length - i); words >= 1; words--) {
      const lane = names.get(tokens.slice(i, i + words).join('-'));
      if (lane) return { lane, words };
    }
    return undefined;
  };
  const first = laneAt(0);
  const recipients = new Set<string>();
  for (let i = first?.words ?? 1; i < tokens.length; ) {
    const hit = laneAt(i);
    if (hit) recipients.add(hit.lane);
    i += hit?.words ?? 1;
  }
  return { sender: first?.lane, recipients, tokens };
}
