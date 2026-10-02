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
  'rm', 'rmdir', 'mv', 'unlink', 'shred', 'dd', 'mkfs', 'diskutil', 'chown', 'chflags',
  'sudo', 'su', 'doas', 'kill', 'pkill', 'killall', 'shutdown', 'reboot', 'halt', 'launchctl', 'crontab',
  'scp', 'rsync', 'sftp', 'ftp', 'docker', 'eval', 'osascript', 'defaults',
]);

/** Read-only uses of the commands above. */
const READ_USES: Record<string, RegExp> = {
  kill: /^-0(\s|$)/, // only checks that the process lives
  crontab: /^-l(\s|$)/,
  launchctl: /^(list|print)(\s|$)/,
  defaults: /^read(\s|$)/,
  diskutil: /^(list|info)(\s|$)/,
};

/** Commands that only read, so naming a settings file in them changes nothing. */
const READERS = new Set(['cat', 'head', 'tail', 'less', 'jq', 'grep', 'rg', 'diff', 'wc', 'ls', 'stat', 'file']);

/** Leading words that run the rest of the segment as the real command. */
const WRAPPERS = new Set(['xargs', 'env', 'nohup', 'time', 'command', 'exec', 'nice', 'timeout', 'caffeinate']);

/** Shell keywords that start a segment without being the command. */
const KEYWORDS = new Set(['do', 'then', 'else', 'elif', '!']);

/**
 * git subcommands that rewrite history or drop work. A plain push is allowed, a force push is not
 * (user 2026-10-02). `branch -d`, `restore --staged` and `clean -n` lose nothing and are allowed.
 */
const SENSITIVE_GIT = new RegExp([
  /push\s(.*\s)?(--force\S*|-[a-zA-Z]*f[a-zA-Z]*|\+\S+)(\s|$)/,
  /reset\s.*--hard/,
  /clean(?!\s(.*\s)?(-[a-zA-Z]*n[a-zA-Z]*|--dry-run)(\s|$))/,
  /filter-branch|filter-repo|update-ref|reflog\s+(expire|delete)|gc\s.*--prune/,
  /checkout(\s.*)?\s(--|\.|-f|--force)(\s|$)/,
  /switch\s(.*\s)?(-f|--force|--discard-changes)(\s|$)/,
  /restore(?!\s+(--staged|-S)\s(?!.*(--worktree|-W)))/,
  /branch\s(.*\s)?(-D|-M|--force)(\s|$)/,
  /tag\s(.*\s)?(-d|--delete)(\s|$)/,
  /stash\s+(drop|clear)|worktree\s+remove|remote\s+(add|remove|rm|set-url)/,
].map((r) => `^(${r.source})`).join('|'));

/** gh subcommands that only read; every other gh call writes to GitHub. */
const GH_READ = /^(\S+\s+)?(view|list|status|diff|checks|watch)(\s|$)|^(auth\s+status|search|browse)(\s|$)/;

