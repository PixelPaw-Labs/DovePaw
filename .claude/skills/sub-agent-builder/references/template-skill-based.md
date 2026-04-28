# Type 2 — Skill-Based Agent Template

Use when the agent needs to assemble context dynamically (files, APIs, data) before running, rather than embedding that logic in a static prompt.

The agent builds a temporary Claude skill at runtime, runs it, then cleans up the skill dir.

## Placeholders

| Placeholder             | Description                                           |
| ----------------------- | ----------------------------------------------------- |
| `{{AGENT_NAME}}`        | kebab-case agent name                                 |
| `{{DISPLAY_NAME}}`      | human-readable name                                   |
| `{{TIMEOUT_MS}}`        | timeout in milliseconds                               |
| `{{DISCOVERY_LOGIC}}`   | code to discover source data (files, API calls, etc.) |
| `{{WRITE_REFERENCES}}`  | code to write reference files into `skillRefDir`      |
| `{{SKILL_DESCRIPTION}}` | one-line description for the dynamic skill            |
| `{{SKILL_BODY}}`        | the SKILL.md body content (phases, instructions)      |

## Template

```typescript
import { join } from "node:path";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import {
  AgentRunner,
  createLogger,
  makeTimestamp,
  cleanupOldLogs,
  agentPersistentLogDir,
} from "@dovepaw/agent-sdk";

// ─── Configuration ───────────────────────────────────────────────────────────
const HOME = process.env.HOME!;
const INSTRUCTION = process.argv[2] || "";
const WORK_DIR = process.env.AGENT_WORKSPACE!; // always set by executor — never add a fallback
const LOG_DIR = agentPersistentLogDir("{{AGENT_NAME}}");
const LOG_FILE = join(LOG_DIR, `{{AGENT_NAME}}-${makeTimestamp()}.log`);
const { log, publishStatusToUI } = createLogger(LOG_DIR, LOG_FILE);

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  log("=== {{DISPLAY_NAME}} started ===");

  // --- Discovery phase (customize per agent) ---
  await publishStatusToUI("Discovering sources…");
  // {{DISCOVERY_LOGIC}}
  // Example: const sources = await readDir(SOURCES_DIR);
  // if (!sources.length) { log("Nothing to process."); return; }

  // --- Build dynamic skill ---
  const skillName = `{{AGENT_NAME}}-${randomBytes(3).toString("hex")}`;
  const skillDir = join(HOME, ".claude/skills", skillName);
  const skillRefDir = join(skillDir, "references");
  mkdirSync(skillRefDir, { recursive: true });

  // Write reference files into skillRefDir
  // {{WRITE_REFERENCES}}
  // Example: writeFileSync(join(skillRefDir, "context.md"), buildContext(sources));

  writeFileSync(
    join(skillDir, "SKILL.md"),
    `---
name: ${skillName}
description: "{{SKILL_DESCRIPTION}}"
allowed-tools: Read, Edit, Write, Bash(mkdir *), Bash(rm *)
context: fork
---

{{SKILL_BODY}}
`,
  );

  const runner = new AgentRunner(LOG_DIR, LOG_FILE);
  try {
    await publishStatusToUI("Running skill…");
    const { code, stdout } = await runner.run(`/${skillName}\n\n${INSTRUCTION}`, {
      cwd: WORK_DIR,
      taskName: "{{AGENT_NAME}}",
      timeoutMs: {{TIMEOUT_MS}},
      claudeOpts: { permissionMode: "acceptEdits" },
      codexOpts: { sandboxMode: "danger-full-access" },
    });
    log(`Agent exited with code: ${code}`);
    log(stdout);
  } finally {
    // Always clean up skill dir — even if Claude throws
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

## Worktree variant (agent writes to a repo)

When the agent must commit code changes, replace `cwd: WORK_DIR` with the target repo path and add `claudeOpts: { worktree: branch }`. **AgentRunner owns the worktree lifecycle** — it creates and removes the worktree via Claude Code's `-w` flag. The skill body must NOT run `git worktree add` or `git worktree remove`.

Key changes from the base template:

- Add `parseRepos` / `resolveRepoName` imports from `@dovepaw/agent-sdk`
- Use `repoPath` as `cwd` instead of `WORK_DIR`
- Pass `claudeOpts: { worktree: branch }` to `runner.run()`
- Orient the agent in the skill body: `"You are already checked out on branch \`${branch}\`. Work in the current directory."`

```typescript
import { AgentRunner, parseRepos, resolveRepoName, /* ... */ } from "@dovepaw/agent-sdk";

const REPOS = parseRepos("REPO_LIST");

// inside fixItem():
const branch = `{{AGENT_NAME}}-${itemId}`;
const repoPath = resolveRepoName("my-repo", REPOS)!;

const runner = new AgentRunner(LOG_DIR, LOG_FILE); // create once, share across parallel runs
const { code, stdout } = await runner.run(`/${skillName}\n\n${INSTRUCTION}`, {
  cwd: repoPath,                                        // repo root, not AGENT_WORKSPACE
  taskName: `{{AGENT_NAME}}-${itemId}`,                // unique per parallel run
  timeoutMs: {{TIMEOUT_MS}},
  claudeOpts: { worktree: branch, permissionMode: "acceptEdits" },
  codexOpts: { sandboxMode: "danger-full-access" },
});
```

For parallel runs, create **one shared `AgentRunner`** and map over items with `Promise.all` — see Pattern B in `spawning-patterns.md`.
