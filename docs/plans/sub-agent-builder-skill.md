# Plan: Sub-Agent Builder Skill

## Context

DovePaw has 7 background agents that all follow one of 3 patterns (simple Claude-spawning, skill-based setup, complex stateful). Adding a new agent requires touching 5+ files across the codebase: agent script, agent registry, optional skill, and awareness of the full build/install/A2A/chatbot pipeline. This skill codifies the agent creation process into a guided workflow so Claude can scaffold a fully integrated agent from a user's description.

## Files to Create

```
skills/sub-agent-builder/
  SKILL.md                              # Main skill definition
  references/
    template-simple.md                  # Type 1: Simple Claude-spawning template
    template-skill-based.md             # Type 2: Skill-based setup template
    template-complex-stateful.md        # Type 3: Complex stateful template
    agent-registration.md               # defineAgent() template + icon catalog
    integration-checklist.md            # Post-scaffold verification steps
```

## SKILL.md Design

### Frontmatter

```yaml
name: sub-agent-builder
description: "Scaffold a new DovePaw background agent end-to-end. Gathers requirements, selects agent type, generates main.ts, registers in lib/agents.ts, creates associated skill if needed, and provides integration checklist. Use when asked to 'create a new agent', 'scaffold an agent', 'add a new background agent', or 'build a new daemon'."
argument-hint: "Optional: agent name and/or purpose description"
allowed-tools: Read, Write, Edit, Bash(mkdir *), Bash(ls *), Glob, Grep
```

### Phases (6 sequential)

**Phase 1 — Requirements Gathering**

- Parse `$ARGUMENTS` for name/purpose hints
- Prompt user for missing info:
  - Agent name (kebab-case), alias (2-3 chars), display name
  - Purpose / description
  - Schedule: `interval` (seconds), `calendar` (hour/minute/weekday), or `on-demand`
  - Required env vars, whether `reposEnvVar` is needed
  - Lucide icon (suggest from existing set in `lib/agents.ts`)
- Gate: user confirms requirements before proceeding

**Phase 2 — Type Selection**

- Based on requirements, recommend one of 3 types:
  - **Simple** (default): Single Claude CLI spawn with prompt — use when agent just needs to run a prompt with tools
  - **Skill-based**: Dynamic skill generation with references — use when agent needs to assemble context from files/APIs before running
  - **Complex stateful**: Lock + persistent state + orchestration — use when agent needs mutual exclusion, DAG state, or parallel sub-processes
- Gate: user confirms type choice

**Phase 3 — Generate Agent Script**

- Create `agents/<name>/main.ts` from the selected template reference doc
- Templates use existing `agents/lib/` utilities:
  - `createLogger`, `makeTimestamp`, `cleanupOldLogs` from `agents/lib/logger.js`
  - `spawnClaudeWithSignals`, `AUTONOMY_PREFIX` from `agents/lib/claude.js`
  - `emitProgress` from `agents/lib/progress.js`
  - `agentPersistentLogDir` from `lib/paths.js` (via `../../lib/paths.js`)
  - `acquireLock`, `releaseLock`, `retainLock` from `agents/lib/lock.js` (Type 3 only)
  - `parseRepos`, `resetReposToMain` from `agents/lib/repos.js` (if repo-based)
- All agents follow the pattern: config → logger → main() → error handler

**Phase 4 — Register Agent**

- Add `defineAgent({...})` entry to `lib/agents.ts`
- Includes: name, alias, displayName, description, requiredEnvVars, icon, scheduleDisplay, schedule, doveCard, 6 suggestions
- Read existing entries in `lib/agents.ts` to match style
- Add any new Lucide icon imports if needed

**Phase 5 — Create Associated Skill (if needed)**

- For Type 2 (skill-based) or any agent that delegates to a skill:
  - Create `skills/<name>/SKILL.md` with appropriate frontmatter and phase instructions
  - Create `skills/<name>/references/` with supporting docs if needed
- For Type 1 (simple): skill creation is optional (only if the prompt is complex enough to warrant a skill file)
- For Type 3 (complex): no separate skill needed (orchestration is in-code)

**Phase 6 — Integration Checklist**

