# Phase 2 — Design file structure, then generate source files

Read the one template that matches the chosen agent type — do not read the others:

| Type          | Read now                                  |
| ------------- | ----------------------------------------- |
| Simple        | `references/template-simple.md`           |
| Static Skill  | `references/template-simple.md`           |
| Dynamic Skill | `references/template-skill-based.md`      |
| Stateful      | `references/template-complex-stateful.md` |

For **Static Skill** agents: `main.ts` follows the Simple template structure (thin launcher, no skill dir management), but the task logic goes into `SKILL.md` in Phase 4 instead of inline in the prompt.

Also read `references/spawning-patterns.md` now — required for the spawning rules below.

The template is a **starting point**, not a rigid layout. Before writing any files, analyse the agent's requirements and decide the file structure:

**Apply SOLID principles to derive the file structure:**

- **S — Single Responsibility:** `main.ts` owns only process lifecycle, config constants, and top-level flow. Each module owns exactly one concern. If a file is doing two things, split it.
- **O — Open/Closed:** Put variable logic (prompts, discovery queries, state format) in modules that can be extended without touching `main.ts`.
- **D — Dependency Inversion:** Infrastructure (log, dirs, instruction) flows **down as function params** into modules — modules never read from `process.env` directly.

Practical rules:

1. Identify each distinct logical concern (prompt building, data discovery, state management, skill lifecycle, parallel orchestration). For each:
   - **Simple** (a few lines, no branching) → keep inline in `main.ts`
   - **Substantial** (own logic, data types, or >~30 lines) → extract to a named module
2. Name modules after **what they do**: `skill-builder.ts`, `state.ts`, `discover.ts`, `prompts.ts`, `run.ts`
3. Do not over-split — three concerns in one file beats three files doing one line each.

Substitute all `{{PLACEHOLDER}}` values in every file before writing.

**Instruction passing:**

The A2A executor spawns the agent as `tsx main.ts "<instruction>"`. The user's message arrives as `process.argv[2]`. Every agent template must read it at the top:

```typescript
const INSTRUCTION = process.argv[2] || "";
```

Then pass it through to Claude — either appended to the prompt string (`Instruction: ${INSTRUCTION}`) or as part of the skill invocation (`/${skillName}\n\n${INSTRUCTION}`). Never silently discard it; it is the user's intent for that specific run.

**Never parse `INSTRUCTION`.** `INSTRUCTION` is free-form natural language from the user — never split, tokenise, or extract structured data from it (no `.split("\n")`, no regex extraction of IDs, no format assumptions). The agent that receives it is responsible for interpreting it. If the agent needs to act on multiple repos or targets, it discovers them from `REPO_LIST` or external APIs — not by parsing the instruction string.

**Use async/await throughout:**

All agent functions that perform I/O must be `async`. Synchronous I/O (`readFileSync`, `execSync`, etc.) blocks the Node.js event loop — use async equivalents. The only acceptable exception is top-level module-init code that genuinely cannot be awaited (e.g. a static constant derived from a synchronous path resolution), and that must be a deliberate, commented choice.

**Always prefer `@dovepaw/agent-sdk` over custom implementations:**

Before writing any utility code, read `~/.dovepaw/sdk/src/index.ts` to get the current list of SDK exports. Never re-implement what the SDK already provides — if a function, constant, or type exists there, import and use it.

**Workspace is always fresh:**

`AGENT_WORKSPACE` is a clean, empty directory created for each run — it contains no files from previous runs and no history. Never assume any file pre-exists in the workspace. If the agent needs state that survives between runs, use `agentPersistentStateDir()` from the SDK — never write persistent data to `AGENT_WORKSPACE`.

**Spawning rules:**

