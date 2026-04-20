# Type 3 — Complex Stateful Agent Template

Use when the agent:

- Runs on a schedule and must prevent concurrent executions (lock)
- Maintains state across runs (e.g. tracking what was processed last time)
- Orchestrates multiple sub-agents or parallel worktrees

## Placeholders

| Placeholder           | Description                                                           |
| --------------------- | --------------------------------------------------------------------- |
| `{{AGENT_NAME}}`      | kebab-case agent name                                                 |
| `{{DISPLAY_NAME}}`    | human-readable name                                                   |
| `{{TIMEOUT_MS}}`      | timeout in milliseconds                                               |
| `{{PRE_CHECK_LOGIC}}` | code to detect if there is work to do (fast, before creating log dir) |
| `{{MAIN_WORK_LOGIC}}` | core orchestration logic                                              |

## Template

```typescript
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import {
  createLogger,
  makeTimestamp,
  cleanupOldLogs,
  spawnClaudeWithSignals,
  acquireLock,
  releaseLock,
  retainLock,
  PERSONA_RULES,
  agentPersistentLogDir,
  agentPersistentStateDir,
} from "@dovepaw/agent-sdk";

// ─── Configuration ───────────────────────────────────────────────────────────
const INSTRUCTION = process.argv[2] || "";
const WORK_DIR = process.env.AGENT_WORKSPACE!; // always set by executor — never add a fallback
const STATE_DIR = agentPersistentStateDir("{{AGENT_NAME}}");
// → ~/.dovepaw/agents/state/.{{AGENT_NAME}}/
const LOG_BASE = agentPersistentLogDir("{{AGENT_NAME}}");
// → ~/.dovepaw/agents/logs/.{{AGENT_NAME}}/

mkdirSync(STATE_DIR, { recursive: true });

const isScheduled = process.env.DOVEPAW_SCHEDULED === "1";
let cleanExit = false;
let log: (msg: string) => void = console.log;

// Lock management: on clean exit → release; on error → retain for manual inspection
process.on("exit", () => {
  if (isScheduled) {
    if (cleanExit) releaseLock();
    else retainLock();
  }
});

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  // Acquire exclusive lock — silent exit if another instance is running or lock retained
  if (isScheduled && !acquireLock(join(STATE_DIR, "lock"))) {
    console.log("Another instance is running or lock retained — exiting.");
    return;
  }

  // --- Pre-check: is there work to do? (runs before creating the log dir) ---
  // {{PRE_CHECK_LOGIC}}
  // If nothing to do, set cleanExit and return silently:
  // const work = await checkForWork();
  // if (!work) { cleanExit = true; return; }

  // Create timestamped log dir only once we know there is work
  const LOG_DIR = join(LOG_BASE, makeTimestamp());
  const logger = createLogger(LOG_DIR, join(LOG_DIR, "{{AGENT_NAME}}.log"));
  log = logger.log;

  log("=== {{DISPLAY_NAME}} started ===");
  logger.publishStatusToUI("Starting {{DISPLAY_NAME}}…");

  // --- Main work ---
  // {{MAIN_WORK_LOGIC}}
  // Read references/spawning-patterns.md for Options A / B / C.
  // Include INSTRUCTION in the prompt so the user's message reaches Claude:
  //   const prompt = [AUTONOMY_PREFIX, "", "{{PROMPT_BODY}}", "", PERSONA_RULES, "", `Instruction: ${INSTRUCTION}`].join("\n");
  // Stateful agents commonly combine:
  //   Pattern B (worktrees) for parallel repo writes — lock prevents races
  //   Pattern C (session chain) for scan → act workflows within a single run

  log("=== {{DISPLAY_NAME}} finished ===");
  cleanupOldLogs(LOG_BASE, [], 30);
}

main()
  .then(() => {
    cleanExit = true;
  })
  .catch((err: unknown) => {
    log(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
  });
```

## Notes on lock semantics

- `acquireLock` returns `false` if a lock file already exists and the owning process is still running
- `releaseLock` removes the lock file — call on successful exit
- `retainLock` keeps the lock file — call on error; prevents automated retry until manually cleared
- Only use locking for scheduled agents (`isScheduled`). On-demand agents don't need locks.
