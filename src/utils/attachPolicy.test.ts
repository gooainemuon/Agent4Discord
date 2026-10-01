import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { attachRefusal } from './attachPolicy.js';

const home = os.homedir();
const project = path.join(home, 'ain', 'esp-tts');

describe('attachRefusal', () => {
  it('allows ordinary files anywhere, inside or outside the session folder', () => {
    expect(attachRefusal(path.join(project, 'eval', 'report.png'))).toBeNull();
    expect(attachRefusal('/tmp/out/listen.wav')).toBeNull();
    expect(attachRefusal(path.join(home, 'Documents', 'notes.md'))).toBeNull();
    expect(attachRefusal(path.join(project, '.env.example'))).toBeNull();
    expect(attachRefusal(path.join(project, '.claude', 'CLAUDE.md'))).toBeNull();
  });

  it('allows ~/.claude except the Claude login credentials', () => {
    expect(attachRefusal(path.join(home, '.claude', 'settings.json'))).toBeNull();
    expect(attachRefusal(path.join(home, '.claude', 'modes', 'discord.md'))).toBeNull();
    expect(attachRefusal(path.join(home, '.claude', '.credentials.json'))).toMatch(/credential/);
  });

  it('refuses SSH keys, the bot config and other credential folders', () => {
    expect(attachRefusal(path.join(home, '.ssh', 'id_ed25519'))).not.toBeNull();
    expect(attachRefusal(path.join(home, '.ssh', 'known_hosts'))).toMatch(/\.ssh/);
    expect(attachRefusal(path.join(home, '.agent4discord', 'config.json'))).toMatch(/\.agent4discord/);
    expect(attachRefusal(path.join(home, '.config', 'gh', 'hosts.yml'))).toMatch(/\.config\/gh/);
    expect(attachRefusal(path.join(home, '.aws', 'credentials'))).not.toBeNull();
  });

  it('refuses credential-looking files wherever they are', () => {
    expect(attachRefusal(path.join(project, '.env'))).toMatch(/credential/);
    expect(attachRefusal(path.join(project, '.env.local'))).toMatch(/credential/);
    expect(attachRefusal(path.join(project, 'deploy', 'server.pem'))).toMatch(/credential/);
    expect(attachRefusal('/tmp/id_rsa')).toMatch(/credential/);
  });
});