- Default env var for repo list is `REPO_LIST` — use this name in the `parseRepos("REPO_LIST")` call. Do NOT add `REPO_LIST` to `agent.json` envVars — it is auto-injected by the executor from the agent's `repos` config (local paths resolved at spawn time).
- **Always provide both `claudeOpts` and `codexOpts`** in every `runner.run()` call — `AgentRunner` picks the active runner's opts and ignores the other. Omitting either means switching `AGENT_SCRIPT_MODEL` leaves the new runner unconfigured (no permission mode, no sandbox).
- **Before writing any runner opts or `main.ts`**, ask 1 `AskUserQuestion` with these sub-questions (combine into one call):
  1. **Spawning pattern** — "Which spawning pattern should this agent use?" — present all options with a recommended default inferred from the agent's purpose; never silently choose:
     - **Pattern A — single run, all repos as `additionalDirectories`** — one Claude invocation reads all repos at once. Use when the task needs cross-repo context (e.g. compare dependencies across repos). `cwd: WORK_DIR`.
     - **Pattern A multi-repo — one run per repo in parallel** — `Promise.all` over repos, each with `additionalDirectories: [repo]` and `cwd: WORK_DIR`. Use when each repo is processed independently (e.g. per-repo audit or summary).
     - **Pattern B — worktree per repo** — one Claude invocation per repo, `cwd: repo`, `claudeOpts: { worktree: branch }`. Claude Code owns the worktree lifecycle — no `git worktree add/remove` in the skill. Use when the agent writes to repos or needs an isolated branch checkout per repo.
     - **Pattern C — multi-step session chain** — step 1 discovers, step 2 acts using the same session (`resumeSession`). Use when sequential steps need shared context.

  2. **Claude permission mode** — "What level of access does the Claude subagent need?"
     - `default` — inspect files only, no writes or commands (prompts for approval)
     - `acceptEdits` — read + write files, run commands (recommended for most agents)
     - `bypassPermissions` — full autonomy, no prompts at all (for fully automated daemons)

  3. **Codex sandbox mode** _(only ask if `model: "gpt-*"` is set)_ — "Does this agent need CLI tools that read credentials from the local machine (`gh`, `git`, `aws`, etc.)?"
     - **Yes** → `sandboxMode: "danger-full-access"`
     - **No** → `sandboxMode: "workspace-write"`

- Implement `main.ts` using the pattern the user selected. Key rules per pattern:
  - **Pattern A (single):** `cwd: WORK_DIR`, `additionalDirectories: REPOS`
  - **Pattern A (multi-repo):** `Promise.all(REPOS.map(...))`, `cwd: WORK_DIR`, `additionalDirectories: [repo]` per run
  - **Pattern B:** `Promise.all(REPOS.map(...))`, `cwd: repo`, `claudeOpts: { worktree: branch }` — never use `WORK_DIR` as cwd; Claude Code manages worktree lifecycle automatically
  - **Pattern C:** two `runner.run()` calls sharing a `sessionId`; step 1 uses `claudeOpts: { sessionId }`, step 2 uses `resumeSession: sessionId`
- If agent has sequential steps that share context: chain with `--session-id` / `--resume`
- Single-step agents: plain `-p` prompt, no worktree, no session chaining

**Skill-based agents — only pre-fetch what the skill needs to be configured:**

In `main.ts`, only fetch the minimal data needed to _build_ the skill (e.g. PR branch names, repo paths, failing check names from a status rollup). Never pre-fetch data that requires the repo's runtime context — CI logs, authenticated API calls, log files — in `main.ts`. That data belongs in the skill body, where the agent has the right context, can handle errors dynamically, and can decide what to look at. Pre-fetching context-heavy data in `main.ts` is fragile: it runs before the worktree exists, may time out, and produces stale snapshots the agent can't adapt from.

**Phase 2 gate — verify before proceeding:**

- [ ] All `{{PLACEHOLDER}}` values substituted in every written file
- [ ] `INSTRUCTION` read from `process.argv[2]` and passed through to Claude as plain text — never parsed, split, or regex-matched
- [ ] No SDK function re-implemented — every utility traced to `@dovepaw/agent-sdk`
- [ ] Spawning pattern matches the user's explicit selection — never silently chosen by inference
- [ ] No dead code, no unused imports

Fix any failures before continuing.
