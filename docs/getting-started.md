# Getting Started

> **macOS only.** DovePaw uses launchd for daemon scheduling and an Electron menubar app to keep A2A servers alive.  
> **Prerequisite:** Claude Code CLI installed and authenticated (`claude --version`), or `ANTHROPIC_API_KEY` set in your environment.

## First-Time Setup

```bash
git clone https://github.com/PixelPaw-Labs/DovePaw
cd DovePaw
npm install
npm run install    # builds the codebase, generates launchd plists, links skills to ~/.claude/skills/
npm run electron:dev
```

Click the DovePaw menubar icon to open the chatbot. Dove is ready.

`npm run install` does three things:

1. Compiles agent scripts to `dist/agents/`
2. Generates launchd `.plist` files and registers them with `launchctl`
3. Symlinks skills from `skills/` into `~/.claude/skills/`

It's only needed on first setup or after adding/removing agents.

## Day-to-Day

```bash
npm run electron:dev
```

That's it. Electron compiles the shell, launches the `DovePawA2A` menubar process, starts all A2A servers, and opens the chatbot UI. Kill Electron and everything goes down with it.

## Installing Your First Plugin

```bash
npm run plugin:add owner/my-agents      # GitHub slug — uses gh CLI auth
npm run install                          # regenerate plists for new agents
npm run electron:dev                     # restart to pick up new agents
```

For a private repo, any git URL works — SSH, HTTPS, or a local path:

```bash
npm run plugin:add git@github.com:org/private-agents
npm run plugin:add ../my-agents   # local path during development
```

DovePaw clones into `~/.dovepaw/plugins/` using your existing git credentials.

## Building Your First Agent

In Claude Code, run:

```
/sub-agent-builder
```

Describe what you want the agent to do. The skill generates `agent.json`, `main.ts`, and the plugin manifest — you write the logic.

Or create manually under `~/.dovepaw/tmp/` for quick testing:

```
~/.dovepaw/tmp/
  my-agent/
    agent.json
    main.ts
```

Agents in `~/.dovepaw/tmp/` appear in the sidebar under the **Kiln** group immediately — no install step needed.

## Troubleshooting

**Dove doesn't see my agent.** Run `npm run install` after adding the plugin, then restart with `npm run electron:dev`.

**Agent not running on schedule.** Check `launchctl list | grep dovepaw`. If the plist isn't listed, run `npm run install`. If it is listed but not firing, check the log at `~/.dovepaw/agents/logs/<name>.log`.

**Port conflict on startup.** A2A ports are OS-assigned — conflicts shouldn't happen. If a server won't start, check the port manifest at `~/.dovepaw/` for stale entries and restart Electron.

**Build fails after changing agent code.** Compiled artifacts at `~/.dovepaw/cron/` are generated — never edit them. Edit the source in the plugin repo and re-run `npm run install`.
