import { describe, expect, it } from 'vitest';
import { sessionManager, type ActiveSession } from './sessionManager.js';

function fake(channelId: string, sessionId: string, state: ActiveSession['state'] = 'idle'): ActiveSession {
  return { channelId, sessionId, state } as ActiveSession;
}

describe('claimSessionId', () => {
  const map = (sessionManager as unknown as { sessions: Map<string, ActiveSession> }).sessions;

  it('lets one caller claim a session id until it is released', () => {
    expect(sessionManager.claimSessionId('s-1')).toBe(true);
    expect(sessionManager.claimSessionId('s-1')).toBe(false); // a second click while the first is in flight
    sessionManager.releaseSessionId('s-1');
    expect(sessionManager.claimSessionId('s-1')).toBe(true);
    sessionManager.releaseSessionId('s-1');
  });

  it('refuses an id another channel runs, but not one that channel itself or a stopped session holds', () => {
    map.set('chA', fake('chA', 's-2'));
    map.set('chB', fake('chB', 's-3', 'stopped'));
    try {
      expect(sessionManager.claimSessionId('s-2')).toBe(false);
      expect(sessionManager.claimSessionId('s-2', 'chA')).toBe(true);
      sessionManager.releaseSessionId('s-2');
      expect(sessionManager.claimSessionId('s-3')).toBe(true);
      sessionManager.releaseSessionId('s-3');
    } finally {
      map.delete('chA');
      map.delete('chB');
    }
  });
});
