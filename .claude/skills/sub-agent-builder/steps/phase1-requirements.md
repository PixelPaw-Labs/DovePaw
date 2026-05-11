# Phase 1 — Requirements Gathering

**Round 1** — ask 1 question via `AskUserQuestion`:

1. **Script language** — "Which language should the agent script be written in?" — options:
   - **TypeScript** (Recommended) — full `@dovepaw/agent-sdk` support, Claude/Codex runner, worktrees, parallel execution
   - **Python** — entry point `main.py`, spawned with `python3`
   - **Ruby** — entry point `main.rb`, spawned with `ruby`
   - **Shell** — entry point `main.sh`, spawned with `bash`

**If the user selects a non-TypeScript language**, warn them:

> ⚠️ The built-in `@dovepaw/agent-sdk` (runner, worktrees, status publishing) is TypeScript-only and will **not** be available. You are responsible for wiring up any AI provider integration (API calls, streaming, etc.) yourself.

Then **skip Phases 2–4 entirely** and go directly to Phase 3 (agent.json) after writing only a minimal hello-world entry script:

```
agent-local/<name>/main.<ext>   ← prints "Hello from <name>" and exits 0
```

Set `scriptFile` in `agent.json` to the actual filename (e.g. `"main.py"`). After writing `agent.json`, jump straight to Phase 5.

---

**Round 2** — parse `$ARGUMENTS` first, then ask 4 questions in a single `AskUserQuestion` call _(TypeScript agents only — skip for other languages)_:

1. **Purpose** — "What should this agent do?" — free text via Other
2. **Plugin repo** — "Which plugin repo will this agent eventually live in?" — run `ls ~/.dovepaw/plugins/` and offer each dir basename as an option, plus "None / decide later"
3. **Add to agent-local?** — "Also add this agent to `agent-local/` in the current codebase?" — options:
   - Yes — copy to `agent-local/` after files are generated (for agents that run locally without a plugin repo)
   - No
4. **Agent type** — "Which pattern fits this agent?" — present 4 options with code previews:
   - **Simple** — single agent spawn with a short inline prompt. Use when the task is trivial (< 15 prompt lines) and needs no separate skill file. Set `model: "gpt-5.5"` to use Codex instead of Claude. **If the agent needs repository access or worktree isolation, use Claude (default) — Codex does not support worktrees.**
   - **Static Skill** (Recommended for multi-step agents) — `main.ts` is a thin launcher; all task logic lives in a `SKILL.md` in the `skills/` folder. `main.ts` invokes it via `Skill("/skill-name ${INSTRUCTION}")`. Use this when the prompt is substantial (> 15 lines), multi-phase, or the skill should be independently invocable as `/skill-name`.
   - **Dynamic Skill** — `main.ts` pre-fetches runtime data (PR branches, CI failures, API status), injects it into a temporary skill built in memory, runs Claude, then deletes the skill dir. **Only use when the pre-fetched data must be structurally embedded in the skill body** — not merely for passing the user's instruction through (Static Skill handles that cleanly).
   - **Stateful** — lock + state dir + orchestration (for scheduled agents requiring mutual exclusion)

**Round 3** — read `~/.dovepaw/settings.json`, extract `repositories` array (each has `id`, `path`), then ask 3 questions in a single `AskUserQuestion` call:

1. **Schedule** — "Enable scheduled runs?" — options:
   - On-demand only (Recommended) — triggered manually from chatbot
   - Interval — runs every N seconds
   - Calendar — runs at a fixed time daily/weekly

2. **Repositories** — "Which repositories should this agent access?" — multi-select; show basename of each `path`; include "None" option

3. **Env vars** — "Which environment variables does this agent need?" — infer from purpose (Jira → `JIRA_API_KEY`, GitHub → `GITHUB_TOKEN`, Slack → `SLACK_BOT_TOKEN`, email → `GMAIL_TOKEN`, Linear → `LINEAR_API_KEY`); multi-select; include "None" option
