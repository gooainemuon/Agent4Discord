import fs from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let home: string;
let project: string;
const realHome = process.env.HOME;

beforeEach(() => {
  home = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'a4d-browse-home-'));
  project = nodePath.join(home, 'ain', 'esp-tts');
  fs.mkdirSync(nodePath.join(project, 'model'), { recursive: true });
  process.env.HOME = home; // the state store lives under ~/.agent4discord
  vi.resetModules();
});

afterEach(() => {
  process.env.HOME = realHome;
  fs.rmSync(home, { recursive: true, force: true });
});

async function render(dir: string) {
  const { buildBrowserMessage } = await import('./directoryBrowser.js');
  const msg = await buildBrowserMessage(dir);
  const rows = msg.components.map((r) => r.toJSON().components) as unknown as { custom_id: string; label?: string }[][];
  return { description: msg.embeds[0].toJSON().description ?? '', rows };
}

describe('buildBrowserMessage', () => {
  it('names the current folder in the text and on the Session Start button', async () => {
    const { splitStateKey } = await import('./browserState.js');
    const m = await render(project);
    expect(m.description).toContain('~/ain/esp-tts');
    const start = m.rows[1].find((c) => splitStateKey(c.custom_id).base === 'a4d:dir:start');
    expect(start?.label).toBe('Session Start · esp-tts');
    expect(m.description).not.toContain('home directory');
    expect((m.rows[0][0] as { placeholder?: string }).placeholder).toContain('~/ain/esp-tts');
  });

  it('flags the home directory', async () => {
    const { splitStateKey } = await import('./browserState.js');
    const m = await render(home);
    expect(m.description).toContain('home directory');
    expect(m.rows[1].find((c) => splitStateKey(c.custom_id).base === 'a4d:dir:start')?.label).toContain('home');
  });

  it('carries the folder on every component, so a hidden embed does not lose it', async () => {
    const { splitStateKey, loadBrowserState } = await import('./browserState.js');
    const m = await render(project);
    for (const c of m.rows.flat()) {
      expect(loadBrowserState(splitStateKey(c.custom_id).key)?.path).toBe(project);
      expect(c.custom_id.length).toBeLessThanOrEqual(100);
    }
  });

  it('keeps the folder across a bot restart (state is on disk)', async () => {
    const m = await render(project);
    const key = m.rows[1][0].custom_id.split('~').pop();
    vi.resetModules(); // drop the in-memory cache, as a restart would
    const { loadBrowserState } = await import('./browserState.js');
    expect(loadBrowserState(key)?.path).toBe(project);
  });

  it('gives the folder select menu a new custom id on every render', async () => {
    const a = (await render(project)).rows[0][0].custom_id;
    await new Promise((r) => setTimeout(r, 5));
    const b = (await render(project)).rows[0][0].custom_id;
    expect(a.startsWith('a4d:dir:browse:')).toBe(true);
    expect(a).not.toBe(b);
  });
});
