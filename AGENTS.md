# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DovePaw is a multi-agent orchestration system. Background TypeScript agents run as macOS launchd daemons, expose themselves via the A2A (Agent-to-Agent) SSE protocol, and are controlled through a Next.js chatbot UI backed by Claude Agent SDK with MCP tools.

## Commands

### Root Level

```bash
npm run build            # Compile all agents with tsup → dist/ (ESM + shebang)
npm run install          # Build + install all agents as launchd daemons
npm run uninstall        # Unload + remove all launchd daemons
npm run lint             # oxlint strict TypeScript linting
npm run fmt              # oxfmt formatting (100-col, trailing commas)
npm run fmt:check        # Verify formatting without modifying files
```

### Chatbot

```bash
npm run chatbot:install  # Install chatbot npm dependencies
npm run chatbot:dev:all  # Start A2A servers + Next.js dev concurrently (port 7473)
npm run chatbot:servers  # Start A2A servers only (dynamic ports, --watch)
npm run chatbot:dev      # Start Next.js dev only (port 7473)
npm run chatbot:build    # Production Next.js build
npm run chatbot:test     # Run vitest tests (chatbot/)
```

### Running a Single Test

```bash
cd chatbot && npx vitest run <test-file-pattern>
```

## Architecture

### Three-Layer System

```
Browser UI (port 7473)
  Next.js 15 / React 19
        ↓ SSE
Claude Agent SDK (in-process MCP server)
  ask_* / start_* / await_* MCP tools
        ↓ A2A SSE
A2A Servers (7 processes, dynamic ports)
  Express + @a2a-js/sdk → ScriptAgentExecutor
        ↓ spawn tsx
Agent Scripts (src/*/main.ts)
  Deployed as launchd daemons, stdout streamed as SSE
```

### The 7 Agents (`lib/agents.ts` is the central registry)

| Agent | Schedule | Purpose |
|-------|----------|---------|
| `experience-reflector` | Daily 00:00 | Scan Claude Code checkpoints → extract domain knowledge into project `MEMORY.md` |
| `get-shit-done` | Every 5 min | Discover JIRA tickets → prioritize by DAG → forge in parallel → create PRs |
| `release-log-sentinel` | Sun 10:00 | Monitor Claude Code releases for JSONL breaking changes |
| `memory-distiller` | Sun 01:00 | Promote cross-project patterns → global `~/.claude/CLAUDE.md` |
| `oncall-analyzer` | Daily 09:00 | Generate PIRs from PagerDuty/Datadog/Cloudflare incidents |
| `zendesk-triager` | On-demand | Investigate Zendesk tickets → search Slack → surface root causes |
| `dependabot-merger` | Daily 10:00 | Review/merge Dependabot PRs with risk assessment |

### Key Directories

- `src/` — Agent scripts. `src/lib/` holds shared utilities (claude runner, DAG, JIRA, lock, logger, repos).
- `src/get-shit-done/` — Most complex agent: discovery → prioritization → forge → merge → PR pipeline with git worktree isolation.
- `lib/` — Root build infrastructure: `agents.ts` (registry), `installer.ts` (launchd plist generation), `build.ts` (CLI).
- `chatbot/a2a/` — A2A Express servers (one per agent). `start-all.ts` allocates OS-assigned ports and writes `.ports.json`.
- `chatbot/a2a/lib/base-server.ts` — Port allocation, `ScriptAgentExecutor`, MCP bridge.
- `chatbot/app/api/chat/route.ts` — Main SSE endpoint; wires Claude Agent SDK + MCP tools to A2A servers.
- `chatbot/lib/query-tools.ts` — Defines `ask_*`, `start_*`, `await_*` MCP tool trio per agent.
- `chatbot/components/agent-chat.tsx` — Main UI component.

### Critical Patterns

**Agent tool naming:** MCP tool names are derived from the agent name in `lib/agents.ts` as `yolo_<agent_name_with_underscores>`.

**Dynamic ports:** No hardcoded ports. A2A servers bind to `port: 0` (OS-assigned). The manifest `chatbot/a2a/.ports.json` is written at startup and polled every 10s by the client.

**Parallel forging in GSD:** The get-shit-done agent spawns multiple Claude CLI subprocesses in isolated git worktrees for concurrent ticket forging. A worktree watchdog prevents orphaned trees.

**State directory:** `state/` holds LadybugDB DAG store (`state/.get-shit-done/dag-store.lbug`) and file-based locks. Do not modify without user permission.

**Environment isolation:** Agents run with a cleaned PATH (no asdf direct paths), `CLAUDECODE` unset to allow nested Claude CLI spawns. Per-agent env vars are injected at launchd install time from settings.

**After editing agents:** Always ask user before running `npm run install` — it reloads launchd daemons.

## Tech Stack

- **TypeScript** (strict, ES2023 target, ESNext modules)
- **Node.js 22** (via `.tool-versions`)
- **Next.js 15** + **React 19** — Chatbot UI
- **Express 5** — A2A server framework
- **tsup** — Agent bundler (outputs ESM `.mjs` with `#!/usr/bin/env node`)
- **tsx** — Run TypeScript agent scripts without pre-compilation
- **oxlint** + **oxfmt** — Linting and formatting (Rust-based, fast)
- **Vitest** — Testing (jsdom environment for chatbot)
- **@anthropic-ai/claude-agent-sdk** — Agentic loop + MCP tool execution
- **@a2a-js/sdk** — Agent-to-agent SSE protocol
- **@ladybugdb/core** — Embedded property graph DB (openCypher) for ticket DAG
- **Zod v4** — Schema validation for MCP tool parameters
- **Tailwind CSS v4** + **shadcn/ui** — UI styling
