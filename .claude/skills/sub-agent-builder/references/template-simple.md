# Type 1 — Simple Agent Template

Substitute all `{{PLACEHOLDER}}` values before writing to `~/.dovepaw/tmp/<name>/main.ts`.

## Placeholders

| Placeholder           | Description                                                                  |
| --------------------- | ---------------------------------------------------------------------------- |
| `{{AGENT_NAME}}`      | kebab-case agent name (e.g. `standup-writer`)                                |
| `{{DISPLAY_NAME}}`    | human-readable name (e.g. `Standup Writer`)                                  |
| `{{PERMISSION_MODE}}` | `readOnly` \| `acceptEdits` \| `autonomy`                                    |
| `{{TIMEOUT_MS}}`      | timeout in milliseconds (e.g. `300_000` for 5 min)                           |
| `{{PROMPT_BODY}}`     | the core task prompt given to Claude                                         |
| `{{REPOS_ENV_VAR}}`   | env var name for repo list (e.g. `REPO_LIST`) — omit block if not repo-based |

## Template

```typescript
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  AgentRunner,
  createLogger,
  makeTimestamp,
  cleanupOldLogs,
  AUTONOMY_PREFIX,
  PERSONA_RULES,
  parseRepos,
  agentPersistentLogDir,
} from "@dovepaw/agent-sdk";

// ─── Configuration ───────────────────────────────────────────────────────────
const INSTRUCTION = process.argv[2] || "";
// Omit the next line if the agent is not repo-linked:
const REPOS = parseRepos("{{REPOS_ENV_VAR}}");
const WORK_DIR = process.env.AGENT_WORKSPACE!; // always set by executor — never add a fallback
const LOG_DIR = agentPersistentLogDir("{{AGENT_NAME}}");
const LOG_FILE = join(LOG_DIR, `{{AGENT_NAME}}-${makeTimestamp()}.log`);
const { log, publishStatusToUI } = createLogger(LOG_DIR, LOG_FILE);

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  log("=== {{DISPLAY_NAME}} started ===");
  publishStatusToUI("Starting {{DISPLAY_NAME}}…");

  const prompt = [AUTONOMY_PREFIX, "", "{{PROMPT_BODY}}", "", PERSONA_RULES, "", `Instruction: ${INSTRUCTION}`].join(
    "\n",
  );

  // ── Spawning: read references/spawning-patterns.md for Options A / B / C ───
  // Pick based on repo access needs. Default (no repos): use WORK_DIR as cwd.
  const runner = new AgentRunner(LOG_DIR, LOG_FILE);
  const { code, stdout } = await runner.run(prompt, {
    cwd: WORK_DIR,
    taskName: "{{AGENT_NAME}}",
    timeoutMs: {{TIMEOUT_MS}},
    claudeOpts: { permissionMode: "{{PERMISSION_MODE}}" },
    codexOpts: { sandboxMode: "danger-full-access" },
  });

  log(`Agent exited with code: ${code}`);
  log(stdout);
  log("=== {{DISPLAY_NAME}} finished ===");
  cleanupOldLogs(LOG_DIR, ["{{AGENT_NAME}}-"], 30);
}

main().catch((err: unknown) => {
  log(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
```
