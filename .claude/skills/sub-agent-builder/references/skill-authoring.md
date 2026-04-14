# Skill Authoring Reference

Complete reference for writing `SKILL.md` files for DovePaw agents and standalone skills.

---

## SKILL.md Frontmatter

```yaml
---
name: skill-name # Required. Must match the directory name (kebab-case).
description:
  "..." # Required. One or two sentences: what it does + when to invoke it.
  #   Used by Claude to auto-trigger the skill. Be specific about trigger
  #   conditions. Also shown to users in skill listings.
model:
  sonnet # Optional. Override the default model: sonnet | opus | haiku.
  #   Use sonnet for most agent-facing skills.
  #   Use opus for deep research / multi-step reasoning tasks.
allowed-tools: Read, Bash, Grep ... # Required. Comma-separated list of tools the skill may use.
argument-hint: "[time scope, ...]" # Optional. Shown in the /skill-name autocomplete hint.
hooks: # Optional. See Hooks section below.
  PreToolUse:
    - matcher: "Write|Edit"
      hooks:
        - type: command
          command: 'printf "..."'
---
```

### Common `allowed-tools` sets

| Agent type                      | Typical tools                         |
| ------------------------------- | ------------------------------------- |
| Read-only investigator          | `Read, Bash, Grep, Glob`              |
| Code fixer / writer             | `Read, Bash, Grep, Glob, Write, Edit` |
| Orchestrator (calls sub-skills) | `Read, Bash, Grep, Glob, Agent`       |
| Script-runner                   | `Read, Bash`                          |

---

## Argument Patterns

`$ARGUMENTS` is the text following the skill name in the invocation. Parse it at the top of the SKILL.md body.

### Pattern 1 — Positional / freeform

Best for single natural-language arguments (time scope, search query, instruction).

```
Skill("/zendesk-triager last 7 days")
```

Skill reads: `$ARGUMENTS` → `"last 7 days"`

### Pattern 2 — Key-value pairs

Best for multiple typed parameters to a single-item invocation.

```
Skill("/security-patcher package="lodash" ecosystem="npm" fix="4.17.21" manifest="package.json"")
```

Skill parsing:

```
Parse $ARGUMENTS as `key="value"` pairs:
- `package` — the vulnerable package name
- `ecosystem` — npm / rubygems / pip
- `fix` — version that resolves the vulnerability
- `manifest` — path to the dependency manifest
```

### Pattern 3 — JSON object

Best for batch invocations (multiple items sharing a context).

```typescript
const skillArgs = JSON.stringify({ manifest, ecosystem, ticket, packages });
// Prompt includes: Skill("/security-patcher ${skillArgs}")
```

Skill parsing:

```
$ARGUMENTS is a JSON object:
- `manifest` — shared manifest path
- `ecosystem` — shared ecosystem
- `packages` — array of `{ name, fix, vulnerable, severity }` objects
```

Always document whether `$ARGUMENTS` starts with `{` (JSON) or `key=` (key-value) at the top of the SKILL.md — the skill needs to branch on this.

---

## Output Contracts

### No structured output (side-effect skills)

Skills that write files, open PRs, or commit code. The agent doesn't parse their output — it just checks the exit code. Plain text completion is fine.

Examples: `/git-commit`, `/create-pr`, `/yang-persona-distiller`

### Structured JSON (loop-callable skills)

Skills called by agents in a retry loop. Emit a JSON object as the **last line** of the response (no markdown fences, no trailing text after it).

```
{"status": "patched"|"partial"|"failed", "summary": "one sentence", "approach": "direct-pin|..."}
```

The agent parses this with a regex like `/\{.*"status".*\}/` on the last non-empty line.

- `patched` / `success` — completed, no issues
- `partial` — completed with caveats (tests failing, manual review needed)
- `failed` — nothing changed (safe to retry or skip)

---

## How Agents Invoke Skills

In `main.ts` (or `prompts.ts`), the agent builds a prompt string that contains the skill call, then passes it to `spawnClaude`:

