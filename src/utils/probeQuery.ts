import os from 'node:os';
import { query, type Query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { getClaudeExecutable } from './claudeCli.js';

const PROBE_TIMEOUT_MS = 30_000;

/**
 * Start a throwaway Claude CLI process, run a control request against it, and shut it down.
 * No user message is ever sent, so no conversation starts and no tokens are used.
 */
export async function withProbeQuery<T>(fn: (q: Query) => Promise<T>): Promise<T> {
  async function* idle(): AsyncGenerator<SDKUserMessage> {
    await new Promise<never>(() => {});
  }

  const q = query({
    prompt: idle(),
    options: { cwd: os.homedir(), pathToClaudeCodeExecutable: getClaudeExecutable() },
  });
  // The CLI only starts once the query is iterated
  void (async () => {
    for await (const _ of q) { /* drain */ }
  })().catch(() => {});

  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      fn(q),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Probe query timed out')), PROBE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    q.close();
  }
}
