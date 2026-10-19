import { describe, expect, it } from 'vitest';
import { formatAnchor, isPollingCall, isThreadMode } from './toolThreads.js';

describe('isPollingCall', () => {
  it('matches read-only calls that look at an inbox or sleep', () => {
    expect(isPollingCall('Bash', { command: 'cd /p/.planning/inbox && sleep 60' })).toBe(true);
    expect(isPollingCall('Bash', { command: 'date; /bin/ls -1t .planning/inbox | head -5' })).toBe(true);
    expect(isPollingCall('Bash', { command: 'sleep 30; echo tick' })).toBe(true);
    expect(isPollingCall('Read', { file_path: '/p/2026-10-19-2013-lane/INBOX.md' })).toBe(true);
    expect(isPollingCall('Glob', { pattern: '인박스/*.md' })).toBe(true);
    expect(isPollingCall('Monitor', { command: 'inotifywait inbox' })).toBe(true);
  });

  it('leaves ordinary and mutating calls in the normal thread', () => {
    expect(isPollingCall('Bash', { command: 'git push origin main' })).toBe(false);
    expect(isPollingCall('Bash', { command: 'echo sleepy' })).toBe(false);
    expect(isPollingCall('Write', { file_path: '/p/INBOX.md', content: 'x' })).toBe(false);
    expect(isPollingCall('Edit', { file_path: '/p/inbox.md' })).toBe(false);
    expect(isPollingCall('Bash', undefined)).toBe(false);
  });
});

describe('formatAnchor', () => {
  it('lists tools with counts, in call order', () => {
    const counts = new Map<string, number>([['Bash', 5], ['Read', 1]]);
    expect(formatAnchor(counts)).toBe('🔧 Bash ×5 · Read');
    expect(formatAnchor(new Map())).toBe('🔧 도구 호출');
  });
});

describe('isThreadMode', () => {
  it('accepts the three modes only', () => {
    expect(isThreadMode('turn')).toBe(true);
    expect(isThreadMode('each')).toBe(true);
    expect(isThreadMode('off')).toBe(true);
    expect(isThreadMode('all')).toBe(false);
    expect(isThreadMode(undefined)).toBe(false);
  });
});
