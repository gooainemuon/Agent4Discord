import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let resolved: string | null | undefined;

/**
 * Locate a locally installed `claude` CLI so sessions run the user's (auto-updating)
 * Claude Code instead of the copy bundled with the Agent SDK, which lags behind on
 * new models. Returns undefined when none is found, letting the SDK use its bundled CLI.
 */
export function resolveClaudeExecutable(
  envPath = process.env.PATH ?? '',
  platform: NodeJS.Platform = process.platform,
  homeDir = os.homedir(),
): string | undefined {
  // Native binary only: npm's `claude.cmd` shim on Windows cannot be spawned without a shell
  const name = platform === 'win32' ? 'claude.exe' : 'claude';
  const dirs = [...envPath.split(path.delimiter), path.join(homeDir, '.local', 'bin')];

  for (const dir of dirs) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // Not in this directory
    }
  }
  return undefined;
}

/** Memoized {@link resolveClaudeExecutable} for the current process environment. */
export function getClaudeExecutable(): string | undefined {
  if (resolved === undefined) {
    resolved = resolveClaudeExecutable() ?? null;
    console.log(resolved ? `[claude] Using local CLI: ${resolved}` : '[claude] Using SDK-bundled CLI');
  }
  return resolved ?? undefined;
}