```typescript
// Simple — pass instruction through
const prompt = `Skill("/my-skill ${INSTRUCTION}")`;

// Multi-line prompt with skill call on its own line
const lines: string[] = [];
lines.push("You are fixing security vulnerabilities in this repository.");
lines.push("");
lines.push(`Skill("/security-patcher ${skillArgs}")`);
lines.push("");
lines.push('After the skill completes, run Skill("/git-commit") to commit all changes.');

const result = await spawnClaude(["--permission-mode", "acceptEdits", "-p", lines.join("\n")], {
  cwd: repoPath,
  taskName: "security-patcher: fix",
});
```

The skill name in the invocation must exactly match the `name:` field in its frontmatter.

---

## Environment Variables Available to Skills

Skills run inside a Claude subprocess. The agent can inject env vars via `spawnClaude`'s `env` option.

Built-in variables available in all skill runs:

| Variable                  | Value                                                                      |
| ------------------------- | -------------------------------------------------------------------------- |
| `CLAUDE_SKILL_DIR`        | Absolute path to the skill's directory (e.g. `~/.claude/skills/my-skill/`) |
| `HOME`                    | User home directory                                                        |
| Standard PATH, LANG, etc. | Inherited from agent environment                                           |

Custom variables are injected by the agent from `agent.json`'s `envVars` array. Document these at the top of the SKILL.md under an "Inputs (from environment)" section.

---

## Subdirectory Conventions

| Directory     | Purpose                                            | Example                                              |
| ------------- | -------------------------------------------------- | ---------------------------------------------------- |
| `scripts/`    | Node.js or shell scripts run via `Bash`            | `scripts/extract-user-messages.js`                   |
| `references/` | Reference docs, schemas, templates the skill reads | `references/pir-form-fields.md`                      |
| `steps/`      | Numbered sub-phases for multi-phase skills         | `steps/step1-gather.md`, `steps/step2a-pagerduty.md` |

### `scripts/` directory

Each `scripts/` dir needs its own `package.json` with `"type": "module"` so scripts use ESM imports:

```json
{
  "type": "module"
}
```

The skill invokes scripts via Bash using `$CLAUDE_SKILL_DIR`:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/extract-user-messages.js"
```

### `steps/` directory (multi-phase skills)

For skills with 4+ sequential phases, split each phase into a separate file to keep the main SKILL.md navigable. The main SKILL.md orchestrates the phases:

```markdown
## Phase 1 — Gather data

Read `${CLAUDE_SKILL_DIR}/steps/step1-gather.md` and follow all instructions.

## Phase 2a — PagerDuty

Read `${CLAUDE_SKILL_DIR}/steps/step2a-pagerduty.md` and follow all instructions.
```

---

## Hooks

PreToolUse hooks let you intercept specific tool calls inside the skill to block, approve, or add context.

### Guardrail hook — block writes, require script path

Used when the skill must write files only via a specific script (not directly via Write/Edit):

```yaml
hooks:
  PreToolUse:
    - matcher: "Write|Edit"
      hooks:
        - type: command
          command: 'printf "{\"decision\": \"block\", \"reason\": \"Write updated files via Python script (Bash tool).\"}"'
```

The `decision` and `reason` fields are returned to the model so it understands why the tool was blocked.

---

## Calling Other Skills

A skill can invoke sub-skills using the same `Skill(...)` syntax:

```markdown
## Step 4 — Commit and PR

Run:
Skill("/git-commit")
Skill("/create-pr 'create a Draft PR for these security patches'")
```

This works because skills run inside a full Claude session that has access to all installed skills.

---

## Plugin Manifest Registration

When publishing a skill to a plugin repo, add it to `dovepaw-plugin.json`:

```json
{
  "agents": ["my-agent"],
  "skills": ["my-agent", "my-standalone-utility"]
}
```

Skills and agents are registered independently. A skill with the same name as an agent is an agent-associated skill — it can be invoked directly by users OR called by the agent's main.ts. A skill without a same-named agent is a standalone utility.