/** gh api is a GET unless it names another method or sends fields (which makes it a POST). */
const GH_API_WRITE = /(^|\s)(-f|-F|--field|--raw-field|--input)(\s|=|$)|(-X|--method)(\s+|=)?['"]?(POST|PUT|PATCH|DELETE)/i;

const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun', 'pip', 'pip3', 'uv', 'brew', 'cargo', 'gem', 'go', 'apt', 'apt-get']);

/** Package manager subcommands that change what is installed or publish. */
const PACKAGE_CHANGES = new Set([
  'install', 'i', 'ci', 'add', 'get', 'reinstall', 'uninstall', 'remove', 'rm', 'publish', 'unpublish', 'upgrade', 'update',
]);

/** curl/wget options that send data instead of fetching: `-d x`, `-sd x`, `-d@file`, `--json`, `-F`, `-T`. */
const CURL_SEND = /(^|\s)(-[a-zA-Z]*[dFT]\S*|--data\S*|--json|--form\S*|--upload-file\S*|--post-\S+)(\s|$)/;
const CURL_METHOD = /(^|\s)(-X|--request|--method)(\s+|=)?['"]?(POST|PUT|PATCH|DELETE)\b/i;

/** Credentials: what the deny list keeps from Read, plus this bot's own token and git/gh tokens. */
const SECRET_PATH = new RegExp([
  /(^|[\s/'"=])(\.ssh|\.aws|\.gnupg|\.mcp-auth|\.netrc|\.git-credentials)(?![\w-])/,
  /(^|[\s/'"=])\.env(\.[\w.-]+)?(?![\w-])/, // .env and .env.local, not process.env
  /[\w-]\.(pem|key)(?![\w-])/, // server.key, not jq '.key'
  /id_(rsa|ed25519)|\.agent4discord\/config\.json|\.config\/gh\/hosts/,
].map((r) => r.source).join('|'));

/** The settings that grant all of this: reading them is fine, changing them is asked. */
const SETTINGS_PATH = /\.claude\/settings[\w.-]*\.json/;

/** A heredoc and the line that feeds it. The body may be empty. */
const HEREDOC = /([^\n]*)<<-?\s*['"]?(\w+)['"]?[^\n]*\n(?:[\s\S]*?\n)??\2(?=\n|$)/g;

/** A line that hands its heredoc to a shell: `bash <<EOF`, `ssh host <<EOF`, not `cat > a.sh <<EOF`. */
const RUNS_SHELL = /(^|[\s|;&])(sudo\s+)?((ba|z)?sh|ssh)(\s|$)/;

/** `curl ... | sh`, `curl ... | python3 -`: a download run as code. `| python3 -m json.tool` only formats. */
const PIPE_TO_INTERPRETER = /\|\s*(sudo\s+)?((ba|z)?sh(\s|$)|(python3?|node|perl|ruby)(\s+-\w*)*(?=\s*($|[;&)]|\|\s)))/;

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

/**
 * Bash ask and deny rules of the user's settings. Read on every call so an edit applies without restart.
 * Project settings are not read: none has ask rules today (2026-10-02).
 */
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

/** Drop keywords, `VAR=x` prefixes, wrappers with their options and the command's directory: `nice -n 10 /bin/rm` -> `rm`. */
function normalize(segment: string): string {
  let words = segment.trim().replace(/^['"]+/, '').split(/\s+/).filter(Boolean);
  while (words.length > 0) {
    const w = words[0];
    if (KEYWORDS.has(w) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) {
      words = words.slice(1);
    } else if (WRAPPERS.has(path.basename(w))) {
      words = words.slice(1);
      while (words.length > 0 && /^(-|\d)/.test(words[0])) words = words.slice(1); // -n 10, 10s
    } else {
      break;
    }
  }
  if (words.length === 0) return '';
  words[0] = path.basename(words[0].replace(/^\\/, ''));
  let s = words.join(' ');
  if (words[0] === 'git') {
    s = s.replace(/^git((\s+(-C\s+("[^"]*"|'[^']*'|\S+)|-c\s+\S+|--no-pager|--git-dir=\S+|--work-tree=\S+))*)/, 'git');
  }
  return s;
}

function changesPackages(cmd: string, args: string[]): boolean {
  let words = args;
  if (/^python3?$/.test(cmd) && words[0] === '-m' && /^pip3?$/.test(words[1] ?? '')) words = words.slice(2);
  else if (!PACKAGE_MANAGERS.has(cmd)) return false;
  if (cmd === 'uv' && words[0] === 'pip') words = words.slice(1);
  const sub = words.find((w) => !w.startsWith('-'));
  return sub !== undefined && PACKAGE_CHANGES.has(sub);
}

function isSensitiveSegment(segment: string, askRules: RegExp[]): boolean {
  const s = normalize(segment);
  if (!s) return false;
  if (askRules.some((r) => r.test(s))) return true;

  const [cmd, ...rest] = s.split(' ');
  const args = rest.join(' ');
  if (SETTINGS_PATH.test(s)) {
    const reads = READERS.has(cmd) || (cmd === 'sed' && !/(^|\s)-\w*i/.test(args)) ||
      (cmd === 'git' && /^(diff|log|show|status|blame)(\s|$)/.test(args));
    if (!reads) return true;
  }
  if (READ_USES[cmd]?.test(args)) return false;
  if (SENSITIVE_COMMANDS.has(cmd)) return true;
  if (cmd === 'chmod') return /(^|\s)-\w*R/.test(args);
  if (cmd === 'git') return SENSITIVE_GIT.test(args);
  if (cmd === 'gh') {
    const a = args.replace(/(^|\s)(-R|--repo)(\s+|=)\S+/g, '').trim();
    return a.startsWith('api ') ? GH_API_WRITE.test(a) : !GH_READ.test(a);
  }
  if (cmd === 'curl' || cmd === 'wget') return CURL_SEND.test(args) || CURL_METHOD.test(args);
  if (cmd === 'find') {
    if (/(^|\s)-delete(\s|$)/.test(args)) return true;
    const run = /(^|\s)-(exec|execdir|ok|okdir)\s+(\S+)/.exec(args)?.[3];
    return run !== undefined && (SENSITIVE_COMMANDS.has(path.basename(run)) || /^(ba|z)?sh$/.test(path.basename(run)));
  }
  if (['bash', 'sh', 'zsh'].includes(cmd) && /^-\w*c\s/.test(args)) {
    return isSensitiveBash(args.replace(/^-\w*c\s+/, '').replace(/^['"]|['"]$/g, ''), askRules);
  }
  return changesPackages(cmd, rest);
}

/** True when any part of `command` is destructive, outward-facing or touches a secret. */
export function isSensitiveBash(command: string, askRules: RegExp[] = loadAskRules()): boolean {
  if (SECRET_PATH.test(command)) return true;
  if (new RegExp(`>\\s*\\S*${SETTINGS_PATH.source}`).test(command)) return true;
  if (PIPE_TO_INTERPRETER.test(command)) return true;
  // python3 - <<'EOF' ... EOF: the body is code, not commands; `bash <<EOF` and `ssh host <<EOF` keep it.
  command = command.replace(HEREDOC, (whole, head: string) => (RUNS_SHELL.test(head) ? whole : head));
  // Quotes are not parsed: splitting inside them only yields more pieces to check, so `echo $(rm x)` and
  // `bash -c "a && rm x"` are caught. A quoted ssh remote command without a separator stays one ssh piece and
  // is allowed, as ssh is allowed globally (user 2026-10-01).
  return command.split(/&&|\|\||[;|\n&]|\$\(|`|[(){}]/).some((seg) => isSensitiveSegment(seg, askRules));
}

/** Tools that touch nothing sensitive by themselves. Edit/Write are in the user's allow list. */
const SAFE_TOOLS = new Set([
  'Read', 'Glob', 'Grep', 'LSP', 'Edit', 'Write', 'NotebookEdit', 'WebSearch', 'WebFetch', 'TodoWrite',
  'Agent', 'Skill', 'ToolSearch', 'TaskCreate', 'TaskGet', 'TaskList', 'TaskUpdate',
]);

/** Whether a tool call may run without asking in Discord. */
export function isAutoAllowed(toolName: string, input: Record<string, unknown>): boolean {
  if (toolName === 'Bash') return typeof input.command === 'string' && !isSensitiveBash(input.command);
  if (!SAFE_TOOLS.has(toolName)) return false;
  const target = [input.file_path, input.notebook_path, input.path].find((v) => typeof v === 'string');
  return !(typeof target === 'string' && (SECRET_PATH.test(target) || SETTINGS_PATH.test(target)));
}