- Verify `agents/<name>/main.ts` compiles: `npx tsx agents/<name>/main.ts --help` (dry-run)
- Verify `lib/agents.ts` has no TypeScript errors
- Run `npm run lint` and `npm run fmt`
- Run `npm run chatbot:test` to ensure no regressions
- Remind user: `npm run build && npm run install` to deploy (but don't run without user permission)
- Remind user: restart `npm run chatbot:servers` to pick up new A2A server
- Note: A2A server, MCP tools (`ask_*`/`start_*`/`await_*`), and chatbot integration are **automatic** — they derive from the `AGENTS` array in `lib/agents.ts`

## Reference Documents

### `references/template-simple.md`

Complete Type 1 template based on `agents/dependabot-merger/main.ts` and `agents/oncall-analyzer/main.ts`:

- Imports from `agents/lib/` (logger, claude, progress) and `lib/paths`
- Configuration block: env vars, WORK_DIR, LOG_DIR, LOG_FILE, logger
- Prompt construction (inline or skill invocation)
- `spawnClaudeWithSignals()` call with configurable timeout, permission mode, optional `--add-dir` for repos
- Output logging, `cleanupOldLogs()`, FATAL error handler
- Placeholders marked with `{{AGENT_NAME}}`, `{{TIMEOUT_MS}}`, `{{PERMISSION_MODE}}`, etc.

**Template structure:**

```typescript
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger, makeTimestamp, cleanupOldLogs } from "../lib/logger.js";
import { spawnClaudeWithSignals, AUTONOMY_PREFIX } from "../lib/claude.js";
import { emitProgress } from "../lib/progress.js";
import { agentPersistentLogDir } from "../../lib/paths.js";

// ─── Configuration ──────────────────────────────────────────────────────────
const INSTRUCTION = process.argv[2] || "{{DEFAULT_INSTRUCTION}}";
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WORK_DIR = process.env.AGENT_WORKSPACE ?? SCRIPT_DIR;
const LOG_DIR = agentPersistentLogDir("{{AGENT_NAME}}");
const LOG_FILE = join(LOG_DIR, `{{AGENT_NAME}}-${makeTimestamp()}.log`);
const { log } = createLogger(LOG_DIR, LOG_FILE);

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  log("=== {{DISPLAY_NAME}} started ===");
  emitProgress("Starting {{DISPLAY_NAME}}…");

  const prompt = `${AUTONOMY_PREFIX}\n\n{{PROMPT_BODY}}\n\nInstruction: ${INSTRUCTION}`;

  const { code: exitCode, stdout: claudeOutput } = await spawnClaudeWithSignals(
    ["--permission-mode", "{{PERMISSION_MODE}}", "-p", prompt],
    { cwd: WORK_DIR, taskName: "{{AGENT_NAME}}", timeoutMs: {{TIMEOUT_MS}} },
  );

  log(`Claude CLI exited with code: ${exitCode}`);
  log("--- Response ---");
  log(claudeOutput);
  log("=== {{DISPLAY_NAME}} finished ===");

  cleanupOldLogs(LOG_DIR, ["{{AGENT_NAME}}-"], 30);
}

main().catch((err: unknown) => {
  log(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
```

### `references/template-skill-based.md`

Complete Type 2 template based on `agents/memory-dream/main.ts` and `agents/memory-distiller/main.ts`:

- Same base imports + `writeFileSync`, `mkdirSync`, `rmSync`, `randomBytes` from `node:crypto`
- Source discovery phase (customizable per agent)
- Temp skill directory creation at `~/.claude/skills/<skill-name>-<hex>/`
- Dynamic SKILL.md generation with references subdirectory
- `spawnClaudeWithSignals()` with `/<skill-name>` invocation
- `rmSync(skillDir, { recursive: true, force: true })` cleanup in finally block
- Placeholders for discovery logic and skill content

**Template structure:**

```typescript
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createLogger, makeTimestamp, cleanupOldLogs } from "../lib/logger.js";
import { spawnClaudeWithSignals } from "../lib/claude.js";
import { emitProgress } from "../lib/progress.js";
import { agentPersistentLogDir } from "../../lib/paths.js";

// ─── Configuration ──────────────────────────────────────────────────────────
const HOME = process.env.HOME!;
const INSTRUCTION = process.argv[2] || "{{DEFAULT_INSTRUCTION}}";
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WORK_DIR = process.env.AGENT_WORKSPACE ?? SCRIPT_DIR;
const LOG_DIR = agentPersistentLogDir("{{AGENT_NAME}}");
const LOG_FILE = join(LOG_DIR, `{{AGENT_NAME}}-${makeTimestamp()}.log`);
const { log } = createLogger(LOG_DIR, LOG_FILE);

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  log("=== {{DISPLAY_NAME}} started ===");

  // --- Discovery phase (customize per agent) ---
  emitProgress("Discovering sources…");
  // {{DISCOVERY_LOGIC}}

  // --- Build dynamic skill ---
  const skillName = `{{AGENT_NAME}}-${randomBytes(3).toString("hex")}`;
  const skillDir = join(HOME, ".claude/skills", skillName);
  const skillRefDir = join(skillDir, "references");
  mkdirSync(skillRefDir, { recursive: true });

  // Write reference files
  // {{WRITE_REFERENCES}}

  // Generate SKILL.md
  const skillMd = `---
name: ${skillName}
description: "{{SKILL_DESCRIPTION}}"
allowed-tools: Read, Edit, Write, Bash(mkdir *), Bash(rm *)
context: fork
---

{{SKILL_BODY}}
`;
  writeFileSync(join(skillDir, "SKILL.md"), skillMd);

  try {
    emitProgress("Running skill…");
    const { code: exitCode, stdout: claudeOutput } = await spawnClaudeWithSignals(
      ["--permission-mode", "acceptEdits", "-p", `/${skillName}`],
      { cwd: WORK_DIR, taskName: "{{AGENT_NAME}}", timeoutMs: {{TIMEOUT_MS}} },
    );

    log(`Claude CLI exited with code: ${exitCode}`);
    log(claudeOutput);
  } finally {
    rmSync(skillDir, { recursive: true, force: true });
    log("Cleaned up skill directory");
  }

  log("=== {{DISPLAY_NAME}} finished ===");
  cleanupOldLogs(LOG_DIR, ["{{AGENT_NAME}}-"], 30);
}

main().catch((err: unknown) => {
  log(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
```

### `references/template-complex-stateful.md`

Complete Type 3 template based on `agents/get-shit-done/main.ts`:

- Lock acquisition with `acquireLock()` / `releaseLock()` / `retainLock()`
- State directory setup via `agentPersistentStateDir()`
- `process.on("exit")` handler for cleanup + lock management
- Module structure guidance (separate orchestrator, pipeline, discovery classes)
- Pattern: silent exit if no work found, log dir created only when work exists

**Template structure:**

```typescript
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger, makeTimestamp, cleanupOldLogs } from "../lib/logger.js";
import { spawnClaudeWithSignals } from "../lib/claude.js";
import { acquireLock, releaseLock, retainLock } from "../lib/lock.js";
import { emitProgress } from "../lib/progress.js";
import { agentPersistentLogDir, agentPersistentStateDir } from "../../lib/paths.js";

// ─── Configuration ──────────────────────────────────────────────────────────
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WORK_DIR = process.env.AGENT_WORKSPACE ?? SCRIPT_DIR;
const STATE_DIR = agentPersistentStateDir("{{AGENT_NAME}}");
const LOG_BASE = agentPersistentLogDir("{{AGENT_NAME}}");

let cleanExit = false;

process.on("exit", () => {
  // {{CLEANUP_LOGIC}}
  if (cleanExit) releaseLock();
  else retainLock();
});

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  if (!acquireLock(join(STATE_DIR, "lock"))) {
    console.log("Another instance is running — exiting.");
    return;
  }

  // --- Pre-check: is there work to do? ---
  emitProgress("Checking for work…");
  // {{PRE_CHECK_LOGIC}}
  // If nothing to do: { cleanExit = true; return; }

  // --- Create log dir only when work found ---
  const LOG_DIR = join(LOG_BASE, makeTimestamp());
  const LOG_FILE = join(LOG_DIR, "{{AGENT_NAME}}.log");
  const { log } = createLogger(LOG_DIR, LOG_FILE);

  log("=== {{DISPLAY_NAME}} started ===");

  // --- Main work ---
  // {{MAIN_WORK_LOGIC}}

  log("=== {{DISPLAY_NAME}} finished ===");
  cleanupOldLogs(LOG_BASE, [], 30);
}

main()
  .then(() => {
    cleanExit = true;
  })
  .catch((err: unknown) => {
    console.error(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
  });
```

### `references/agent-registration.md`

Full `defineAgent()` template with all fields documented:

**Available Lucide icons** (already imported in `lib/agents.ts`):
Brain, Zap, Radar, FlaskConical, BellRing, LifeBuoy, GitMerge, Play, FileText, BookOpen, ListTodo, GitPullRequest, AlertTriangle, RefreshCw, TrendingUp, Clock, Search, CheckCircle, Eye, Info, Hammer

**Tailwind icon color palettes** used across agents:

- `bg-accent` / `text-accent-foreground` — neutral/default
- `bg-green-100` / `text-green-700` — run/success actions
- `bg-blue-100` / `text-blue-700` — info/details
- `bg-purple-100` / `text-purple-700` — analysis/exploration
- `bg-yellow-100` / `text-yellow-700` — warnings/caution
- `bg-red-100` / `text-red-600` — alerts/incidents
- `bg-orange-100` / `text-orange-600` — trending/metrics
- `bg-slate-100` / `text-slate-600` — logs/files

**Registration template:**

```typescript
defineAgent({
  name: "{{NAME}}",
  alias: "{{ALIAS}}",
  displayName: "{{DISPLAY_NAME}}",
  description:
    "{{DESCRIPTION}} " +
    "Use when asked anything about this agent not limited to — what it does, its status, recent runs, or logs — " +
    "or when asked to '{{TRIGGER_PHRASE_1}}', '{{TRIGGER_PHRASE_2}}', or '{{TRIGGER_PHRASE_3}}'.",
  requiredEnvVars: [{{REQUIRED_ENV_VARS}}],
  reposEnvVar: "{{REPOS_ENV_VAR}}", // omit if not repo-based
  icon: {{ICON}},
  scheduleDisplay: "{{SCHEDULE_DISPLAY}}",
  schedule: {{SCHEDULE}}, // omit for on-demand
  doveCard: {
    icon: {{ICON}},
    iconBg: "{{DOVE_CARD_ICON_BG}}",
    iconColor: "{{DOVE_CARD_ICON_COLOR}}",
    title: "{{DISPLAY_NAME}}",
    description: "{{DOVE_CARD_DESCRIPTION}}",
    prompt: "{{DOVE_CARD_PROMPT}}",
  },
  suggestions: [
    // 1. Run now
    {
      icon: Play,
      iconBg: "bg-green-100 group-hover:bg-primary",
      iconColor: "text-green-700 group-hover:text-primary-foreground",
      title: "Run now",
      description: "Run {{DISPLAY_NAME}} now",
      prompt: "Run {{DISPLAY_NAME}} now",
    },
    // 2. What does it do?
    {
      icon: Info,
      iconBg: "bg-accent group-hover:bg-primary",
      iconColor: "text-accent-foreground group-hover:text-primary-foreground",
      title: "What does it do?",
      description: "What does {{DISPLAY_NAME}} do?",
      prompt: "What does {{DISPLAY_NAME}} do?",
    },
    // 3. Last run logs
    {
      icon: FileText,
      iconBg: "bg-slate-100 group-hover:bg-primary",
      iconColor: "text-slate-600 group-hover:text-primary-foreground",
      title: "Last run logs",
      description: "Show {{DISPLAY_NAME}} logs",
      prompt: "Show {{DISPLAY_NAME}} logs",
    },
    // 4-6: Agent-specific suggestions
    // {{CUSTOM_SUGGESTIONS}}
  ],
}),
```

### `references/integration-checklist.md`

**Automatic integrations** (zero code — derived from `AGENTS` array in `lib/agents.ts`):

- A2A server: `createServerFromDef()` in `chatbot/a2a/lib/base-server.ts` creates an Express server per agent
- MCP tools: `chatbot/lib/query-tools.ts` auto-generates `ask_{{manifestKey}}`, `start_{{manifestKey}}`, `await_{{manifestKey}}`
- Chatbot UI: agent cards, suggestions, and chat routing all derive from the AGENTS registry
- Port manifest: `chatbot/a2a/start-all.ts` allocates OS-assigned ports and writes `.ports.json`

**Manual steps after scaffolding:**

1. Build: `npm run build` — compiles agent to `dist/{{name}}.mjs` via tsup
2. Install: `npm run install` — deploys script + creates launchd plist (ask user first!)
3. Restart servers: `npm run chatbot:servers` — starts new A2A server for the agent
4. Configure env vars: add required env vars to settings

**Testing:**

1. `npm run lint` — oxlint check
2. `npm run fmt` — oxfmt formatting
3. `npm run chatbot:test` — vitest regression check

**Key paths touched:**

| Path                                  | Purpose                      |
| ------------------------------------- | ---------------------------- |
| `agents/<name>/main.ts`               | Agent entry point            |
| `lib/agents.ts`                       | Agent registry (defineAgent) |
| `skills/<name>/SKILL.md`              | Associated skill (if Type 2) |
| `~/.cache/claude/agent_logs/<name>/`  | Persistent log directory     |
| `~/.cache/claude/agent_state/<name>/` | Persistent state (if Type 3) |

## Critical Files Modified at Runtime

| File                                       | Action                                 |
| ------------------------------------------ | -------------------------------------- |
| `skills/sub-agent-builder/SKILL.md`        | **Create** — main skill                |
| `skills/sub-agent-builder/references/*.md` | **Create** — 5 reference docs          |
| `agents/<new-name>/main.ts`                | Created by skill at runtime            |
| `lib/agents.ts`                            | Modified by skill at runtime           |
| `skills/<new-name>/SKILL.md`               | Optionally created by skill at runtime |

## Verification

1. After creating the skill files, run `npm run fmt:check` to verify formatting
2. Run `npm run lint` to check for issues
3. Manually test by invoking `/sub-agent-builder` with a sample agent description
4. Verify the skill creates valid TypeScript by checking `npx tsc --noEmit` on generated files
