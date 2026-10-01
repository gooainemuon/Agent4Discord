// Which local files the attach_file tool may post to Discord.
//
// attach_file runs without a permission prompt and reads files itself, so settings.json deny rules
// (they only cover Claude's Read tool) do not apply to it. A prompt injection could otherwise post
// the bot token (~/.agent4discord/config.json) or an SSH key to the channel.
import os from 'node:os';
import path from 'node:path';

/** Directory names that hold credentials; anything under them is refused wherever it is. */
const SENSITIVE_DIRS = new Set([
  '.ssh', '.gnupg', '.aws', '.azure', '.kube', '.docker', '.agent4discord', '.mcp-auth', '.config/gh',
]);

/** Refused only directly under the home directory: a project's own .claude/ holds rules, not secrets. */
const HOME_SENSITIVE_DIRS = new Set(['.claude']);

/** File names that are credentials by convention. `.env.example` is allowed. */
const SENSITIVE_FILES = [
  /^\.env(\..+)?$/,
  /\.(pem|key|p12|pfx|keystore|jks)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/,
  /^\.(netrc|npmrc|pypirc|git-credentials)$/,
  /^credentials(\.json)?$/i,
];

function isUnder(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Return why `realPath` must not be attached, or null when it may.
 * `realPath` must already be resolved with fs.realpath (symlinks followed); `roots` likewise.
 * Allowed: files inside the session's working directory or the temp directory, minus credentials.
 */
export function attachRefusal(realPath: string, roots: string[]): string | null {
  const base = path.basename(realPath);
  if (base === '.env.example') {
    // explicitly fine
  } else if (SENSITIVE_FILES.some((re) => re.test(base))) {
    return `Refusing to attach "${base}": it looks like a credential file.`;
  }

  const home = os.homedir();
  const relHome = isUnder(realPath, home) ? path.relative(home, realPath).split(path.sep) : [];
  const segments = realPath.split(path.sep);
  for (const dir of SENSITIVE_DIRS) {
    const parts = dir.split('/');
    const hit = (segs: string[]) => segs.some((_, i) => parts.every((p, j) => segs[i + j] === p));
    if (hit(segments) || hit(relHome)) {
      return `Refusing to attach a file under "${dir}": that folder holds credentials.`;
    }
  }

  if (relHome.length > 1 && HOME_SENSITIVE_DIRS.has(relHome[0])) {
    return `Refusing to attach a file under "~/${relHome[0]}": that folder holds credentials.`;
  }

  if (!roots.some((root) => isUnder(realPath, root))) {
    return 'Refusing to attach a file outside the session folder or the temp folder. Copy it into the project or /tmp first.';
  }
  return null;
}
