// Shared query() options that give Discord sessions the user's Claude Code setup.
import fs from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';
import type { Options } from '@anthropic-ai/claude-agent-sdk';

/** Set in every Discord session so hooks and scripts can tell it apart from app/terminal sessions. */
export const SESSION_ENV_FLAG = 'A4D_SESSION';

const RULES_RELATIVE = nodePath.join('.claude', 'modes', 'discord.md');

const PREAMBLE =
  '이 세션은 Agent4Discord 를 통해 Discord 채널에서 돌아가는 CLI 세션이다. ' +
  '사용자는 Discord 로 메시지를 보내고 답을 읽는다. 앱(데스크톱) 세션 전용 규칙은 적용하지 않는다.';

/** Discord rule files in load order: global first, then the project's own. */
export function discordRulesPaths(cwd: string, homeDir: string = os.homedir()): string[] {
  const global = nodePath.join(homeDir, RULES_RELATIVE);
  const project = nodePath.join(cwd, RULES_RELATIVE);
  return project === global ? [global] : [global, project];
}

/** System prompt text appended to the claude_code preset. Missing or unreadable files are skipped. */
export function buildDiscordRules(cwd: string, homeDir: string = os.homedir()): string {
  const parts = [PREAMBLE];
  for (const file of discordRulesPaths(cwd, homeDir)) {
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf-8').trim();
    } catch {
      continue;
    }
    if (text) parts.push(`<!-- ${file} -->\n${text}`);
  }
  return parts.join('\n\n');
}

/**
 * Without settingSources the SDK runs in isolation mode: no CLAUDE.md, settings, permission
 * rules or hooks, and no Claude Code system prompt. Discord sessions should behave like the CLI.
 */
export function sessionContextOptions(
  cwd: string,
  homeDir: string = os.homedir(),
): Pick<Options, 'settingSources' | 'systemPrompt' | 'env'> {
  return {
    settingSources: ['user', 'project', 'local'],
    systemPrompt: { type: 'preset', preset: 'claude_code', append: buildDiscordRules(cwd, homeDir) },
    env: { ...process.env, [SESSION_ENV_FLAG]: '1' },
  };
}
