# DovePaw — Architecture Overview

DovePaw is a plugin-based multi-agent orchestration platform. It provides the runtime, chatbot UI, and tooling for running autonomous AI agents. Agents can be invoked directly via chat, triggered by an orchestrating agent, or scheduled as macOS launchd daemons — scheduling is optional and per-agent. Agent scripts themselves live in separate installable **plugin repos** — DovePaw does not bundle any agents directly.

## Three-Layer Runtime

```
Browser UI
  Next.js chatbot (port 7473)
        ↓ SSE
Claude Agent SDK  (in-process MCP server)
  ask_* / start_* / await_* tools — one trio per registered agent
        ↓ A2A SSE
A2A Servers  (one Express process per agent, OS-assigned ports)
        ↓ spawn tsx
Agent Scripts  (from installed plugin repos, run as launchd daemons)
```

Each agent exposes three MCP tools to the chatbot layer:

| Tool pattern | Behaviour |
|---|---|
| `ask_*` | Blocking — waits for the agent to complete |
| `start_*` | Fire-and-forget — returns a session ID immediately |
| `await_*` | Poll — retrieves the result of a prior `start_*` call |

## Plugin System

Agents are packaged as **plugin repos** — ordinary git repositories that contain a `dovepaw-plugin.json` manifest and one or more agent scripts. Plugins are installed via the CLI or the chatbot Settings UI. DovePaw clones the repo into `~/.dovepaw/plugins/`, reads the manifest, and writes per-agent config into `~/.dovepaw/settings.agents/`.

```
Plugin repo (e.g. owner/my-agents)
  dovepaw-plugin.json       — manifest: name, version, agent list
  agents/<agent-name>/
    agent.json              — agent metadata: schedule, icon, MCP description
    main.ts                 — agent entry point
```

`agents/` in the DovePaw repo root is a symlink to `~/.dovepaw/plugins/`, so every installed plugin's agents are visible to the build and A2A servers without any manual wiring.

## Key Concepts

**Dynamic agent registry.** The set of agents is determined at runtime by which plugins are installed, not hardcoded in DovePaw. The registry builds `AgentDef` objects from per-agent config files at startup.

**Dynamic ports.** A2A servers bind to OS-assigned ports at startup and publish a port manifest to `~/.dovepaw/`. The chatbot polls this manifest to discover server addresses — no hardcoded ports anywhere.

**MCP tool naming.** Each agent's MCP tool name is derived as `yolo_<agent_name_with_underscores>` from the agent's kebab-case name in its `agent.json`.

**Parallel execution.** Agents that support concurrent work (e.g. ticket forging) spawn multiple Claude CLI subprocesses in isolated git worktrees simultaneously. A watchdog reclaims orphaned worktrees on exit.

**Environment isolation.** Agent processes run with a sanitised environment (clean PATH, `CLAUDECODE` unset) so nested Claude CLI invocations work correctly. Per-agent secrets are injected at daemon install time from settings.

**User data directory.** All runtime state lives outside the repo under `~/.dovepaw/`:
- `plugins/` — installed plugin repos
- `plugins.json` — plugin registry
- `settings.json` — global settings (repositories, API keys)
- `settings.agents/` — per-agent config (schedule, env vars, plugin path)
- `workspaces/` — isolated agent execution roots
- `cron/` — compiled daemon scripts deployed by `npm run install`

## Tech Stack

| Layer | Technology |
|---|---|
| UI | Next.js + React, Tailwind CSS + shadcn/ui |
| Agent SDK | @anthropic-ai/claude-agent-sdk |
| Agent protocol | @a2a-js/sdk (SSE) |
| Agent runtime | TypeScript via tsx, bundled with tsup |
| Daemon management | macOS launchd |
| Schema validation | Zod |
| Linting / formatting | oxlint + oxfmt |
| Testing | Vitest |
