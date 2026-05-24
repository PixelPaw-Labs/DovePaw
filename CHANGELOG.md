# Changelog

All notable changes to DovePaw are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [0.1.0] — 2026-05-25

Initial public release of DovePaw — a macOS desktop app for building, scheduling, and orchestrating private Claude Code agents.

### Core Runtime

- **Dove orchestrator** — Claude Agent SDK `query()` session at the centre; Dove knows all installed agents and routes work to the right one via MCP tools
- **Three-layer architecture** — Browser UI → Claude Agent SDK (in-process MCP server) → A2A Servers → Agent Scripts
- **Dynamic agent registry** — agents discovered at runtime from installed plugins; no hardcoded agent list
- **Dynamic A2A ports** — each agent's Express server binds to an OS-assigned port at startup; Dove polls `~/.dovepaw/` to discover addresses; no port config required

### Agent Script Workflows

- **TypeScript workflow pattern** — TypeScript handles deterministic scaffolding; Claude CLI handles judgment; clean layer separation
- **Dual-mode entry** — same `main.ts` handles chatbot invocations (`process.argv[2]`) and scheduled batch runs (no argument)
- **`@dovepaw/agent-sdk`** — shared utilities: `spawnClaudeWithSignals()`, `createLogger()`, `emitProgress()`, `resolveClaudeSecurityOpts()`
- **Workflow spectrum** — from a single skill call to full multi-step pipelines with parallel repo processing and multi-agent handoffs

### A2A Protocol

- **`ask_*` / `start_*` / `await_*` tool trio** — one set per registered agent; blocking, fire-and-forget, and polling modes
- **Cron/launchd trigger via A2A** — scheduler fires one HTTP message; A2A server handles spawn, env, and streaming; scheduler has no knowledge of agent internals

### Scheduling

- **macOS launchd daemons** — agents with `schedulingEnabled: true` compile to `.plist` files registered with `launchctl`
- **Calendar and cron schedules** — `{ type: "calendar", hour: 9, minute: 0 }` or standard cron expressions
- **Settings UI schedule management** — toggle, edit, and activate agent schedules from the browser UI without touching config files
- **`npm run build`** — compiles agent scripts, generates plists, links skills into `~/.claude/skills/`

### Plugin System

- **Plugin repos** — agents packaged as ordinary git repos with a `dovepaw-plugin.json` manifest
- **Install from any git source** — GitHub slug, full HTTPS URL, SSH URL, or local path via `npm run plugin:add`
- **Private repo support** — plugins cloned using existing local git auth (SSH keys, gh CLI, HTTPS tokens)
- **`~/.dovepaw/tmp/` agents** — agents scaffolded into the tmp directory appear in the Dove sidebar immediately without a build step

### Agent Links and Handoff

- **Directional agent links** — `~/.dovepaw/agent-links.json` declares which agents can invoke which others, and with which A2A strategy
- **Heartbeat-gated connectivity** — links are only active when the target agent's A2A server is running
- **Description-as-contract** — `agent.json` `description` field is the MCP tool description; Dove uses it to decide routing and what to send

### Electron App and UI

- **Menubar app** — `DovePawA2A` Electron process keeps all A2A servers alive in the background; kill it and everything shuts down cleanly
- **Next.js chatbot UI** — browser-based chat at `localhost:7473`; SSE streaming for agent progress, tool calls, and text responses
- **Persistent agent sidebar** — all installed agents grouped by plugin; Dove pinned at top
- **Session history** — every agent run stored and resumable; reconnects to running sessions from history

### Embedded Browser

- **Embedded Chromium panel** — dedicated browser window inside the Electron app; separate from the user's Chrome browser
- **`dovepaw-browser` skill** — Claude Code skill for agent-driven browser automation: navigate, click, fill, screenshot, evaluate JS
- **Per-agent tab isolation** — each agent uses a named session; concurrent agents get separate tabs
- **Bridge server** — ephemeral local HTTP server exposes browser control API; port published to `~/.dovepaw/.browser-bridge-port.json`

### Security

- **Three security modes** — `read-only`, `supervised`, `autonomous`; configurable per Dove session
- **PreToolUse hook enforcement** — secondary gate blocks write tools and out-of-bounds paths independent of SDK permission model
- **`allowedDirectories` scoping** — agents restricted to their workspace, source directory, and persistent state directory
- **Sub-agent isolation** — each agent runs in an isolated workspace under `~/.dovepaw/workspaces/`; security mode propagated from Dove

### Developer Tooling

- **`/sub-agent-builder` skill** — scaffolds a new agent end-to-end from a description; writes to `~/.dovepaw/tmp/` for instant sidebar visibility
- **`/dovepaw-browser` skill** — browser automation skill usable from agent scripts or directly in chat
- **oxlint + oxfmt** — linting and formatting
- **Vitest** — test suite

[0.1.0]: https://github.com/PixelPaw-Labs/DovePaw/releases/tag/v0.1.0
