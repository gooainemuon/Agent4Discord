import fs from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { INBOX_CONFIG_FILE, globToRegExp, isForLane, loadLaneRule } from './inboxConfig.js';

let proj: string;

function writeConfig(config: unknown): void {
  fs.mkdirSync(nodePath.join(proj, '.claude'), { recursive: true });
  fs.writeFileSync(nodePath.join(proj, INBOX_CONFIG_FILE), typeof config === 'string' ? config : JSON.stringify(config));
}

// The rules of a hub-and-spoke project: 총괄 gets every lane report, a lane gets what 총괄 sends it.
const HUB = {
  dir: '.planning/inbox',
  default: { include: ['*총괄*{lane}*.md', '*총괄*-전레인-*.md'] },
  lanes: {
    '증류-총괄': { include: ['*.md'], exclude: ['*총괄*'] },
    '증류-데이터셋': { match: '데이터셋' },
  },
};

beforeEach(() => {
  proj = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'a4d-inboxcfg-'));
});

afterEach(() => {
  fs.rmSync(proj, { recursive: true, force: true });
});

describe('loadLaneRule', () => {
  it('resolves dir, fills {lane} with the match alias and lets a lane replace the default rule', () => {
    writeConfig(HUB);
    const lane = loadLaneRule(proj, '증류-데이터셋');
    expect(lane).toEqual({
      ok: true,
      rule: { dir: nodePath.join(proj, '.planning/inbox'), include: ['*총괄*데이터셋*.md', '*총괄*-전레인-*.md'], exclude: [] },
    });
    const hub = loadLaneRule(proj, '증류-총괄');
    expect(hub.ok && hub.rule.include).toEqual(['*.md']);
    expect(hub.ok && hub.rule.exclude).toEqual(['*총괄*']);
    const plain = loadLaneRule(proj, '정규화기');
    expect(plain.ok && plain.rule.include[0]).toBe('*총괄*정규화기*.md');
  });

  it('says why when the file is missing, broken or has no rule for the lane', () => {
    expect(loadLaneRule(proj, 'x')).toEqual({ ok: false, reason: expect.stringContaining('없습니다') });
    writeConfig('{ not json');
    expect(loadLaneRule(proj, 'x')).toEqual({ ok: false, reason: expect.stringContaining('읽지 못했습니다') });
    writeConfig({ lanes: {} });
    expect(loadLaneRule(proj, 'x')).toEqual({ ok: false, reason: expect.stringContaining('dir') });
    writeConfig({ dir: 'inbox', lanes: { a: { include: ['*.md'] } } });
    expect(loadLaneRule(proj, 'b')).toEqual({ ok: false, reason: expect.stringContaining('include') });
  });
});

describe('isForLane', () => {
  it('routes real file names of a hub-and-spoke inbox', () => {
    writeConfig(HUB);
    const rule = (name: string) => {
      const r = loadLaneRule(proj, name);
      if (!r.ok) throw new Error(r.reason);
      return r.rule;
    };
    const fromLane = '2026-10-19-1902-증류-데이터셋-바꾸는날-끝.md';
    const toDataset = '2026-10-19-1920-총괄-답-데이터셋-1825접수-git밖폴더이동은총괄일괄.md';
    const toAll = '2026-10-19-1925-총괄-공지-전레인-바꾸는날2차이동끝.md';
    const toModel = '2026-10-19-1910-총괄-답-모델생성-1835접수-mlruns폴더그대로동의.md';

    expect([fromLane, toDataset, toAll, toModel, 'README.md'].filter((f) => isForLane(rule('증류-총괄'), f))).toEqual([fromLane]);
    expect([fromLane, toDataset, toAll, toModel, 'README.md'].filter((f) => isForLane(rule('증류-데이터셋'), f))).toEqual([toDataset, toAll]);
  });

  it('matches decomposed Hangul file names as macOS may list them', () => {
    const rule = { dir: '/x', include: ['*총괄*데이터셋*.md'], exclude: [] };
    expect(isForLane(rule, '2026-10-19-1920-총괄-답-데이터셋.md'.normalize('NFD'))).toBe(true);
  });
});

describe('globToRegExp', () => {
  it('treats * and ? as wildcards and everything else literally', () => {
    expect(globToRegExp('????-??-??-????-총괄-*').test('2026-10-19-1840-총괄-p4.md')).toBe(true);
    expect(globToRegExp('????-??-??-????-총괄-*').test('2026-10-19-1850-mlflow인프라-총괄-x.md')).toBe(false);
    expect(globToRegExp('a.md').test('aXmd')).toBe(false);
  });
});
