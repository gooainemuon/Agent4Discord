import { exec } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';
import {
  type ChatInputCommandInteraction,
  type TextChannel,
} from 'discord.js';
import { requireSessionChannel } from './sessionChannel.js';
import { chunkMessage } from '../formatters/chunker.js';

const execAsync = promisify(exec);
const EXEC_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_LENGTH = 8000;
const IS_WIN32 = os.platform() === 'win32';

/**
 * Handle `/a4d sh <command>` — execute a shell command in the session's cwd.
 */
export async function handleSh(interaction: ChatInputCommandInteraction): Promise<void> {
  const ctx = await requireSessionChannel(interaction);
  if (!ctx) return;
  const { channel, session } = ctx;

  const command = interaction.options.getString('command', true);

  await interaction.deferReply();

  try {
    const { stdout, stderr } = await execAsync(wrapCommand(command), {
      cwd: session.cwd,
      timeout: EXEC_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });

    const output = formatOutput(stdout, stderr, 0);
    await sendOutput(interaction, channel, command, output);
  } catch (err: any) {
    // exec rejects on non-zero exit or timeout
    if (err.killed) {
      await interaction.editReply({ content: `\`$ ${command}\`\n\nCommand timed out after 30 seconds.` });
      return;
    }

    const exitCode: number = err.code ?? 1;
    const output = formatOutput(err.stdout ?? '', err.stderr ?? '', exitCode);
    await sendOutput(interaction, channel, command, output);
  }
}

/**
 * Wrap the command for the current platform.
 * On Windows, use PowerShell with -EncodedCommand to force UTF-8 output
 * and avoid profile loading / escaping issues.
 */
function wrapCommand(command: string): string {
  if (!IS_WIN32) return command;

  const script = `[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);[Console]::InputEncoding=[System.Text.UTF8Encoding]::new($false);${command}`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return `powershell.exe -NoProfile -EncodedCommand ${encoded}`;
}

function formatOutput(stdout: string, stderr: string, exitCode: number): string {
  let output = '';

  // Filter out PowerShell CLIXML progress output from stderr
  const filteredStderr = stderr.replace(/#< CLIXML\r?\n<Objs[\s\S]*?<\/Objs>\r?\n?/g, '').trim();

  if (stdout) output += stdout;
  if (filteredStderr) {
    if (output && !output.endsWith('\n')) output += '\n';
    output += filteredStderr;
  }

  if (!output.trim()) {
    output = '(no output)';
  }

  // Truncate very long output
  if (output.length > MAX_OUTPUT_LENGTH) {
    output = output.slice(0, MAX_OUTPUT_LENGTH) + '\n... (truncated)';
  }

  if (exitCode !== 0) {
    output += `\n\nexit code: ${exitCode}`;
  }

  return output;
}

async function sendOutput(
  interaction: ChatInputCommandInteraction,
  channel: TextChannel,
  command: string,
  output: string,
): Promise<void> {
  const header = `\`$ ${command}\``;
  const codeBlock = `\`\`\`\n${output}\n\`\`\``;

  // If it fits in one message, use editReply
  const full = `${header}\n${codeBlock}`;
  if (full.length <= 2000) {
    await interaction.editReply({ content: full });
    return;
  }

  // Otherwise: header in editReply, chunks as follow-ups
  await interaction.editReply({ content: header });

  const chunks = chunkMessage(codeBlock);
  for (const chunk of chunks) {
    await channel.send(chunk);
  }
}
