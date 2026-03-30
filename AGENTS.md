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

## Testing Discipline

**Before and after any code change, you MUST:**

1. Check whether existing tests cover the changed code — run `npm run chatbot:test` (or the relevant agent test suite).
2. If no tests exist for the changed behaviour, write them first.
3. All tests must pass before committing. The pre-commit hook will also ask you to verify this.

Skipping tests is never acceptable — the pre-commit hook will block and ask you to confirm you have tested.

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
Agent Scripts (agents/*/main.ts)
  Deployed as launchd daemons, stdout streamed as SSE
```

### The 7 Agents (`lib/agents.ts` is the central registry)

| Agent                  | Schedule    | Purpose                                                                          |
| ---------------------- | ----------- | -------------------------------------------------------------------------------- |
| `experience-reflector` | Daily 00:00 | Scan Claude Code checkpoints → extract domain knowledge into project `MEMORY.md` |
| `get-shit-done`        | Every 5 min | Discover JIRA tickets → prioritize by DAG → forge in parallel → create PRs       |
| `release-log-sentinel` | Sun 10:00   | Monitor Claude Code releases for JSONL breaking changes                          |
| `memory-distiller`     | Sun 01:00   | Promote cross-project patterns → global `~/.claude/CLAUDE.md`                    |
| `oncall-analyzer`      | Daily 09:00 | Generate PIRs from PagerDuty/Datadog/Cloudflare incidents                        |
| `zendesk-triager`      | On-demand   | Investigate Zendesk tickets → search Slack → surface root causes                 |
| `dependabot-merger`    | Daily 10:00 | Review/merge Dependabot PRs with risk assessment                                 |

### Key Directories

- `agents/` — Agent scripts. `agents/lib/` holds shared utilities (claude runner, DAG, JIRA, lock, logger, repos).
- `skills/` — Claude Code skills used by agents. `npm run install` symlinks each into `~/.claude/skills/`; `npm run uninstall` removes them.
- `agents/get-shit-done/` — Most complex agent: discovery → prioritization → forge → merge → PR pipeline with git worktree isolation.
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

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **DovePaw** (2591 symbols, 5272 relationships, 211 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

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
