---
name: sub-agent-builder
description: "Scaffold a new DovePaw background agent end-to-end. Creates agent files in ~/.dovepaw/tmp/ so the agent appears immediately in the Kiln sidebar group, ready to test. Optionally publishes to a plugin repo. Use when asked to 'create a new agent', 'scaffold an agent', 'add a new background agent', 'build a new daemon', or when the user wants to automate a recurring or on-demand task with a DovePaw agent."
argument-hint: "Optional: agent name and/or purpose description"
allowed-tools: Read, Write, Edit, Bash(mkdir *), Bash(python3 *), Bash(ls *), Bash(cat *), Glob, Grep, AskUserQuestion
hooks:
  Stop:
    - hooks:
        - type: command
          command: 'node "${CLAUDE_PROJECT_DIR}/.claude/skills/sub-agent-builder/hooks/quality-gate.js"'
---

## Inputs

`$ARGUMENTS` — optional agent name and/or purpose. Parse any name/purpose hints before asking questions.

## System Requirements

- DovePaw must be installed (`~/.dovepaw/` must exist)
- Read `~/.dovepaw/settings.json` to discover configured repositories before Round 2 questions

---

## Execution

### Phase 1 — Requirements Gathering

**Round 1** — parse `$ARGUMENTS` first, then ask 3 questions in a single `AskUserQuestion` call:

1. **Purpose** — "What should this agent do?" — free text via Other
2. **Plugin repo** — "Which plugin repo will this agent eventually live in?" — run `ls ~/.dovepaw/plugins/` and offer each dir basename as an option, plus "None / decide later"
3. **Agent type** — "Which pattern fits this agent?" — present 4 options with code previews:
   - **Simple** — single agent spawn with a short inline prompt. Use when the task is trivial (< 15 prompt lines) and needs no separate skill file. Set `model: "gpt-5.5"` to use Codex instead of Claude. **If the agent needs repository access or worktree isolation, use Claude (default) — Codex does not support worktrees.**
   - **Static Skill** (Recommended for multi-step agents) — `main.ts` is a thin launcher; all task logic lives in a `SKILL.md` in the `skills/` folder. `main.ts` invokes it via `Skill("/skill-name ${INSTRUCTION}")`. Use this when the prompt is substantial (> 15 lines), multi-phase, or the skill should be independently invocable as `/skill-name`.
   - **Dynamic Skill** — `main.ts` pre-fetches runtime data (PR branches, CI failures, API status), injects it into a temporary skill built in memory, runs Claude, then deletes the skill dir. **Only use when the pre-fetched data must be structurally embedded in the skill body** — not merely for passing the user's instruction through (Static Skill handles that cleanly).
   - **Stateful** — lock + state dir + orchestration (for scheduled agents requiring mutual exclusion)

**Round 2** — read `~/.dovepaw/settings.json`, extract `repositories` array (each has `id`, `path`), then ask 3 questions in a single `AskUserQuestion` call:

1. **Schedule** — "Enable scheduled runs?" — options:
   - On-demand only (Recommended) — triggered manually from chatbot
   - Interval — runs every N seconds
   - Calendar — runs at a fixed time daily/weekly

2. **Repositories** — "Which repositories should this agent access?" — multi-select; show basename of each `path`; include "None" option

3. **Env vars** — "Which environment variables does this agent need?" — infer from purpose (Jira → `JIRA_API_KEY`, GitHub → `GITHUB_TOKEN`, Slack → `SLACK_BOT_TOKEN`, email → `GMAIL_TOKEN`, Linear → `LINEAR_API_KEY`); multi-select; include "None" option

---

### Phase 2 — Design file structure, then generate source files

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

**Spawning rules (use judgment):**

