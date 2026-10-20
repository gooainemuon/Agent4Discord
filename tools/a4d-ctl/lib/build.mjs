// Install and build before the bot starts, so a start after `git pull` never runs an old dist/.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function mtime(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

/** Newest mtime of the sources under `dir`, folders included (a deleted file only moves its folder's). */
function newestSource(dir) {
  let newest = mtime(dir) ?? 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return newest;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) newest = Math.max(newest, newestSource(full));
    else if (!/\.test\.ts$/.test(e.name)) newest = Math.max(newest, mtime(full) ?? 0);
  }
  return newest;
}

/** What has to run before the bot in `repoDir` can start on its current sources. */
export function buildPlan(repoDir) {
  const installed = mtime(path.join(repoDir, 'node_modules', '.package-lock.json')); // written by npm install
  const deps = Math.max(mtime(path.join(repoDir, 'package.json')) ?? 0, mtime(path.join(repoDir, 'package-lock.json')) ?? 0);
  const install = installed === null || deps > installed;

  const built = mtime(path.join(repoDir, 'dist', 'cli.js'));
  const inputs = Math.max(newestSource(path.join(repoDir, 'src')), mtime(path.join(repoDir, 'tsconfig.json')) ?? 0);
  const build = install || built === null || inputs > built;
  return { install, build };
}

function run(cmd, args, repoDir, env) {
  const res = spawnSync(cmd, args, { cwd: repoDir, env, encoding: 'utf-8' });
  if (res.status === 0) return null;
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`.trim().split('\n').slice(-15).join('\n');
  return res.error ? res.error.message : out || `exit ${res.status}`;
}

/**
 * Run what buildPlan asks for. Returns { steps, error }: the steps that ran ('install', 'build') and,
 * when one failed, its last output lines.
 */
export function ensureBuilt(repoDir, node, envPath) {
  const plan = buildPlan(repoDir);
  const steps = [];
  // npm is a `#!/usr/bin/env node` script: put this node first so launchd's bare PATH still finds it.
  const binDir = path.dirname(node);
  const env = { ...process.env, PATH: [binDir, envPath].filter(Boolean).join(path.delimiter) };

  if (plan.install) {
    const npm = fs.existsSync(path.join(binDir, 'npm')) ? path.join(binDir, 'npm') : 'npm';
    // ci, not install: it never rewrites package-lock.json, so the checkout stays clean for the next pull.
    const error = run(npm, ['ci', '--no-audit', '--no-fund'], repoDir, env);
    if (error) return { steps, error: `npm ci 실패:\n${error}` };
    // Mark the install as done even if npm left this file's mtime alone.
    const stamp = path.join(repoDir, 'node_modules', '.package-lock.json');
    if (fs.existsSync(stamp)) fs.utimesSync(stamp, new Date(), new Date());
    steps.push('install');
  }
  if (plan.build) {
    const tsc = path.join(repoDir, 'node_modules', 'typescript', 'bin', 'tsc');
    // noEmitOnError: a failed build leaves the previous dist/ as it was, and the next start retries.
    const error = run(node, [tsc, '-p', 'tsconfig.json', '--noEmitOnError'], repoDir, env);
    if (error) return { steps, error: `빌드 실패:\n${error}` };
    steps.push('build');
  }
  return { steps, error: null };
}
