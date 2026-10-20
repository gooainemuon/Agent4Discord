<p align="center">
  <img src="https://raw.githubusercontent.com/raravel/Agent4Discord/main/docs/images/banner.png" alt="Agent4Discord" width="640">
</p>

<p align="center">
  <strong>Remote Claude Code sessions through Discord</strong>
</p>

<p align="center">
  <a href="README.ko.md">한국어</a>
</p>

---

Agent4Discord (A4D) is a self-hosted Discord bot that lets you interact with [Claude Code](https://docs.anthropic.com/en/docs/claude-code) through Discord channels. Each session maps to a dedicated channel, tool calls appear in threads, and permission requests show as interactive buttons.

**Your PC. Your bot. Your Claude Code sessions.**

## How It Works

<p align="center">
  <img src="https://raw.githubusercontent.com/raravel/Agent4Discord/main/docs/images/architecture.png" alt="Architecture" width="640">
</p>

1. You run the bot on your PC with your own Discord bot token
2. `/a4d init` sets up channels in your Discord server
3. Pick a working directory and start a Claude Code session
4. Chat with Claude through Discord — streaming, tool calls, and permissions all work

## Features

- **Directory Browser** — Navigate your filesystem with select menus, buttons, and create directories
- **Model & Permission Mode** — Choose opus/sonnet/haiku and permission level (default, auto-accept edits, full auto) when starting a session
- **Real-time Streaming** — Live-updating embeds for text output, thinking, and tool progress
- **Tool Call Threads** — Tool calls go to one thread per turn, attached to a short `🔧 Bash ×5 · Read` anchor message (no "started a thread" lines in the channel). `/a4d threads each` gives every call its own thread, `off` hides them. Inbox-polling calls (read-only tools mentioning `inbox`, or Bash `sleep`) go to a private `🔁 polling` thread instead
- **Permission Control** — Allow/Always Allow/Deny buttons only for risky calls (deletes, force push, installs, killing processes, secrets, unknown tools); everything else runs without asking
- **File Attachments** — Send files to Claude via Discord attachments, Claude can send files back
- **Completion Notification** — @mentions you when Claude finishes responding
- **Session Resume** — Resume CLI-created sessions or stopped sessions with `/a4d resume`
- **Resume Instructions** — After a bot restart, sessions resume on their own; if the session directory has `.claude/a4d-on-resume.md`, its text is sent to the session (e.g. to restart a background watch)
- **Session Lanes & Handoff** — Start a session with `너는 <session name>` to name it. `/a4d handoff` makes `YYYY-MM-DD-hhmm-<session name>/` (in the session directory unless `dir` is given) and has Claude write `HANDOFF.md`, `INBOX.md` and `WORKLOG.md` there. `/a4d clear` starts a fresh session in the same channel; a new session that opens with `너는 <session name>` reads the newest folder of that name and reports before continuing. In a project with `.planning/handoff/`, handoffs are single notes there instead (`YYYY-MM-DD-hhmm-<session name>.md`, one new file each time, never edited; the note says where the inbox and work log are)
- **Inbox Watch** — In a project with `.claude/a4d-inbox.json`, the bot watches the project's inbox folder for each named session and passes new message files addressed to that lane (path and first lines) to the session when it is idle. The watch survives restarts, resume and `/a4d clear`, so Claude needs no watch loop of its own; `/a4d inbox off` turns it off
- **Usage Tracker** — `#a4d-usage` channel shows session costs, tokens, and rate limits
- **Plugin Support** — Auto-loads your installed Claude Code plugins (skills, hooks)
- **CLI Interop** — Sessions share the same JSONL storage as the CLI

### Directory Browser
![Directory Browser](https://raw.githubusercontent.com/raravel/Agent4Discord/main/docs/images/screenshot-browser.png)

### Session with Streaming
![Session](https://raw.githubusercontent.com/raravel/Agent4Discord/main/docs/images/screenshot-session.png)

### Permission Request
![Permission](https://raw.githubusercontent.com/raravel/Agent4Discord/main/docs/images/screenshot-permission.png)

## Quick Start

### Prerequisites

- **Node.js** >= 20.x
- **Claude Code** authenticated (`claude login` or `ANTHROPIC_API_KEY`)
- **Discord bot token** ([create one here](https://discord.com/developers/applications))

### Setup

```bash
npx agent4discord@latest --setup
```

The setup wizard will:
1. Ask for your Discord bot token
2. Ask for your Client ID
3. Verify Message Content Intent is enabled
4. Generate an invite URL and open it in your browser

### Run

```bash
npx agent4discord@latest
```

### In Discord

1. Run `/a4d init` in your server
2. Go to `#a4d-session` and browse to a directory
3. Click **Session Start**, pick a model, and start chatting

## Commands

| Command | Description |
|---|---|
| `/a4d init` | Set up A4D channels in your server |
| `/a4d resume` | Resume a stopped session in the current channel |
| `/a4d model <opus\|sonnet\|haiku>` | Change model mid-session |
| `/a4d close` | Stop the session and delete the channel |
| `/a4d handoff [dir] [name]` | Create `YYYY-MM-DD-hhmm-<session name>/` and ask Claude to write the handoff note, inbox and work log (in `.planning/handoff/`: one new note `YYYY-MM-DD-hhmm-<session name>.md`) |
| `/a4d clear` | Start a fresh session in this channel (same folder, model and permissions, no history) |
| `/a4d threads <turn\|each\|off>` | How tool calls are shown: one thread per turn (default), one per call, or hidden |
| `/a4d inbox [on\|off\|status]` | The bot's watch of the project inbox for this lane (on by default; `on` re-reads the rules) |

## Channel Structure

```
A4D - General
├── #a4d-general      — Status messages
├── #a4d-session      — Directory browser & session start
└── #a4d-usage        — Usage & rate limit tracker

A4D - Sessions
├── #a4d-myproject    — Active session channel
└── #a4d-another      — Another session
```

## Configuration

Settings live in two places, so that each device can run its own bot and still behave the same way:

- `a4d.defaults.json` in the repository: behaviour shared by every device, kept in sync by git.
- `~/.agent4discord/config.json`: this device's bot (written by `--setup`). A behaviour setting here overrides the shared value on this device only. The token, client ID and owner IDs are never read from the shared file.

```json
// ~/.agent4discord/config.json
{
  "discordToken": "your-bot-token",
  "discordClientId": "your-client-id",
  "ownerIds": ["your-discord-user-id"]
}
```

```json
// a4d.defaults.json
{
  "claudeModel": "opus",
  "permissionMode": "default",
  "logLevel": "info",
  "maxSessionsPerUser": 100,
  "autoResumeSessions": true,
  "toolThreadMode": "turn"
}
```

`maxSessionsPerUser` (built-in default 10) caps how many sessions one user can run at once (start, resume and fork). It is re-read on every session start, so no restart is needed.

`autoResumeSessions` (default true) resumes the session channels under `A4D - Sessions` when the bot starts again. Each channel gets a one-line notice of the outcome.

`toolThreadMode` (default `turn`) is the tool-thread mode new sessions start with; `/a4d threads` changes it per session and the choice survives a resume. The private polling thread needs the bot's **Create Private Threads** permission; without it polling calls fall back to the turn thread.

### Session rules

The bot appends rules to every Discord session's system prompt in this order, skipping missing files:

1. `rules/discord.md` and `rules/handoff.md` in the repository: rules shared by every device (talking in Discord, approvals, start and handover procedures, the handoff note format).
2. `~/.claude/modes/discord.md`: extra rules for this device only.
3. `<project>/.claude/modes/discord.md`: the project's own rules.

### Inbox rules (per project)

Projects that keep one message per file in an inbox folder put their routing rules in `<project>/.claude/a4d-inbox.json`:

```json
{
  "dir": ".planning/inbox",
  "default": { "include": ["*총괄*{lane}*.md", "*총괄*-전레인-*.md"] },
  "lanes": {
    "증류-총괄": { "include": ["*.md"], "exclude": ["*총괄*"] },
    "증류-데이터셋": { "match": "데이터셋" }
  }
}
```

`dir` is relative to the session directory. `default` applies to every lane; `{lane}` stands for the lane's `match` (default: the session name). A `lanes.<session name>` entry replaces the default `include`/`exclude`. Patterns are file-name globs (`*`, `?`); `README.md` is never a message. Files the session wrote itself are skipped. After changing the file, run `/a4d inbox on` in the session to re-read it. Remove the project's own inbox watch loop from its instructions (CLAUDE.md, `.claude/a4d-on-resume.md`) once the bot watches; the bot also tells the session not to start one.

#### Session roster

A `## 세션` section in the inbox folder's `README.md` is the project's session roster: one lane per line, with its previous names when it was renamed. The project's hub session keeps it.

```markdown
## 세션
- 증류-총괄: 레인 조율, 사용자 보고
- 증류-데이터셋: 코퍼스 수집·검증 (이전: 데이터셋)
```

When `너는 <session name>` names a lane the roster does not list, the bot warns in the channel; for a previous name it gives the current one.

With `roster` in `.claude/a4d-inbox.json` instead of glob rules, the roster decides which lane gets a file:

```json
{ "dir": ".planning/inbox", "roster": { "hub": "증류-총괄", "everyone": ["전레인"] } }
```

File names read as `YYYY-MM-DD[-HHMM]-<sender>-<recipient>…-<title>.md`: the first word after the date and time is the sender, and later words equal to a session name or previous name in the roster are recipients (a name with `-` such as `esptts-총괄` counts as one). The hub lane gets every file it did not send; another lane gets a file that names it as a recipient or has an `everyone` word (default `전레인`). Without `hub`, the hub is the lane named or formerly named `총괄`. The roster is read when the watch starts, so run `/a4d inbox on` after changing it.

## Development

```bash
git clone https://github.com/raravel/Agent4Discord.git
cd Agent4Discord
npm install

# Dev mode with auto-reload
npx tsx watch src/cli.ts

# Type check
npx tsc --noEmit
```

## Project Structure

```
src/
├── cli.ts                    # Entry point
├── setup.ts                  # Interactive setup wizard
├── config.ts                 # Config loading (~/.agent4discord/)
├── bot.ts                    # Discord client & event handlers
├── guild.ts                  # Guild config persistence
├── commands/
│   ├── index.ts              # Slash command registry
│   ├── init.ts               # /a4d init
│   ├── resume.ts             # /a4d resume
│   ├── model.ts              # /a4d model
│   ├── close.ts              # /a4d close
│   ├── handoff.ts            # /a4d handoff
│   ├── clear.ts              # /a4d clear
│   ├── threads.ts            # /a4d threads
│   └── inbox.ts              # /a4d inbox
├── interactions/
│   ├── index.ts              # Interaction router
│   ├── directoryBrowser.ts   # Directory browser UI
│   └── permissionHandler.ts  # Allow/Always Allow/Deny buttons
├── sessions/
│   ├── sessionManager.ts     # SDK query() lifecycle
│   ├── sessionStore.ts       # Session persistence
│   ├── eventHandler.ts       # SDK events → Discord
│   ├── inboxConfig.ts        # .claude/a4d-inbox.json lane rules
│   ├── inboxWatch.ts         # Project inbox → session
│   ├── streamHandler.ts      # Streaming text/thinking embeds
│   ├── toolProgress.ts       # Tool execution progress
│   └── usageTracker.ts       # Rate limit & cost tracking
├── tools/
│   └── discordTools.ts       # MCP tools for Discord (file attachments)
├── formatters/
│   ├── embedBuilder.ts       # Discord embeds
│   ├── chunker.ts            # Message chunking
│   └── toolFormatter.ts      # Tool-specific formatting
└── utils/
    ├── filesystem.ts         # Directory listing
    ├── attachments.ts        # Discord attachment processing
    ├── plugins.ts            # Plugin auto-loader
    └── logger.ts             # Logging
```

## License

MIT
