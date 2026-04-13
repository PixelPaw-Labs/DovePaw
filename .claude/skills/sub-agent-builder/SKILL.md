---
name: sub-agent-builder
description: "Scaffold a new DovePaw background agent end-to-end. Creates agent files in ~/.dovepaw/tmp/ so the agent appears immediately in the Kiln sidebar group, ready to test. Optionally publishes to a plugin repo. Use when asked to 'create a new agent', 'scaffold an agent', 'add a new background agent', 'build a new daemon', or when the user wants to automate a recurring or on-demand task with a DovePaw agent."
argument-hint: "Optional: agent name and/or purpose description"
allowed-tools: Read, Write, Edit, Bash(mkdir *), Bash(ls *), Bash(cat *), Glob, Grep, AskUserQuestion
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
3. **Agent type** — "Which pattern fits this agent?" — present 3 options with code previews:
   - **Simple** — single Claude spawn with a prompt (most agents)
   - **Skill-based** — dynamically builds a temporary skill, runs it, cleans up (for complex context assembly)
   - **Stateful** — lock + state dir + orchestration (for scheduled agents requiring mutual exclusion)

**Round 2** — read `~/.dovepaw/settings.json`, extract `repositories` array (each has `id`, `path`), then ask 4 questions in a single `AskUserQuestion` call:

1. **Schedule** — "Enable scheduled runs?" — options:
   - On-demand only (Recommended) — triggered manually from chatbot
   - Interval — runs every N seconds
   - Calendar — runs at a fixed time daily/weekly

2. **Repositories** — "Which repositories should this agent access?" — multi-select; show basename of each `path`; include "None" option

3. **Env vars** — "Which environment variables does this agent need?" — infer from purpose (Jira → `JIRA_API_KEY`, GitHub → `GITHUB_TOKEN`, Slack → `SLACK_BOT_TOKEN`, email → `GMAIL_TOKEN`, Linear → `LINEAR_API_KEY`); multi-select; include "None" option

4. **Icon** — "Which icon suits this agent best?" — pick 4 from the catalog in `references/agent-registration.md` based on purpose (analytics/reasoning → `Brain`, automation → `Zap`, alerts/incidents → `BellRing`, docs → `FileText`, code → `GitMerge`)

---

### Phase 2 — Generate main.ts

Read the appropriate template from `references/`:

| Type        | Template file                             |
| ----------- | ----------------------------------------- |
| Simple      | `references/template-simple.md`           |
| Skill-based | `references/template-skill-based.md`      |
| Stateful    | `references/template-complex-stateful.md` |

Create `~/.dovepaw/tmp/<name>/main.ts` by substituting all `{{PLACEHOLDER}}` values.

**Spawning rules (use judgment):**

- Always run Claude in `AGENT_WORKSPACE` — never change cwd to `REPOS[0]`. `REPOS` is a list; the agent may need all of them.
- If repos selected and agent is read-only: pass all repos as `--add-dir` flags: `REPOS.flatMap(r => ["--add-dir", r])`
- If repos selected and agent writes to one specific repo: use that repo as cwd with `-w <branch>` (worktree); add remaining repos with `--add-dir`
- If agent has sequential steps that share context: chain with `--session-id` / `--resume`
- Single-step agents: plain `-p` prompt, no worktree, no session chaining

---

### Phase 3 — Create agent.json

Create `~/.dovepaw/tmp/<name>/agent.json` using the template in `references/agent-registration.md`.

Fill in all fields:

- `name` — kebab-case
- `alias` — 2–3 char shorthand (make it unique)
- `displayName` — human-readable title
- `description` — MCP tool description Dove uses to route requests
- `schedulingEnabled` — `true` only if interval/calendar
- `schedule` — include only when schedulingEnabled; use `"interval"` or `"calendar"` type
- `repos` — UUIDs from settings.json matching selected repo paths
- `envVars` — `[{ "key": "VAR", "value": "", "isSecret": true }]` for each required var
- `iconName` / `iconBg` / `iconColor` — from icon choice (see color palettes in `references/agent-registration.md`)
- `doveCard` — write a concise title + description + starter prompt
- `suggestions` — 3 realistic starter prompts based on agent purpose

Do NOT set `pluginPath` — that is added at publish time.

---

### Phase 4 — Associated Skill (Type 2 only)

For **Skill-based** agents: the dynamic skill is generated at runtime inside main.ts — no static skill file needed. Skip this phase.

For **Simple** agents where the embedded prompt body is complex: optionally create `.claude/skills/<name>/SKILL.md` with detailed instructions separated from the TypeScript file.

---

### Phase 5 — Integration Check

```bash
npm run lint
npm run fmt
```

Read `~/.dovepaw/tmp/<name>/main.ts` back to confirm no obvious syntax errors.

Tell the user: the agent is now visible in the **Kiln** sidebar group (Sparkles icon). No server restart needed for tmp agents — they appear immediately.

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

---

## Reference Files

| File                                      | When to read                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| `references/template-simple.md`           | Phase 2 — Type 1 template                                              |
| `references/template-skill-based.md`      | Phase 2 — Type 2 template                                              |
| `references/template-complex-stateful.md` | Phase 2 — Type 3 template                                              |
| `references/agent-registration.md`        | Phase 3 — agent.json template + icon/color catalog                     |
| `references/spawning-patterns.md`         | Phase 2 — Options A/B/C for how Claude spawns subprocesses (all types) |
| `references/integration-checklist.md`     | Phase 5 — lint/fmt commands + path reference                           |
