import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Decides which tool calls the bot may run without a Discord prompt.
 *
 * The SDK applies the rules of ~/.claude/settings.json only to the literal command, so `git -C <dir> log`,
 * `cd <dir> && ...` and every read outside the session cwd reached canUseTool: several prompts a second.
 * The user wants only sensitive calls asked (2026-10-02). So this is a deny list: each piece of a compound
 * command is checked against the ask/deny rules of the settings plus the destructive or outward-facing
 * commands below, and everything else is allowed.
 */

/** Commands that delete, overwrite, kill, install or reach outside: always asked. */
const SENSITIVE_COMMANDS = new Set([
  'rm', 'rmdir', 'mv', 'unlink', 'shred', 'dd', 'mkfs', 'diskutil', 'chown', 'chmod', 'chflags',
  'sudo', 'su', 'doas', 'kill', 'pkill', 'killall', 'shutdown', 'reboot', 'halt', 'launchctl', 'crontab',
  'scp', 'rsync', 'sftp', 'ftp', 'docker', 'eval', 'osascript', 'defaults',
]);

/** Leading words that run the rest of the segment as the real command. */
const WRAPPERS = new Set(['xargs', 'env', 'nohup', 'time', 'command', 'exec', 'nice', 'timeout', 'caffeinate']);

/** Shell keywords that start a segment without being the command. */
const KEYWORDS = new Set(['do', 'then', 'else', 'elif', '!', '{', '(']);

/** git subcommands that rewrite history or drop work. A plain push is allowed, a force push is not (user 2026-10-02). */
const SENSITIVE_GIT = /^(push\s(.*\s)?(--force\S*|-[a-zA-Z]*f[a-zA-Z]*|\+\S+)(\s|$)|reset\s.*--hard|clean|filter-branch|filter-repo|update-ref|reflog\s+(expire|delete)|gc\s.*--prune|checkout(\s.*)?\s(--|\.)(\s|$)|restore|branch\s.*-[dD]\b|tag\s.*-d\b|stash\s+(drop|clear)|worktree\s+remove|remote\s+(add|remove|rm|set-url))/;

/** gh subcommands that only read; every other gh call writes to GitHub. */
const GH_READ = /^(\S+\s+)?(view|list|status|diff|checks)(\s|$)|^(auth\s+status|search|browse)(\s|$)/;

/** Package managers: installing, removing and publishing are asked, running scripts is not. */
const SENSITIVE_PACKAGE = /^(npm|pnpm|yarn|bun|pip|pip3|uv|brew|cargo|gem|apt|apt-get)\s+(.*\s)?(install|i|add|uninstall|remove|rm|publish|unpublish|upgrade|update)(\s|$)/;

/** curl/wget that send data instead of fetching. */
const CURL_SEND = /(^|\s)(-d|--data\S*|-F|--form|-T|--upload-file|-X\s*(POST|PUT|PATCH|DELETE)|--request\s+(POST|PUT|PATCH|DELETE)|--post-\S+|--method=(POST|PUT|PATCH|DELETE))(\s|$)/i;

