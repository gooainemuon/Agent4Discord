// Session lifecycle -- AGE-016
import fs from 'node:fs';
import nodePath from 'node:path';
import { EventEmitter } from 'node:events';
import {
  query,
  type CanUseTool,
  type EffortLevel,
  type PermissionMode,
  type Query,
  type SDKUserMessage,
  type SDKAssistantMessage,
  type SDKResultMessage,
  type SDKSystemMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources';
import { AttachmentBuilder, GuildPremiumTier, type Client, type TextChannel } from 'discord.js';
import { resolvePlugins } from '../utils/plugins.js';
import { createDiscordToolServer, getUploadLimit } from '../tools/discordTools.js';
import { sessionContextOptions } from './sessionContext.js';
import { attachRefusal } from '../utils/attachPolicy.js';

export type SessionState = 'idle' | 'running' | 'stopped' | 'archived';

export interface ActiveSession {
  query: Query;
  channelId: string;
  guildId: string;
  userId: string;
  sessionId: string;
  cwd: string;
  state: SessionState;
  permissionMode: PermissionMode;
  /** Effort set for this session (picker, /a4d effort or restored); undefined = settings.json. */
  effort?: EffortLevel;
  totalCostUsd: number;
  createdAt: string;
  resolveNext: ((msg: SDKUserMessage) => void) | null;
  /** Messages waiting for the SDK to ask for input; drained by the message stream in order. */
  pendingMessages: SDKUserMessage[];
  abortController: AbortController;
}

class SessionManager extends EventEmitter {
  private sessions = new Map<string, ActiveSession>();

  createSession(
    guildId: string,
    userId: string,
    channelId: string,
    cwd: string,
    model?: string,
    canUseTool?: CanUseTool,
    client?: Client,
    permissionMode?: PermissionMode,
    effort?: EffortLevel,
  ): ActiveSession {
    const controller = new AbortController();

    this._closeLiveSession(channelId);

    let resolveNext: ((msg: SDKUserMessage) => void) | null = null;
    // Messages sent before the SDK asks for the next one (e.g. right after start or resume) wait here.
    const pending: SDKUserMessage[] = [];

    async function* messageStream(): AsyncGenerator<SDKUserMessage> {
      while (true) {
        const msg =
          pending.shift() ??
          (await new Promise<SDKUserMessage>((resolve) => {
            resolveNext = resolve;
          }));
        yield msg;
      }
    }

    const plugins = resolvePlugins();

    // Build MCP servers (discord tool for file attachment)
    const mcpServers: Record<string, ReturnType<typeof createDiscordToolServer>> = {};
    const allowedTools: string[] = [];

    if (client) {
      mcpServers.discord = createDiscordToolServer(
        this._buildSendFile(client, channelId, guildId),
      );
      allowedTools.push('mcp__discord__attach_file');
    }

    const q = query({
      prompt: messageStream(),
      options: {
        cwd,
        ...sessionContextOptions(cwd),
        model: model || 'opus',
        permissionMode: permissionMode === 'plan' ? 'plan' : 'default',
        includePartialMessages: true,
        abortController: controller,
        ...(effort && { effort }),
        canUseTool,
        plugins,
        ...(Object.keys(mcpServers).length > 0 && { mcpServers }),
        ...(allowedTools.length > 0 && { allowedTools }),
      },
    });

    const session: ActiveSession = {
      query: q,
      channelId,
      guildId,
      userId,
      sessionId: '',
      cwd,
      state: 'running',
      permissionMode: permissionMode ?? 'default',
      effort,
      totalCostUsd: 0,
      createdAt: new Date().toISOString(),
      resolveNext: null,
      pendingMessages: pending,
      abortController: controller,
    };

    // Wire up resolveNext -- the generator captures the outer variable,
    // but ActiveSession needs its own reference so sendMessage can call it.
    // Because the generator closure mutates the local `resolveNext`, we
    // need a proxy that always reads the latest value.
    Object.defineProperty(session, 'resolveNext', {
      get: () => resolveNext,
      set: (v: ((msg: SDKUserMessage) => void) | null) => {
        resolveNext = v;
      },
      enumerable: true,
      configurable: true,
    });

    this.sessions.set(channelId, session);
    void this._processEvents(session);
    return session;
  }

  resumeSession(
    guildId: string,
    userId: string,
    channelId: string,
    sessionId: string,
    cwd: string,
    model?: string,
    canUseTool?: CanUseTool,
    client?: Client,
    permissionMode?: PermissionMode,
    forkSession = false,
    effort?: EffortLevel,
  ): ActiveSession {
    const controller = new AbortController();

    this._closeLiveSession(channelId);

    let resolveNext: ((msg: SDKUserMessage) => void) | null = null;
    // Messages sent before the SDK asks for the next one (e.g. right after start or resume) wait here.
    const pending: SDKUserMessage[] = [];

    async function* messageStream(): AsyncGenerator<SDKUserMessage> {
      while (true) {
        const msg =
          pending.shift() ??
          (await new Promise<SDKUserMessage>((resolve) => {
            resolveNext = resolve;
          }));
        yield msg;
      }
    }

    const plugins = resolvePlugins();

    // Build MCP servers (discord tool for file attachment)
    const mcpServers: Record<string, ReturnType<typeof createDiscordToolServer>> = {};
    const allowedTools: string[] = [];

    if (client) {
      mcpServers.discord = createDiscordToolServer(
        this._buildSendFile(client, channelId, guildId),
      );
      allowedTools.push('mcp__discord__attach_file');
    }

    const q = query({
      prompt: messageStream(),
      options: {
        cwd,
        ...sessionContextOptions(cwd),
        model: model || 'opus',
        permissionMode: permissionMode === 'plan' ? 'plan' : 'default',
        includePartialMessages: true,
        abortController: controller,
        resume: sessionId,
        // Without this, resume continues the same session file: two channels on one session
        // write into one transcript and each sees the other's messages.
        ...(forkSession && { forkSession: true }),
        ...(effort && { effort }),
        canUseTool,
        plugins,
        ...(Object.keys(mcpServers).length > 0 && { mcpServers }),
        ...(allowedTools.length > 0 && { allowedTools }),
      },
    });

    const session: ActiveSession = {
      query: q,
      channelId,
      guildId,
      userId,
      sessionId: forkSession ? '' : sessionId, // a fork gets its own id from the init message
      cwd,
      state: 'running',
      permissionMode: permissionMode ?? 'default',
      effort,
      totalCostUsd: 0,
      createdAt: new Date().toISOString(),
      resolveNext: null,
      pendingMessages: pending,
      abortController: controller,
    };

    Object.defineProperty(session, 'resolveNext', {
      get: () => resolveNext,
      set: (v: ((msg: SDKUserMessage) => void) | null) => {
        resolveNext = v;
      },
      enumerable: true,
      configurable: true,
    });

    this.sessions.set(channelId, session);
    void this._processEvents(session);
    return session;
  }

  sendMessage(channelId: string, content: string | ContentBlockParam[]): void {
    const session = this.sessions.get(channelId);
    if (!session) {
      throw new Error(`No session found for channel ${channelId}`);
    }
    if (session.state === 'stopped' || session.state === 'archived') {
      throw new Error(`Session for channel ${channelId} is ${session.state}`);
    }
    session.state = 'running';
    const msg = {
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
    } as SDKUserMessage;
    const resolve = session.resolveNext;
    if (resolve) {
      session.resolveNext = null; // a resolver is single-use; the next message must not reuse it
      resolve(msg);
    } else {
      session.pendingMessages.push(msg); // the stream is not waiting yet: do not drop the message
    }
  }

  /** Session ids being attached to a channel right now (between the duplicate check and resumeSession). */
  private claimedSessionIds = new Set<string>();

  /**
   * Reserve a Claude session id before an async gap (channel creation) so a second click cannot pass
   * the duplicate check meanwhile. False when another channel runs it or is about to.
   */
  claimSessionId(sessionId: string, exceptChannelId?: string): boolean {
    if (this.claimedSessionIds.has(sessionId) || this.findActiveBySessionId(sessionId, exceptChannelId)) return false;
    this.claimedSessionIds.add(sessionId);
    return true;
  }

  releaseSessionId(sessionId: string): void {
    this.claimedSessionIds.delete(sessionId);
  }

  /** A channel gets a new query: close a still-running one first so it cannot keep going unseen. */
  private _closeLiveSession(channelId: string): void {
    const existing = this.sessions.get(channelId);
    if (existing && existing.state !== 'stopped' && existing.state !== 'archived') {
      console.warn(`[session] Channel ${channelId} already had a live session; closing it before starting another`);
      this.stopSession(channelId);
    }
  }

  getSession(channelId: string): ActiveSession | null {
    return this.sessions.get(channelId) ?? null;
  }

  stopSession(channelId: string): void {
    const session = this.sessions.get(channelId);
    if (!session) return;
    session.query.close();
    session.state = 'stopped';
    this.emit('stopped', channelId);
  }

  removeSession(channelId: string): void {
    const session = this.sessions.get(channelId);
    if (!session) return;
    if (session.state !== 'stopped' && session.state !== 'archived') {
      this.stopSession(channelId);
    }
    this.sessions.delete(channelId);
  }

  /** The running session in another channel that already uses this Claude session id, if any. */
  findActiveBySessionId(sessionId: string, exceptChannelId?: string): ActiveSession | null {
    for (const s of this.sessions.values()) {
      if (s.channelId === exceptChannelId) continue;
      if (s.sessionId === sessionId && s.state !== 'stopped' && s.state !== 'archived') return s;
    }
    return null;
  }

  getAllSessions(): ActiveSession[] {
    return [...this.sessions.values()];
  }

  private _buildSendFile(client: Client, channelId: string, guildId: string) {
    return async (requestedPath: string, filename?: string): Promise<string> => {
      // Resolve symlinks first, then check where the file really is (see utils/attachPolicy.ts).
      const filePath = await fs.promises.realpath(requestedPath);
      const refusal = attachRefusal(filePath);
      if (refusal) throw new Error(refusal);

      // Validate file exists
      const stats = await fs.promises.stat(filePath);

      // Check size against guild premium tier
      const guild = client.guilds.cache.get(guildId);
      const limit = getUploadLimit(guild?.premiumTier ?? GuildPremiumTier.None);

      if (stats.size > limit) {
        throw new Error(
          `File too large (${formatSize(stats.size)}). Server upload limit: ${formatSize(limit)}`,
        );
      }

      // Read file and send to channel
      const buffer = await fs.promises.readFile(filePath);
      const displayName = filename || nodePath.basename(filePath);
      const attachment = new AttachmentBuilder(buffer, { name: displayName });

      const channel = client.channels.cache.get(channelId) as TextChannel | undefined;
      if (!channel?.isTextBased()) {
        throw new Error('Session channel not found or is not a text channel');
      }

      await channel.send({ files: [attachment] });

      return `File "${displayName}" (${formatSize(stats.size)}) sent to Discord successfully.`;
    };
  }

  private async _processEvents(session: ActiveSession): Promise<void> {
    try {
      for await (const msg of session.query) {
        // Log all non-stream messages for debugging
        if (msg.type !== 'stream_event' && msg.type !== 'tool_progress') {
          console.log(`[sdk:${msg.type}]`, JSON.stringify(msg, null, 2).slice(0, 500));
        }

        switch (msg.type) {
          case 'system': {
            const sysMsg = msg as SDKSystemMessage;
            if (sysMsg.subtype === 'init' && sysMsg.session_id && sysMsg.session_id !== session.sessionId) {
              session.sessionId = sysMsg.session_id;
              this.emit('session_id', session.channelId, session.guildId, session.sessionId);
            }
            if ((sysMsg as any).subtype === 'local_command_output') {
              this.emit('local_command_output', session.channelId, (sysMsg as any).content);
            }
            session.state = 'idle';
            break;
          }
          case 'assistant': {
            this.emit('assistant', session.channelId, msg as SDKAssistantMessage);
            break;
          }
          case 'user': {
            this.emit('user', session.channelId, msg as SDKUserMessage);
            break;
          }
          case 'result': {
            const resultMsg = msg as SDKResultMessage;
            console.log(`[sdk:result] subtype=${resultMsg.subtype}, cost=$${resultMsg.total_cost_usd}`);
            session.totalCostUsd = resultMsg.total_cost_usd ?? session.totalCostUsd;
            session.state = 'idle';
            this.emit('result', session.channelId, resultMsg);
            break;
          }
          case 'stream_event':
            this.emit('stream_event', session.channelId, msg);
            break;
          case 'tool_progress':
            this.emit('tool_progress', session.channelId, msg);
            break;
          default: {
            // Handle rate_limit_event
            const anyMsg = msg as any;
            if (anyMsg.type === 'rate_limit_event' && anyMsg.rate_limit_info) {
              console.log('[sdk:rate_limit]', JSON.stringify(anyMsg.rate_limit_info));
              this.emit('rate_limit', session.guildId, anyMsg.rate_limit_info);
            }
            break;
          }
        }
      }
    } catch (err) {
      if (session.state === 'stopped' || session.state === 'archived') return; // closed on purpose
      console.error(
        `[session] Event processing error for channel ${session.channelId}:`,
        err,
      );
      session.state = 'stopped';
      this.emit('stopped', session.channelId);
      this.emit('error', session.channelId, err);
      return;
    }
    // The stream ended without stopSession(): the Claude process exited on its own. Say so, or the
    // channel looks alive while messages go nowhere.
    if (session.state !== 'stopped' && session.state !== 'archived') {
      console.warn(`[session] Session for channel ${session.channelId} ended unexpectedly`);
      session.state = 'stopped';
      this.emit('stopped', session.channelId);
      this.emit('ended', session.channelId);
    }
  }
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export const sessionManager = new SessionManager();
