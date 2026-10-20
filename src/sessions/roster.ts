// The project's session roster: the `## 세션` section of README.md in its inbox folder, kept by the
// project (usually 총괄), one lane per line:
//
//   ## 세션
//   - 증류-총괄: 레인 조율, 사용자 보고
//   - 증류-데이터셋: 코퍼스 수집·검증 (이전: 데이터셋)
//
// "이전 세션명 a, b" at the end of a line works too. For now the bot only warns when "너는 <세션명>"
// names a lane the roster does not list; inbox routing still follows .claude/a4d-inbox.json.
import fs from 'node:fs';
import path from 'node:path';
import { isValidSessionName } from './handoff.js';
import { INBOX_CONFIG_FILE } from './inboxConfig.js';

export interface RosterEntry {
  name: string;
  role: string;
  previous: string[];
}

const DEFAULT_INBOX_DIR = path.join('.planning', 'inbox');
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

function inboxDir(cwd: string): string {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(cwd, INBOX_CONFIG_FILE), 'utf8'));
    if (typeof config?.dir === 'string' && config.dir) return path.resolve(cwd, config.dir);
  } catch {
    // no inbox rules: the usual folder
  }
  return path.resolve(cwd, DEFAULT_INBOX_DIR);
}

/** The roster of the project at `cwd`, or null when its inbox README has none. */
export function readRoster(cwd: string): RosterEntry[] | null {
  try {
    return parseRoster(fs.readFileSync(path.join(inboxDir(cwd), 'README.md'), 'utf8'));
  } catch {
    return null;
  }
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
