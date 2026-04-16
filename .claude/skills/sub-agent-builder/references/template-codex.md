# Type 4 — Codex Agent Template

Substitute all `{{PLACEHOLDER}}` values before writing to `~/.dovepaw/tmp/<name>/main.ts`.

## Placeholders

| Placeholder        | Description                                                |
| ------------------ | ---------------------------------------------------------- |
| `{{AGENT_NAME}}`   | kebab-case agent name (e.g. `code-reviewer`)               |
| `{{DISPLAY_NAME}}` | human-readable name (e.g. `Code Reviewer`)                 |
| `{{TIMEOUT_MS}}`   | timeout in milliseconds (e.g. `30 * 60 * 1000` for 30 min) |
| `{{PROMPT_BODY}}`  | the core task prompt given to Codex                        |
| `{{MODEL}}`        | Codex model (default: `gpt-5.4`)                           |

## Template

```typescript
import { join } from "node:path";
import {
  createLogger,
  makeTimestamp,
  cleanupOldLogs,
  CodexRunner,
  emitProgress,
  agentPersistentLogDir,
} from "@dovepaw/agent-sdk";

// ─── Configuration ───────────────────────────────────────────────────────────

const INSTRUCTION = process.argv[2] || "";
const WORK_DIR = process.env.AGENT_WORKSPACE!;
const LOG_DIR = agentPersistentLogDir("{{AGENT_NAME}}");
const LOG_FILE = join(LOG_DIR, `{{AGENT_NAME}}-${makeTimestamp()}.log`);
const { log } = createLogger(LOG_DIR, LOG_FILE);

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  log("=== {{DISPLAY_NAME}} started ===");

  const prompt = `{{PROMPT_BODY}}${INSTRUCTION ? `\n\nInstruction: ${INSTRUCTION}` : ""}`;

  emitProgress("Running Codex");
  const runner = new CodexRunner(LOG_DIR);
  const { code, stdout } = await runner.run(prompt, {
    cwd: WORK_DIR,
    taskName: "{{AGENT_NAME}}",
    timeoutMs: {{TIMEOUT_MS}},
    model: "{{MODEL}}",
  });

  log(`Codex exited with code: ${code}`);
  if (stdout) log(`--- Output ---\n${stdout}`);

  if (code !== 0) {
    log("{{DISPLAY_NAME}} failed");
    process.exit(1);
  }

  log("=== {{DISPLAY_NAME}} finished ===");
  cleanupOldLogs(LOG_DIR, ["{{AGENT_NAME}}-"], 30);
}

main().catch((err: unknown) => {
  log(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
```

## Notes

- `CodexRunner` manages the Codex thread lifecycle — no manual connect/disconnect needed
- Abort is handled automatically via process group SIGTERM — no `spawnClaudeWithSignals` wrapper needed
- No `repos` / `worktree` / `sessionId` — Codex operates on `WORK_DIR` directly
- `OPENAI_API_KEY` must be set in the agent's `envVars` in `agent.json`
