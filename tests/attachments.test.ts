import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Attachment, Collection, Snowflake } from 'discord.js';
import { processAttachments, sniffImageMediaType } from '../src/utils/attachments.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const GIF = Buffer.from('GIF89a\0\0\0\0\0\0', 'latin1');
const WEBP = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WEBP', 'latin1')]);

describe('sniffImageMediaType', () => {
  it('detects formats from magic bytes', () => {
    expect(sniffImageMediaType(PNG)).toBe('image/png');
    expect(sniffImageMediaType(JPEG)).toBe('image/jpeg');
    expect(sniffImageMediaType(GIF)).toBe('image/gif');
    expect(sniffImageMediaType(WEBP)).toBe('image/webp');
  });

  it('returns null for unknown or truncated data', () => {
    expect(sniffImageMediaType(Buffer.from('hello world!'))).toBeNull();
    expect(sniffImageMediaType(Buffer.from([0x89, 0x50]))).toBeNull();
    expect(sniffImageMediaType(Buffer.alloc(0))).toBeNull();
  });
});

describe('processAttachments', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'a4d-attach-'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  function run(name: string, contentType: string | null, body: Buffer) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body)));
    const attachments = new Map([
      ['1', { name, contentType, url: 'https://cdn.example/x' } as Attachment],
    ]) as unknown as Collection<Snowflake, Attachment>;
    return processAttachments(attachments, cwd);
  }

  it('uses the sniffed media type when Discord reports a different one', async () => {
    const [result] = await run('pasted.webp', 'image/webp', PNG);
    const block = result.contentBlocks[0];
    expect(block.type).toBe('image');
    expect(block.type === 'image' && block.source.type === 'base64' && block.source.media_type).toBe('image/png');
  });

  it('does not send an image block when bytes are not a supported image', async () => {
    const [result] = await run('broken.png', 'image/png', Buffer.from('not really an image'));
    expect(result.contentBlocks.every((b) => b.type !== 'image')).toBe(true);
    expect(result.contentBlocks[0].type === 'text' && result.contentBlocks[0].text).toContain(result.savedPath);
  });

  it('does not inline images whose base64 size exceeds the API limit', async () => {
    // 8 MB raw -> ~10.7 MB base64, over the 10 MB limit
    const big = Buffer.concat([PNG, Buffer.alloc(8 * 1024 * 1024)]);
    const [result] = await run('big.png', 'image/png', big);
    expect(result.contentBlocks.every((b) => b.type !== 'image')).toBe(true);
  });
});
