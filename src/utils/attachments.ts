import fs from 'node:fs';
import path from 'node:path';
import type { Attachment, Collection, Snowflake } from 'discord.js';
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources';

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

const PDF_TYPE = 'application/pdf';

// Extensions treated as text even if contentType is missing or generic
const TEXT_EXTENSIONS = new Set([
  '.md', '.txt', '.ts', '.tsx', '.js', '.jsx', '.json', '.csv', '.xml',
  '.yaml', '.yml', '.toml', '.ini', '.cfg', '.sh', '.bash', '.zsh',
  '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp', '.html',
  '.css', '.scss', '.less', '.sql', '.graphql', '.env', '.gitignore',
  '.dockerfile', '.makefile', '.rb', '.php', '.swift', '.kt', '.lua',
  '.r', '.m', '.pl', '.ps1', '.bat', '.cmd', '.conf', '.log', '.diff',
  '.patch', '.svelte', '.vue',
]);

const MAX_IMAGE_BASE64_SIZE = 10 * 1000 * 1000; // 10 MB (base64-encoded) — API limit for inline images

export interface ProcessedAttachment {
  savedPath: string;
  contentBlocks: ContentBlockParam[];
}

// Detect the real image format from magic bytes. Discord's reported contentType can
// disagree with the actual bytes (e.g. clipboard pastes), and a mismatched media_type
// is rejected by the API — permanently breaking the session since history is replayed.
export function sniffImageMediaType(buf: Buffer): ImageMediaType | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  const head = buf.subarray(0, 6).toString('latin1');
  if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

function isTextFile(contentType: string | null, filename: string): boolean {
  if (contentType?.startsWith('text/')) return true;
  const ext = path.extname(filename).toLowerCase();
  return TEXT_EXTENSIONS.has(ext);
}

async function resolveFilename(dir: string, original: string): Promise<string> {
  const sanitized = path.basename(original);
  const ext = path.extname(sanitized);
  const base = path.basename(sanitized, ext);
  let candidate = sanitized;
  let counter = 0;

  while (fs.existsSync(path.join(dir, candidate))) {
    counter++;
    candidate = `${base}_${counter}${ext}`;
  }

  return candidate;
}

export async function processAttachments(
  attachments: Collection<Snowflake, Attachment>,
  cwd: string,
): Promise<ProcessedAttachment[]> {
  if (attachments.size === 0) return [];

  const attachDir = path.join(cwd, '.a4d', 'attachments');
  await fs.promises.mkdir(attachDir, { recursive: true });

  const results: ProcessedAttachment[] = [];

  for (const [, attachment] of attachments) {
    try {
      const response = await fetch(attachment.url);
      if (!response.ok) {
        console.error(`[attachments] Failed to download ${attachment.name}: HTTP ${response.status}`);
        continue;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const filename = await resolveFilename(attachDir, attachment.name);
      const savedPath = path.join(attachDir, filename);
      await fs.promises.writeFile(savedPath, buffer);

      const contentType = attachment.contentType;
      const blocks: ContentBlockParam[] = [];
      const imageType = sniffImageMediaType(buffer);

      if (imageType) {
        const data = buffer.toString('base64');
        if (data.length <= MAX_IMAGE_BASE64_SIZE) {
          blocks.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: imageType,
              data,
            },
          });
        } else {
          blocks.push({
            type: 'text',
            text: `[Image too large for inline preview (${formatSize(buffer.length)}). Saved to: ${savedPath}]`,
          });
        }
      } else if (contentType === PDF_TYPE) {
        blocks.push({
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: buffer.toString('base64'),
          },
        });
      } else if (isTextFile(contentType, attachment.name)) {
        const text = buffer.toString('utf-8');
        blocks.push({
          type: 'text',
          text: `--- ${attachment.name} ---\n${text}`,
        });
      } else {
        // Binary file — path reference only (no separate "saved to" line added in bot.ts)
        blocks.push({
          type: 'text',
          text: `[Binary file "${filename}" (${formatSize(buffer.length)}) saved to: ${savedPath}]`,
        });
      }

      results.push({ savedPath, contentBlocks: blocks });
    } catch (err) {
      console.error(`[attachments] Error processing ${attachment.name}:`, err);
    }
  }

  return results;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
