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

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **DovePaw** (1773 symbols, 4820 relationships, 138 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## When Debugging

1. `gitnexus_query({query: "<error or symptom>"})` — find execution flows related to the issue
2. `gitnexus_context({name: "<suspect function>"})` — see all callers, callees, and process participation
3. `READ gitnexus://repo/DovePaw/process/{processName}` — trace the full execution flow step by step
4. For regressions: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` — see what your branch changed

## When Refactoring

- **Renaming**: MUST use `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first. Review the preview — graph edits are safe, text_search edits need manual review. Then run with `dry_run: false`.
- **Extracting/Splitting**: MUST run `gitnexus_context({name: "target"})` to see all incoming/outgoing refs, then `gitnexus_impact({target: "target", direction: "upstream"})` to find all external callers before moving code.
- After any refactor: run `gitnexus_detect_changes({scope: "all"})` to verify only expected files changed.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Tools Quick Reference

| Tool | When to use | Command |
|------|-------------|---------|
| `query` | Find code by concept | `gitnexus_query({query: "auth validation"})` |
| `context` | 360-degree view of one symbol | `gitnexus_context({name: "validateUser"})` |
| `impact` | Blast radius before editing | `gitnexus_impact({target: "X", direction: "upstream"})` |
| `detect_changes` | Pre-commit scope check | `gitnexus_detect_changes({scope: "staged"})` |
| `rename` | Safe multi-file rename | `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher` | Custom graph queries | `gitnexus_cypher({query: "MATCH ..."})` |

## Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED — indirect deps | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if critical path |

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/DovePaw/context` | Codebase overview, check index freshness |
| `gitnexus://repo/DovePaw/clusters` | All functional areas |
| `gitnexus://repo/DovePaw/processes` | All execution flows |
| `gitnexus://repo/DovePaw/process/{name}` | Step-by-step execution trace |

## Self-Check Before Finishing

Before completing any code modification task, verify:
1. `gitnexus_impact` was run for all modified symbols
2. No HIGH/CRITICAL risk warnings were ignored
3. `gitnexus_detect_changes()` confirms changes match expected scope
4. All d=1 (WILL BREAK) dependents were updated

## Keeping the Index Fresh

After committing code changes, the GitNexus index becomes stale. Re-run analyze to update it:

```bash
npx gitnexus analyze
```

If the index previously included embeddings, preserve them by adding `--embeddings`:

```bash
npx gitnexus analyze --embeddings
```

To check whether embeddings exist, inspect `.gitnexus/meta.json` — the `stats.embeddings` field shows the count (0 means no embeddings). **Running analyze without `--embeddings` will delete any previously generated embeddings.**

> Claude Code users: A PostToolUse hook handles this automatically after `git commit` and `git merge`.

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
