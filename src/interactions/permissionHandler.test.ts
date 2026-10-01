import { describe, expect, it, vi } from 'vitest';
import type { TextChannel } from 'discord.js';
import { requestPermission } from './permissionHandler.js';
import { sessionManager } from '../sessions/sessionManager.js';

function fakeChannel(id: string) {
  const edit = vi.fn(async () => undefined);
  const channel = { id, send: vi.fn(async () => ({ id: `msg-${id}`, edit })) } as unknown as TextChannel;
  return { channel, edit };
}

describe('requestPermission', () => {
  it('waits without a timeout and is denied when the session stops', async () => {
    vi.useFakeTimers();
    const { channel, edit } = fakeChannel('ch-stop');
    let settled = false;
    const result = requestPermission(channel, 'u1', 'Bash', { command: 'rm x' }).then((r) => {
      settled = true;
      return r;
    });

    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000); // a day: the old 60s timeout is gone
    expect(settled).toBe(false);

    sessionManager.emit('stopped', 'ch-stop');
    await expect(result).resolves.toMatchObject({ behavior: 'deny' });
    expect(edit).toHaveBeenCalledOnce(); // buttons disabled
    vi.useRealTimers();
  });

  it('only cancels requests of the stopped channel', async () => {
    const a = fakeChannel('ch-a');
    const b = fakeChannel('ch-b');
    let bSettled = false;
    const ra = requestPermission(a.channel, 'u1', 'Bash', { command: 'a' });
    void requestPermission(b.channel, 'u1', 'Bash', { command: 'b' }).then(() => { bSettled = true; });
    await Promise.resolve();

    sessionManager.emit('stopped', 'ch-a');
    await expect(ra).resolves.toMatchObject({ behavior: 'deny' });
    await Promise.resolve();
    expect(bSettled).toBe(false);
    sessionManager.emit('stopped', 'ch-b'); // clean up
  });
});
