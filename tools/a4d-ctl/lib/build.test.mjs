import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildPlan } from './build.mjs';

let repo;
const at = (rel, minutesAgo) => {
  const file = path.join(repo, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, '');
  const t = new Date(Date.now() - minutesAgo * 60_000);
  fs.utimesSync(file, t, t);
};
// Directories count too (a deleted source file only shows in its folder's mtime), so age them as well.
const ageDirs = (minutesAgo) => {
  const t = new Date(Date.now() - minutesAgo * 60_000);
  for (const dir of ['src', 'src/sub']) if (fs.existsSync(path.join(repo, dir))) fs.utimesSync(path.join(repo, dir), t, t);
};

/** A repo that was installed and built after its last change. */
function upToDate() {
  at('package.json', 60);
  at('package-lock.json', 60);
  at('tsconfig.json', 60);
  at('src/cli.ts', 50);
  at('src/sub/a.ts', 50);
  ageDirs(50);
  at('node_modules/.package-lock.json', 40);
  at('dist/cli.js', 30);
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'a4d-build-'));
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('buildPlan', () => {
  it('does nothing when the install and the build are newer than every input', () => {
    upToDate();
    expect(buildPlan(repo)).toEqual({ install: false, build: false });
  });

  it('builds when a source file, a source folder or tsconfig changed after the build', () => {
    upToDate();
    at('src/sub/a.ts', 10);
    expect(buildPlan(repo)).toEqual({ install: false, build: true });

    upToDate();
    ageDirs(10); // a file was deleted or renamed
    expect(buildPlan(repo)).toEqual({ install: false, build: true });

    upToDate();
    at('tsconfig.json', 10);
    expect(buildPlan(repo)).toEqual({ install: false, build: true });
  });

  it('ignores test files', () => {
    upToDate();
    at('src/sub/a.test.ts', 10);
    ageDirs(50);
    expect(buildPlan(repo)).toEqual({ install: false, build: false });
  });

  it('installs and builds when the dependencies changed or were never installed', () => {
    upToDate();
    at('package-lock.json', 10); // e.g. a git pull
    expect(buildPlan(repo)).toEqual({ install: true, build: true });

    upToDate();
    fs.rmSync(path.join(repo, 'node_modules'), { recursive: true });
    expect(buildPlan(repo)).toEqual({ install: true, build: true });
  });

  it('builds when there is no build yet', () => {
    upToDate();
    fs.rmSync(path.join(repo, 'dist'), { recursive: true });
    expect(buildPlan(repo)).toEqual({ install: false, build: true });
  });
});
