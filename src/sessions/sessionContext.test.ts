import fs from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildDiscordRules,
  discordRulesPaths,
  REPO_RULES_DIR,
  sessionContextOptions,
  SESSION_ENV_FLAG,
} from './sessionContext.js';

let root: string;
let home: string;
let project: string;
let repoRules: string; // the repository's rules/ (absent unless a test writes it)

function writeRules(dir: string, text: string): void {
  const file = nodePath.join(dir, '.claude', 'modes', 'discord.md');
  fs.mkdirSync(nodePath.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

beforeEach(() => {
  root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'a4d-ctx-'));
  home = nodePath.join(root, 'home');
  project = nodePath.join(root, 'project');
  repoRules = nodePath.join(root, 'rules');
  fs.mkdirSync(home);
  fs.mkdirSync(project);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('buildDiscordRules', () => {
  it('has only the preamble when no rule files exist', () => {
    const text = buildDiscordRules(project, home, repoRules);
    expect(text).toContain('Agent4Discord');
    expect(text).not.toContain('<!--');
  });

  it('appends global rules before project rules', () => {
    writeRules(home, 'GLOBAL RULE');
    writeRules(project, 'PROJECT RULE');
    const text = buildDiscordRules(project, home, repoRules);
    expect(text.indexOf('GLOBAL RULE')).toBeGreaterThan(0);
    expect(text.indexOf('PROJECT RULE')).toBeGreaterThan(text.indexOf('GLOBAL RULE'));
  });

  it('reads the global file once when cwd is the home directory', () => {
    writeRules(home, 'GLOBAL RULE');
    expect(discordRulesPaths(home, home, repoRules).filter((f) => f.startsWith(home))).toHaveLength(1);
    expect(buildDiscordRules(home, home, repoRules).split('GLOBAL RULE')).toHaveLength(2);
  });

  it('starts with the repository rules every device shares, then the device, then the project', () => {
    fs.mkdirSync(repoRules);
    fs.writeFileSync(nodePath.join(repoRules, 'discord.md'), 'SHARED RULE');
    fs.writeFileSync(nodePath.join(repoRules, 'handoff.md'), 'HANDOFF RULE');
    writeRules(home, 'DEVICE RULE');
    writeRules(project, 'PROJECT RULE');
    const text = buildDiscordRules(project, home, repoRules);
    const order = ['SHARED RULE', 'HANDOFF RULE', 'DEVICE RULE', 'PROJECT RULE'].map((r) => text.indexOf(r));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('ships the shared rules with the repository', () => {
    for (const f of ['discord.md', 'handoff.md']) expect(fs.existsSync(nodePath.join(REPO_RULES_DIR, f))).toBe(true);
    // They must not point at files only one device has.
    expect(fs.readFileSync(nodePath.join(REPO_RULES_DIR, 'discord.md'), 'utf8')).not.toContain('~/.claude/modes/handoff.md');
  });

  it('skips empty files', () => {
    writeRules(project, '  \n');
    expect(buildDiscordRules(project, home, repoRules)).not.toContain('<!--');
  });
});

describe('sessionContextOptions', () => {
  it('loads filesystem settings, the claude_code preset and flags the session', () => {
    const opts = sessionContextOptions(project, home, repoRules);
    expect(opts.settingSources).toEqual(['user', 'project', 'local']);
    expect(opts.systemPrompt).toMatchObject({ type: 'preset', preset: 'claude_code' });
    expect(opts.env?.[SESSION_ENV_FLAG]).toBe('1');
    expect(opts.env?.PATH).toBe(process.env.PATH);
  });
});
