import fs from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildBrowserMessage } from './directoryBrowser.js';

function json(msg: Awaited<ReturnType<typeof buildBrowserMessage>>) {
  return {
    description: msg.embeds[0].toJSON().description ?? '',
    components: msg.components.map((r) => r.toJSON().components) as unknown as { custom_id: string; label?: string }[][],
  };
}

describe('buildBrowserMessage', () => {
  it('names the current folder in the text and on the Session Start button', async () => {
    const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'a4d-browse-'));
    fs.mkdirSync(nodePath.join(dir, 'sub'));
    const m = json(await buildBrowserMessage(dir));
    expect(m.description).toContain(dir);
    const start = m.components[1].find((c) => c.custom_id === 'a4d:dir:start');
    expect(start?.label).toBe(`Session Start · ${nodePath.basename(dir)}`);
    expect(m.description).not.toContain('home directory');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('flags the home directory', async () => {
    const m = json(await buildBrowserMessage(os.homedir()));
    expect(m.description).toContain('home directory');
    expect(m.components[1].find((c) => c.custom_id === 'a4d:dir:start')?.label).toContain('home');
  });

  it('gives the folder select menu a new custom id on every render', async () => {
    const a = json(await buildBrowserMessage(os.tmpdir())).components[0][0].custom_id;
    await new Promise((r) => setTimeout(r, 5));
    const b = json(await buildBrowserMessage(os.tmpdir())).components[0][0].custom_id;
    expect(a.startsWith('a4d:dir:browse:')).toBe(true);
    expect(a).not.toBe(b);
  });
});
