# Phase 4 — Associated Skill

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

## Skill file location

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

## Agent → skill invocation

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

## Output contract

Skills that are called by agents in a loop (fix → test → retry) must emit a structured result as the **last line** of their response so the agent can parse it:

```
{"status": "patched"|"partial"|"failed", "summary": "...", "approach": "..."}
```

Skills called for their side effects only (write file, open PR) need no structured output — plain text completion is fine.

## Plugin manifest

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

**If the user chose Yes to agent-local in Phase 1**, copy files now (all source files are finalised at this point):

1. Create `{CLAUDE_PROJECT_DIR}/agent-local/<name>/` and write:
   - `main.ts` — copy from `~/.dovepaw/tmp/<name>/main.ts`
   - `agent.json` — copy from `~/.dovepaw/tmp/<name>/agent.json`, strip `pluginPath`, clear all `envVars[*].value` to `""` (no secrets in source)
2. Confirm: "Agent `<name>` added to `agent-local/`."
