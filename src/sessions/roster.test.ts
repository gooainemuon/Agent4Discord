import fs from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { laneNames, parseRoster, readMessageName, rosterWarning } from './roster.js';

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

describe('readMessageName', () => {
  // muon-micro-tts: session names carry a project prefix, file names use the short name.
  const names = laneNames(parseRoster(`## 세션
- esptts-총괄: 조율 (이전: 총괄)
- esptts-모델: 학습 (이전: 모델)
- esptts-앱: 앱 (이전: 앱)
- p4: 보드
`)!);

  it('reads the sender from the front and the lanes named after it, by full or previous name', () => {
    expect(readMessageName('2026-10-20-0017-분리-앱-p4-총괄-공유체크아웃.md', names)).toEqual({
      sender: undefined,
      recipients: new Set(['esptts-앱', 'p4', 'esptts-총괄']),
      tokens: ['분리', '앱', 'p4', '총괄', '공유체크아웃'],
    });
    expect(readMessageName('2026-10-19-esptts-총괄-모델-G1결과.md', names).sender).toBe('esptts-총괄');
    expect(readMessageName('2026-10-19-esptts-총괄-모델-G1결과.md', names).recipients).toEqual(new Set(['esptts-모델']));
  });

  it('skips the date, a time with a letter after it, and decomposed Hangul', () => {
    const m = readMessageName('2026-10-19-1920b-총괄-답-p4.md'.normalize('NFD'), names);
    expect(m.sender).toBe('esptts-총괄');
    expect(m.recipients).toEqual(new Set(['p4']));
  });

  it('only matches whole tokens', () => {
    expect(readMessageName('2026-10-19-총괄-모델생성-x.md', names).recipients).toEqual(new Set());
  });
});