- Always run Claude in `AGENT_WORKSPACE` — never change cwd to `REPOS[0]`. `REPOS` is a list; the agent may need all of them.
- Default env var for repo list is `REPO_LIST` — use this name in the `parseRepos("REPO_LIST")` call. Do NOT add `REPO_LIST` to `agent.json` envVars — it is auto-injected by the executor from the agent's `repos` config (local paths resolved at spawn time).
- **Always provide both `claudeOpts` and `codexOpts`** in every `runner.run()` call — `AgentRunner` picks the active runner's opts and ignores the other. Omitting either means switching `AGENT_SCRIPT_MODEL` leaves the new runner unconfigured (no permission mode, no sandbox).
- **Before writing runner opts**, ask 1 `AskUserQuestion` with two sub-questions (combine into one call):
  1. **Claude permission mode** — "What level of access does the Claude subagent need?"
     - `readOnly` — inspect files only, no writes or commands
     - `acceptEdits` — read + write files, run commands (recommended for most agents)
     - `bypassPermissions` — full autonomy, no prompts at all (for fully automated daemons)

  2. **Codex sandbox mode** _(only ask if `model: "gpt-*"` is set)_ — "Does this agent need CLI tools that read credentials from the local machine (`gh`, `git`, `aws`, etc.)?"
     - **Yes** → `sandboxMode: "danger-full-access"` (removes Codex's filesystem boundary so `~/.config/`, `~/.ssh/`, `~/.aws/` are accessible)
     - **No** → `sandboxMode: "workspace-write"` (Codex stays sandboxed to the workspace)

- If repos selected and agent is read-only: pass all repos as `--add-dir` flags: `REPOS.flatMap(r => ["--add-dir", r])`
- If repos selected and agent writes to one specific repo: use that repo as cwd with `claudeOpts: { worktree: branch }` — **Claude Code owns the worktree lifecycle**. It creates and removes the worktree automatically. The skill body must NOT contain `git worktree add` or `git worktree remove` commands. Orient the agent in the skill body with: "You are already checked out on branch `<branch>`. Work in the current directory."
- If repos selected and agent is read-only: pass all repos as `additionalDirectories`; no worktree
- If the agent processes each repo/target independently (one Claude run per target): **always spawn in parallel with `Promise.all`** — never loop sequentially. Extract a `fixItem(...)` / `processRepo(...)` function and map over entries. See Pattern A (multi-repo) in `references/spawning-patterns.md`.
- If agent has sequential steps that share context: chain with `--session-id` / `--resume`
- Single-step agents: plain `-p` prompt, no worktree, no session chaining

**Skill-based agents — only pre-fetch what the skill needs to be configured:**

In `main.ts`, only fetch the minimal data needed to _build_ the skill (e.g. PR branch names, repo paths, failing check names from a status rollup). Never pre-fetch data that requires the repo's runtime context — CI logs, authenticated API calls, log files — in `main.ts`. That data belongs in the skill body, where the agent has the right context, can handle errors dynamically, and can decide what to look at. Pre-fetching context-heavy data in `main.ts` is fragile: it runs before the worktree exists, may time out, and produces stale snapshots the agent can't adapt from.

**Phase 2 gate — verify before proceeding:**

- [ ] All `{{PLACEHOLDER}}` values substituted in every written file
- [ ] `INSTRUCTION` read from `process.argv[2]` and passed through to Claude as plain text — never parsed, split, or regex-matched
- [ ] No SDK function re-implemented — every utility traced to `@dovepaw/agent-sdk`
- [ ] Spawning pattern (A/B/C) matches the agent's repo access needs
- [ ] No dead code, no unused imports

Fix any failures before continuing.

---

### Phase 3 — Create agent.json

Read `references/agent-registration.md` now — it has the agent.json template and the full icon/color catalog.

Ask 1 question via `AskUserQuestion`:

- **Icon** — "Which icon suits this agent best?" — suggest 4 options inferred from purpose: analytics/reasoning → `Brain`, automation → `Zap`, alerts/incidents → `BellRing`, docs → `FileText`, code → `GitMerge`, search → `Search`, time → `Clock`, data → `Database`

Create `~/.dovepaw/tmp/<name>/agent.json` using the template in `references/agent-registration.md`.

Fill in all fields:

- `name` — kebab-case
- `alias` — 2–3 char shorthand (make it unique)
- `displayName` — human-readable title
- `description` — MCP tool description Dove uses to route requests
- `personality` — 1–3 sentence character paragraph; write in second person ("You are…"); replaces the generic "You are one of Dove's mice…" opening in the sub-agent system prompt
- `schedulingEnabled` — `true` only if interval/calendar
- `schedule` — include only when schedulingEnabled; use `"interval"` or `"calendar"` type
- `repos` — UUIDs from settings.json matching selected repo paths
- `envVars` — `[{ "id": "<uuid>", "key": "VAR", "value": "", "isSecret": true }]` for each required var — `id` is required by the schema (use `crypto.randomUUID()` pattern: generate a fresh UUID for each entry)
- `iconName` / `iconBg` / `iconColor` — from icon choice (see color palettes in `references/agent-registration.md`)
- `doveCard` — write a concise title + description + starter prompt
- `suggestions` — exactly 3 chips in this fixed order:
  1. **How does it work?** — title `"How does it work?"`, prompt `"How does {{DISPLAY_NAME}} work?"`
  2. **Last run logs** — title `"Last run logs"`, prompt `"Show {{DISPLAY_NAME}} logs"`
  3. **Run the agent** — title `"Run the agent"`, description and prompt depend on whether the agent needs user-provided input at runtime:
     - **No input needed** (self-contained, e.g. a scheduled digest): prompt = `"Run {{DISPLAY_NAME}} now"`
     - **Input needed** (e.g. ticket number, URL, repo name): prompt = `"Run {{DISPLAY_NAME}} — I'll need a few details from you: {{what to ask}}"` — phrase it as an invitation so the user knows to provide the missing info
  4. **What does it need?** — title `"What does it need?"`, prompt = `"What does {{DISPLAY_NAME}} need to run? List its dependencies, required env vars, and any setup steps."` — always fixed, no variation needed

Do NOT set `pluginPath` — that is added at publish time.

**Phase 3 gate — verify before proceeding:**

- [ ] All required fields present: `name`, `alias`, `displayName`, `description`, `personality`, `schedulingEnabled`, `repos`, `envVars`, `iconName`, `iconBg`, `iconColor`, `doveCard`, `suggestions`
- [ ] `pluginPath` is NOT set
- [ ] Every `envVars` entry has an `id` UUID (missing `id` silently drops the agent from Kiln)
- [ ] Icon values match an actual entry in `references/agent-registration.md`

Fix any failures before continuing.

After writing `agent.json`, bootstrap the agent's `node_modules` so `@dovepaw/agent-sdk` resolves at runtime:

```bash
python3 -c "
import os
base = os.path.expanduser('~/.dovepaw/tmp/<name>')
pkg_dir = os.path.join(base, 'node_modules', '@dovepaw')
os.makedirs(pkg_dir, exist_ok=True)
sdk_target = os.path.expanduser('~/.dovepaw/sdk')
link = os.path.join(pkg_dir, 'agent-sdk')
if not os.path.exists(link):
    os.symlink(sdk_target, link)
"
```

---

### Phase 4 — Associated Skill

**Skip Phase 4 entirely** if the agent type is **Dynamic Skill** — it generates a skill in memory at runtime and must not have a static SKILL.md alongside it. Proceed directly to Phase 5.

**If the agent type is Static Skill**, the skill body must be created now — it IS Phase 4. The agent already has a thin `main.ts` from Phase 2; the skill file gives it its logic. Proceed with Phase 4 to create `SKILL.md` in `skills/<name>/`.

Ask 2 questions in a single `AskUserQuestion` call:

1. **Create a skill?** — "Should this agent have an associated skill?" — options:
   - Yes — create a `SKILL.md` alongside the agent (Recommended for agents with multi-step Claude prompts)
   - No — embed the logic in `main.ts` directly (for pure TypeScript orchestrators or trivial 3-line prompts)
   - Skip for now — add later

2. **Suggested skill name** — pre-fill with the agent name (kebab-case); ask the user to confirm or override. Note that skill name is also the `/skill-name` command users invoke directly.

If the user selects **No** or **Skip**, end Phase 4 here.

If the user selects **Yes**, proceed to create the skill:

#### Skill file location

When building a tmp agent, skill files live in a `skill/` subdirectory — separate from the agent source files:

```
~/.dovepaw/tmp/<name>/               ← agent source (main.ts, agent.json, run.ts, etc.)
~/.dovepaw/tmp/<name>/skill/         ← skill files (SKILL.md, references/, scripts/, etc.)
~/.claude/skills/<name>/             ← symlink pointing to ~/.dovepaw/tmp/<name>/skill/
~/.codex/skills/<name>/              ← symlink pointing to ~/.dovepaw/tmp/<name>/skill/
```

Create the `skill/` dir and symlinks with Python (bypasses shell permission checks):

```bash
python3 -c "
import os
skill_dir = os.path.expanduser('~/.dovepaw/tmp/<name>/skill')
os.makedirs(skill_dir, exist_ok=True)
for skills_root in ['~/.claude/skills/<name>', '~/.codex/skills/<name>']:
    link = os.path.expanduser(skills_root)
    os.makedirs(os.path.dirname(link), exist_ok=True)
    if not os.path.exists(link):
        os.symlink(skill_dir, link)
"
```

Write `SKILL.md` (and any `references/`, `scripts/` subdirs) inside `~/.dovepaw/tmp/<name>/skill/`.

When publishing to a plugin repo:

```
skills/<name>/SKILL.md               ← inside plugin repo
```

Read `references/skill-authoring.md` for the SKILL.md schema, argument patterns, output contracts, subdirectory conventions, and hooks.

Read `references/skill-best-practices.md` before writing the SKILL.md body — apply every principle to the content you generate.

**Let the agent decide, not the skill:**

When writing the SKILL.md body, describe _what_ to achieve, not _how_ to execute it. Do not hardcode specific CLI commands, tool flags, or file paths unless they are fully deterministic and verifiable by code within the skill itself. Leave search, discovery, and approach decisions to the executing agent — it can explore the environment and choose the right method. Hardcoding a command that may not exist, vary by environment, or have a better alternative forces the agent to follow a broken path instead of finding the right one.

Fetch https://code.claude.com/docs/en/skills.md for the authoritative SKILL.md frontmatter schema and format — use it to validate your output before writing.

#### Agent → skill invocation

**When a skill is created, the skill owns the core task logic.** Go back and update `main.ts`:

1. Replace the main prompt string with `Skill("/skill-name ${INSTRUCTION}")`.
2. If a `prompts.ts` was written in Phase 2 solely to build the task prompt, delete it — the skill body replaces it. Small utility prompts (e.g. a one-liner status message) may stay.
3. Do NOT duplicate the task description in both `prompts.ts` and SKILL.md — one source of truth.

In `main.ts`, the agent embeds the skill call in the prompt string it passes to `runner.run`:

```typescript
// Positional args — simple single-value invocation
const prompt = `Skill("/zendesk-triager ${INSTRUCTION}")`;

// key="value" pairs — multi-param invocation
const skillArgs = `package="${name}" ecosystem="${ecosystem}" fix="${fix}" manifest="${manifest}"`;
const prompt = lines.join("\n");
// lines includes: `Skill("/security-patcher ${skillArgs}")`

// JSON args — multi-package batch
const skillArgs = JSON.stringify({ manifest, ecosystem, ticket, packages });
// lines includes: `Skill("/security-patcher ${skillArgs}")`
```

The skill receives these via `$ARGUMENTS` — parse them at the top of the SKILL.md.

#### Output contract

Skills that are called by agents in a loop (fix → test → retry) must emit a structured result as the **last line** of their response so the agent can parse it:

```
{"status": "patched"|"partial"|"failed", "summary": "...", "approach": "..."}
```

Skills called for their side effects only (write file, open PR) need no structured output — plain text completion is fine.

#### Plugin manifest

When publishing to a plugin repo, add the skill name to `dovepaw-plugin.json`:

```json
{
  "agents": ["my-agent"],
  "skills": ["my-agent"]
}
```

Skills and agents are listed independently — a skill can exist without a same-named agent, and vice versa.

**Phase 4 gate** (only if a skill was created) **— verify before proceeding:**

- [ ] SKILL.md frontmatter has `name`, `description`, and `argument-hint`; schema matches https://code.claude.com/docs/en/skills.md
- [ ] `$ARGUMENTS` parsing documented at the top of the body
- [ ] Output contract defined: structured JSON last line if agent calls in a loop; plain text otherwise
- [ ] `main.ts` invokes the skill via `Skill("/skill-name ${INSTRUCTION}")` — task logic is not duplicated in a separate `prompts.ts`
- [ ] If the skill body invokes other skills via `Skill("/other-skill ...")`, every tool required by those sub-skills is present in `allowed-tools` (e.g. `Glob`, `Grep` for `/git-commit` and `/create-pr`)

Fix any failures before continuing.

---

### Phase 5 — Integration Check

Read `references/integration-checklist.md` now for lint/fmt commands and path reference.

Read each created file back and verify against this checklist. Fix any issue found, then re-check until every item passes:

- **main.ts** — all `{{PLACEHOLDER}}` values substituted; spawning pattern matches the chosen Option A/B/C; `INSTRUCTION` is passed through to Claude; no dead branches; `publishStatusToUI` called at meaningful steps (awaited); subprocess env is correct (no `CLAUDECODE`, clean PATH)
- **agent.json** — all required fields present; `pluginPath` is NOT set; every entry in `envVars` has an `id` UUID (missing `id` causes Zod to silently drop the agent from the Kiln group)
- **SKILL.md** (if created) — frontmatter is valid for Claude Code; argument pattern is documented; output contract is defined

End with a confidence score JSON on its own line:

```json
{"confidence": <0-100>, "issues": ["<any remaining issue>"]}
```

The Stop hook requires `confidence >= 90` to proceed. Emit this only after all fixes are complete — it must reflect the post-fix state.

Tell the user: "Your agent is ready. **Refresh the page** to see it appear under the **Kiln** group in the sidebar (Sparkles icon)."

Ask 1 question via `AskUserQuestion`:

- **Restart A2A servers?** — "Restart DovePaw A2A servers to register the new agent?" — options:
  - Yes — restart `npm run chatbot:servers` now (Recommended)
  - No, I'll handle it later

If the user selects **Yes**, remind them to run `npm run chatbot:servers` in the DovePaw project root to start the new agent's A2A server.

---

### Phase 6 — Publish to Plugin Repo

Ask 2 questions in a single `AskUserQuestion` call:

1. "Move agent from Kiln to plugin repo and push?" — options:
   - Yes, move and push now (Recommended)
   - Move locally only, push later
   - Keep in Kiln for now

2. "Install and restart DovePaw servers?" — options:
   - Yes — run `npm run install` + restart servers (Recommended)
   - No, I'll handle it later

**If publishing:**

1. Determine plugin repo path from user's Round 1 answer (or ask again if "None" was chosen)
2. Create `agents/<name>/` in the plugin repo dir
3. Copy `~/.dovepaw/tmp/<name>/main.ts` → `agents/<name>/main.ts`
4. Copy `~/.dovepaw/tmp/<name>/agent.json` → `agents/<name>/agent.json`, add `"pluginPath": "<abs-plugin-repo-path>"`
5. Read `dovepaw-plugin.json` in the plugin repo, add `"<name>"` to the `agents` array, write back
6. `git add agents/<name>/ dovepaw-plugin.json && git commit -m "feat: add <name> agent" && git push` (in plugin repo dir)
7. Remove `~/.dovepaw/tmp/<name>/` so agent exits the Kiln group

**If installing:** run `npm run install` in the DovePaw project root (confirm with user before running).

Always remind: restart `npm run chatbot:servers` to register the new A2A server.
