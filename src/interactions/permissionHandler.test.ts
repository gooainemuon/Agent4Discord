import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TextChannel } from 'discord.js';
import { requestPermission } from './permissionHandler.js';
import { sessionManager, type ActiveSession } from '../sessions/sessionManager.js';

const map = (sessionManager as unknown as { sessions: Map<string, ActiveSession> }).sessions;

function fakeChannel(id: string, state: ActiveSession['state'] | null = 'running') {
  if (state) map.set(id, { channelId: id, sessionId: `sid-${id}`, state } as ActiveSession);
  const edit = vi.fn(async () => undefined);
  const send = vi.fn(async (_m: unknown) => ({ id: `msg-${id}`, edit }));
  const channel = { id, send } as unknown as TextChannel;
  return { channel, edit, send };
}

function buttonIds(send: ReturnType<typeof fakeChannel>['send']): string[] {
  const msg = send.mock.calls[0][0] as { components: { toJSON(): { components: { custom_id: string }[] } }[] };
  return msg.components[0].toJSON().components.map((c) => c.custom_id.split(':').pop()!);
}

afterEach(() => {
  map.clear();
  vi.useRealTimers();
});

describe('requestPermission', () => {
  it('waits without a timeout and is denied when the session stops', async () => {
    vi.useFakeTimers();
    const { channel, edit } = fakeChannel('ch-stop');
    let settled = false;
    const result = requestPermission(channel, 'u1', 'mcp__github__create_issue', { title: 'x' }).then((r) => {
      settled = true;
      return r;
    });

    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000); // a day: the old 60s timeout is gone
    expect(settled).toBe(false);

    sessionManager.emit('stopped', 'ch-stop');
    await expect(result).resolves.toMatchObject({ behavior: 'deny' });
    expect(edit).toHaveBeenCalledOnce(); // buttons disabled
  });

  it('only cancels requests of the stopped channel', async () => {
    const a = fakeChannel('ch-a');
    const b = fakeChannel('ch-b');
    let bSettled = false;
    const ra = requestPermission(a.channel, 'u1', 'mcp__github__create_issue', { title: 'a' });
    void requestPermission(b.channel, 'u1', 'mcp__github__create_issue', { title: 'b' }).then(() => { bSettled = true; });
    await Promise.resolve();
    await Promise.resolve();

    sessionManager.emit('stopped', 'ch-a');
    await expect(ra).resolves.toMatchObject({ behavior: 'deny' });
    await Promise.resolve();
    expect(bSettled).toBe(false);
    sessionManager.emit('stopped', 'ch-b'); // clean up
  });

  it('denies at once when the session already ended while the request was being posted', async () => {
    const { channel, edit } = fakeChannel('ch-dead', 'stopped');
    await expect(requestPermission(channel, 'u1', 'mcp__github__create_issue', { title: 'x' })).resolves.toMatchObject({ behavior: 'deny' });
    expect(edit).toHaveBeenCalledOnce();
  });

  it('offers no "Always Allow" for Bash, but does for other tools', async () => {
    const bash = fakeChannel('ch-bash');
    void requestPermission(bash.channel, 'u1', 'Bash', { command: 'rm -rf build' });
    await vi.waitFor(() => expect(bash.send).toHaveBeenCalled());
    expect(buttonIds(bash.send)).toEqual(['allow', 'deny', 'details']);

    const edit = fakeChannel('ch-edit');
    void requestPermission(edit.channel, 'u1', 'mcp__github__create_issue', { title: 'x' });
    await vi.waitFor(() => expect(edit.send).toHaveBeenCalled());
    expect(buttonIds(edit.send)).toEqual(['allow', 'always', 'deny', 'details']);

    sessionManager.emit('stopped', 'ch-bash');
    sessionManager.emit('stopped', 'ch-edit');
  });

  it('passes the original tool input on allow, not an empty object', async () => {
    const { channel } = fakeChannel('ch-input');
    const input = { file_path: '/p/a.ts', pattern: 'x' };
    await expect(requestPermission(channel, 'u1', 'Read', input)).resolves.toEqual({ behavior: 'allow', updatedInput: input });
  });
});

