import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { attachRefusal } from './attachPolicy.js';

const home = os.homedir();
const project = path.join(home, 'ain', 'esp-tts');
const tmp = '/tmp';
const roots = [project, tmp];

describe('attachRefusal', () => {
  it('allows files in the session folder and the temp folder', () => {
    expect(attachRefusal(path.join(project, 'eval', 'report.png'), roots)).toBeNull();
    expect(attachRefusal('/tmp/out/listen.wav', roots)).toBeNull();
    expect(attachRefusal(path.join(project, '.env.example'), roots)).toBeNull();
    expect(attachRefusal(path.join(project, '.claude', 'CLAUDE.md'), roots)).toBeNull(); // project rules, not ~/.claude
  });

  it('refuses files outside those folders', () => {
    expect(attachRefusal(path.join(home, 'Documents', 'notes.md'), roots)).toMatch(/outside/);
    expect(attachRefusal('/etc/hosts', roots)).toMatch(/outside/);
  });

  it('refuses the bot config and SSH keys even when the session runs in the home directory', () => {
    const homeRoots = [home, tmp];
    expect(attachRefusal(path.join(home, '.agent4discord', 'config.json'), homeRoots)).toMatch(/\.agent4discord/);
    expect(attachRefusal(path.join(home, '.ssh', 'id_ed25519'), homeRoots)).not.toBeNull();
    expect(attachRefusal(path.join(home, '.config', 'gh', 'hosts.yml'), homeRoots)).toMatch(/\.config\/gh/);
    expect(attachRefusal(path.join(home, '.claude', '.credentials.json'), homeRoots)).not.toBeNull();
  });

  it('refuses credential-looking files inside the project too', () => {
    expect(attachRefusal(path.join(project, '.env'), roots)).toMatch(/credential/);
    expect(attachRefusal(path.join(project, '.env.local'), roots)).toMatch(/credential/);
    expect(attachRefusal(path.join(project, 'deploy', 'server.pem'), roots)).toMatch(/credential/);
    expect(attachRefusal('/tmp/id_rsa', roots)).toMatch(/credential/);
  });

  it('does not treat a sibling folder with the same prefix as inside', () => {
    expect(attachRefusal(path.join(home, 'ain', 'esp-tts-old', 'a.txt'), roots)).toMatch(/outside/);
  });
});