/** Paths the deny list keeps from Read. */
const SECRET_PATH = /(^|[\s/'"=])(\.ssh|\.aws|\.gnupg|\.mcp-auth)(\/|\s|$|['"])|\.env(\.[\w.-]+)?(\s|$|['"])|\.(pem|key)(\s|$|['"])|id_(rsa|ed25519)/;

/** The settings that grant all of this: reading them is fine, changing them is asked. */
const SETTINGS_PATH = /\.claude\/settings[\w.-]*\.json/;

/** A heredoc and the line that feeds it; the body is shell only when that line runs a shell. */
const HEREDOC = /([^\n]*)<<-?\s*['"]?(\w+)['"]?[^\n]*\n[\s\S]*?\n\2(?=\n|$)/g;

/** `git status *` matches `git status` and `git status --short`; `pwd` matches only `pwd`. */
export function ruleToRegExp(rule: string): RegExp {
  let body = rule.trim();
  let tail = '';
  if (body.endsWith(' *')) {
    body = body.slice(0, -2);
    tail = '( .*)?';
  } else if (body.endsWith(':*')) {
    body = body.slice(0, -2);
    tail = '.*';
  }
  const escaped = body.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${escaped}${tail}$`);
}

/** Bash ask and deny rules of the user's settings. Read on every call so an edit applies without restart. */
export function loadAskRules(settingsPath = path.join(os.homedir(), '.claude', 'settings.json')): RegExp[] {
  try {
    const perms = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))?.permissions ?? {};
    return [...(perms.ask ?? []), ...(perms.deny ?? [])]
      .filter((r: unknown): r is string => typeof r === 'string')
      .map((r: string) => /^Bash\((.*)\)$/.exec(r)?.[1])
      .filter((r): r is string => !!r)
      .map(ruleToRegExp);
  } catch {
    return [];
  }
}

/** Drop keywords, `VAR=x` prefixes, wrappers and the directory of the command: `xargs /bin/rm -f` -> `rm -f`. */
function normalize(segment: string): string {
  let words = segment.trim().replace(/^['"]+/, '').split(/\s+/).filter(Boolean);
  while (words.length > 0) {
    const w = words[0];
    if (KEYWORDS.has(w) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) words = words.slice(1);
    else if (WRAPPERS.has(path.basename(w))) words = words.slice(1).filter((x, i) => i > 0 || !x.startsWith('-'));
    else break;
  }
  if (words.length === 0) return '';
  words[0] = path.basename(words[0].replace(/^\\/, ''));
  let s = words.join(' ');
  if (words[0] === 'git') s = s.replace(/^git((\s+(-C\s+("[^"]*"|'[^']*'|\S+)|-c\s+\S+|--no-pager))*)/, 'git');
  return s;
}

function isSensitiveSegment(segment: string, askRules: RegExp[]): boolean {
  const s = normalize(segment);
  if (!s) return false;
  if (askRules.some((r) => r.test(s))) return true;

  const [cmd, ...rest] = s.split(' ');
  const args = rest.join(' ');
  if (cmd === 'kill' && rest[0] === '-0') return false; // only checks that the process lives
  if (SENSITIVE_COMMANDS.has(cmd)) return true;
  if (cmd === 'git') return SENSITIVE_GIT.test(args);
  if (cmd === 'gh') return !GH_READ.test(args) || /(^|\s)(-X|--method|-f|-F|--field|--raw-field)(\s|$)/.test(args);
  if (cmd === 'curl' || cmd === 'wget') return CURL_SEND.test(args);
  if (cmd === 'find') return /(^|\s)-(delete|exec|execdir|ok|okdir)\s+(\S*\/)?(rm|mv|shred|unlink)(\s|$)|(^|\s)-delete(\s|$)/.test(args);
  if (['bash', 'sh', 'zsh'].includes(cmd) && /^-\w*c\s/.test(args)) {
    return isSensitiveBash(args.replace(/^-\w*c\s+/, '').replace(/^['"]|['"]$/g, ''), askRules);
  }
  return SENSITIVE_PACKAGE.test(s);
}

/** True when any part of `command` is destructive, outward-facing or touches a secret. */
export function isSensitiveBash(command: string, askRules: RegExp[] = loadAskRules()): boolean {
  if (SECRET_PATH.test(command)) return true;
  if (new RegExp(`>\\s*\\S*${SETTINGS_PATH.source}`).test(command)) return true;
  if (/\|\s*(sudo\s+)?(sh|bash|zsh)(\s|$)/.test(command)) return true; // curl ... | sh
  // python3 - <<'EOF' ... EOF: the body is code, not commands; `bash <<EOF` and `ssh host <<EOF` keep it.
  command = command.replace(HEREDOC, (whole, head: string) => (/\b((ba|z)?sh|ssh)\b/.test(head) ? whole : head));
  // Quotes are not parsed: splitting inside them only yields more pieces to check, so `ssh host 'rm x'`
  // and `echo $(rm x)` are still caught.
  return command.split(/&&|\|\||[;|\n&]|\$\(|`|[(){}]/).some((seg) => isSensitiveSegment(seg, askRules));
}

/** Tools that touch nothing sensitive by themselves. Edit/Write are in the user's allow list. */
const SAFE_TOOLS = new Set([
  'Read', 'Glob', 'Grep', 'LSP', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'WebSearch', 'WebFetch',
  'TodoWrite', 'Task', 'Agent', 'Skill', 'ToolSearch',
]);

/** Whether a tool call may run without asking in Discord. */
export function isAutoAllowed(toolName: string, input: Record<string, unknown>): boolean {
  if (toolName === 'Bash') return typeof input.command === 'string' && !isSensitiveBash(input.command);
  if (!SAFE_TOOLS.has(toolName)) return false;
  const target = [input.file_path, input.notebook_path, input.path].find((v) => typeof v === 'string');
  return !(typeof target === 'string' && (SECRET_PATH.test(target) || SETTINGS_PATH.test(target)));
}
