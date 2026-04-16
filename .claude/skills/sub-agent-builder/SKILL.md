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
   - **Simple** — single Claude spawn with a prompt (most agents)
   - **Skill-based** — dynamically builds a temporary skill, runs it, cleans up (for complex context assembly)
   - **Stateful** — lock + state dir + orchestration (for scheduled agents requiring mutual exclusion)
   - **Codex** — uses OpenAI Codex SDK instead of Claude CLI (smarter and cheaper alternative for tasks)

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

| Type        | Read now                                  |
| ----------- | ----------------------------------------- |
| Simple      | `references/template-simple.md`           |
| Skill-based | `references/template-skill-based.md`      |
| Stateful    | `references/template-complex-stateful.md` |
| Codex       | `references/template-codex.md`            |

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

**Always prefer `@dovepaw/agent-sdk` over custom implementations:**

Before writing any utility code, read `~/.dovepaw/sdk/src/index.ts` to get the current list of SDK exports. Never re-implement what the SDK already provides — if a function, constant, or type exists there, import and use it.

**Workspace is always fresh:**

`AGENT_WORKSPACE` is a clean, empty directory created for each run — it contains no files from previous runs and no history. Never assume any file pre-exists in the workspace. If the agent needs state that survives between runs, use `agentPersistentStateDir()` from the SDK — never write persistent data to `AGENT_WORKSPACE`.

**Spawning rules (use judgment):**

- Always run Claude in `AGENT_WORKSPACE` — never change cwd to `REPOS[0]`. `REPOS` is a list; the agent may need all of them.
- Default env var for repo list is `REPO_LIST` — use this name in `agent.json` envVars and in the `parseRepos("REPO_LIST")` call unless the user specifies a different name.
- If repos selected and agent is read-only: pass all repos as `--add-dir` flags: `REPOS.flatMap(r => ["--add-dir", r])`
- If repos selected and agent writes to one specific repo: use that repo as cwd with `-w <branch>` (worktree); add remaining repos with `--add-dir`
- If the agent processes each repo independently (one Claude run per repo): **always spawn in parallel with `Promise.all`** — never loop sequentially. See Pattern A (multi-repo) in `references/spawning-patterns.md`.
- If agent has sequential steps that share context: chain with `--session-id` / `--resume`
- Single-step agents: plain `-p` prompt, no worktree, no session chaining

**Phase 2 gate — verify before proceeding:**

- [ ] All `{{PLACEHOLDER}}` values substituted in every written file
- [ ] `INSTRUCTION` read from `process.argv[2]` and passed through to Claude
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

**Skip Phase 4 entirely** if the agent type is **Skill-based** — it already generates a skill dynamically at runtime and must not have a static SKILL.md alongside it. Proceed directly to Phase 5.

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
```

Create the `skill/` dir and symlink with Python (bypasses shell permission checks):

```bash
python3 -c "
import os
skill_dir = os.path.expanduser('~/.dovepaw/tmp/<name>/skill')
os.makedirs(skill_dir, exist_ok=True)
os.symlink(skill_dir, os.path.expanduser('~/.claude/skills/<name>'))
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

In `main.ts` (or `prompts.ts`), the agent embeds the skill call in the prompt string it passes to `spawnClaude`:

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
- [ ] Skill invocation in `main.ts` uses correct format (`Skill("/skill-name args")`)

Fix any failures before continuing.

---

### Phase 5 — Integration Check

Read `references/integration-checklist.md` now for lint/fmt commands and path reference.

Read each created file back and verify against this checklist. Fix any issue found, then re-check until every item passes:

- **main.ts** — all `{{PLACEHOLDER}}` values substituted; spawning pattern matches the chosen Option A/B/C; `INSTRUCTION` is passed through to Claude; no dead branches; `emitProgress` called at meaningful steps; subprocess env is correct (no `CLAUDECODE`, clean PATH)
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
