import fs from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildDiscordRules, discordRulesPaths, sessionContextOptions, SESSION_ENV_FLAG } from './sessionContext.js';

let root: string;
let home: string;
let project: string;

function writeRules(dir: string, text: string): void {
  const file = nodePath.join(dir, '.claude', 'modes', 'discord.md');
  fs.mkdirSync(nodePath.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

beforeEach(() => {
  root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'a4d-ctx-'));
  home = nodePath.join(root, 'home');
  project = nodePath.join(root, 'project');
  fs.mkdirSync(home);
  fs.mkdirSync(project);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('buildDiscordRules', () => {
  it('has only the preamble when no rule files exist', () => {
    const text = buildDiscordRules(project, home);
    expect(text).toContain('Agent4Discord');
    expect(text).not.toContain('<!--');
  });

  it('appends global rules before project rules', () => {
    writeRules(home, 'GLOBAL RULE');
    writeRules(project, 'PROJECT RULE');
    const text = buildDiscordRules(project, home);
    expect(text.indexOf('GLOBAL RULE')).toBeGreaterThan(0);
    expect(text.indexOf('PROJECT RULE')).toBeGreaterThan(text.indexOf('GLOBAL RULE'));
  });

  it('reads the global file once when cwd is the home directory', () => {
    writeRules(home, 'GLOBAL RULE');
    expect(discordRulesPaths(home, home)).toHaveLength(1);
    expect(buildDiscordRules(home, home).split('GLOBAL RULE')).toHaveLength(2);
  });

  it('skips empty files', () => {
    writeRules(project, '  \n');
    expect(buildDiscordRules(project, home)).not.toContain('<!--');
  });
});

describe('sessionContextOptions', () => {
  it('loads filesystem settings, the claude_code preset and flags the session', () => {
    const opts = sessionContextOptions(project, home);
    expect(opts.settingSources).toEqual(['user', 'project', 'local']);
    expect(opts.systemPrompt).toMatchObject({ type: 'preset', preset: 'claude_code' });
    expect(opts.env?.[SESSION_ENV_FLAG]).toBe('1');
    expect(opts.env?.PATH).toBe(process.env.PATH);
  });
});
