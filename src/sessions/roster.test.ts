import fs from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseRoster, readRoster, rosterWarning } from './roster.js';

let proj: string;

beforeEach(() => {
  proj = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'a4d-roster-'));
});

afterEach(() => {
  fs.rmSync(proj, { recursive: true, force: true });
});

const README = `# 인박스

파일명: \`YYYY-MM-DD-HHMM-<보낸이>-<받는이>…-<제목>.md\`
- 첫 줄: 한 문장 요약.

## 세션

- 증류-총괄: 레인 조율, 사용자 보고
- **증류-데이터셋**: 코퍼스 수집·검증 (이전: 데이터셋, 데이터)
- \`증류-모델생성\`: 학생 모델 학습, 이전 세션명 모델생성

## 기타
- 정규화기: 이 절은 명부가 아니다
`;

describe('parseRoster', () => {
  it('reads the 세션 section only, with previous names in either form', () => {
    expect(parseRoster(README)).toEqual([
      { name: '증류-총괄', role: '레인 조율, 사용자 보고', previous: [] },
      { name: '증류-데이터셋', role: '코퍼스 수집·검증', previous: ['데이터셋', '데이터'] },
      { name: '증류-모델생성', role: '학생 모델 학습', previous: ['모델생성'] },
    ]);
  });

  it('is null when there is no 세션 section (a README that is not a roster yet)', () => {
    expect(parseRoster('# 총괄 인박스\n\n- 파일명: `YYYY-MM-DD-HHMM-<레인>.md`\n')).toBeNull();
  });
});

describe('readRoster', () => {
  it('reads README.md in the inbox folder from a4d-inbox.json, or .planning/inbox by default', () => {
    expect(readRoster(proj)).toBeNull();
    fs.mkdirSync(nodePath.join(proj, '.planning', 'inbox'), { recursive: true });
    fs.writeFileSync(nodePath.join(proj, '.planning', 'inbox', 'README.md'), README);
    expect(readRoster(proj)?.map((e) => e.name)).toEqual(['증류-총괄', '증류-데이터셋', '증류-모델생성']);

    fs.mkdirSync(nodePath.join(proj, '.claude'));
    fs.mkdirSync(nodePath.join(proj, 'mail'));
    fs.writeFileSync(nodePath.join(proj, '.claude', 'a4d-inbox.json'), JSON.stringify({ dir: 'mail' }));
    fs.writeFileSync(nodePath.join(proj, 'mail', 'README.md'), '## 세션\n- 혼자: 다 한다\n');
    expect(readRoster(proj)?.map((e) => e.name)).toEqual(['혼자']);
  });
});

describe('rosterWarning', () => {
  const roster = parseRoster(README)!;

  it('says nothing for a listed name or when the project has no roster', () => {
    expect(rosterWarning(roster, '증류-데이터셋')).toBeNull();
    expect(rosterWarning(roster, '증류-데이터셋'.normalize('NFD'))).toBeNull(); // macOS input
    expect(rosterWarning(null, '아무거나')).toBeNull();
  });

  it('names the current name for a previous one', () => {
    expect(rosterWarning(roster, '데이터셋')).toContain('증류-데이터셋');
  });

  it('lists the roster for an unknown name', () => {
    const warning = rosterWarning(roster, '증류-데이타셋');
    expect(warning).toContain('명부에 없');
    expect(warning).toContain('증류-총괄, 증류-데이터셋, 증류-모델생성');
  });
});
