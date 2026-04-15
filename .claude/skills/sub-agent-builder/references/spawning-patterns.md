# Spawning Patterns

These patterns apply to **all three agent types** (Simple, Skill-based, Stateful).
Pick the right one based on what the agent does with repos. They can be combined — e.g. a stateful agent can use worktrees (B) inside its orchestration loop, or chain session steps (C) after the lock is acquired.

---

## Choosing `timeoutMs`

The SDK default is **30 minutes** (`30 * 60 * 1000`). Override based on expected work duration — do not leave `{{TIMEOUT_MS}}` unresolved.

| Agent behaviour                                      | Recommended timeout                     |
| ---------------------------------------------------- | --------------------------------------- |
| Simple lookup, single question, or short summary     | `10 * 60 * 1000` (10 min)               |
| Multi-step analysis or moderate investigation        | `30 * 60 * 1000` (30 min) — SDK default |
| Deep research, broad scan, or processing many items  | `60 * 60 * 1000` (1 hour)               |
| Long-running work across multiple sources or stages  | `2 * 60 * 60 * 1000` (2 hours)          |
| Unbounded / scheduled batch work or open-ended tasks | `4 * 60 * 60 * 1000` (4 hours)          |

**Rules:**

- Prefer a named constant over an inline expression: `const TIMEOUT_MS = 2 * 60 * 60 * 1000;`
- For Pattern C (session chain), set each step's timeout independently — step 1 (discovery) is usually shorter than step 2 (implementation).
- For parallel worktrees (Pattern B multi), the same timeout applies per-item, not to the whole batch.
- When in doubt, set higher rather than lower — a timed-out agent loses all work silently.

---

## Pattern A — No repos, or read-only access to all repos (single Claude invocation)

Always run Claude in `AGENT_WORKSPACE`. Give Claude read access to repos via `--add-dir`.  
**Never use `REPOS[0]` as cwd** — `REPOS` is a list and the agent may need all of them.

```typescript
const repoFlags = REPOS.flatMap((r) => ["--add-dir", r]);
const { code, stdout } = await spawnClaudeWithSignals(
  ["--permission-mode", "readOnly", ...repoFlags, "-p", prompt],
  { cwd: WORK_DIR, taskName: "{{AGENT_NAME}}", timeoutMs: {{TIMEOUT_MS}} },
);
```

## Pattern A (multi-repo) — One Claude invocation per repo, run in parallel

Use when each repo needs independent processing (e.g. per-repo summary, per-repo audit).  
**Always use `Promise.all` — never loop sequentially.**

```typescript
import { basename } from "node:path";

const results = await Promise.all(
  REPOS.map(async (repo) => {
    const { code, stdout } = await spawnClaudeWithSignals(
      ["--permission-mode", "readOnly", "--add-dir", repo, "-p", buildPrompt(repo)],
      { cwd: WORK_DIR, taskName: `{{AGENT_NAME}}-${basename(repo)}`, timeoutMs: {{TIMEOUT_MS}} },
    );
    return { repo, code, stdout };
  }),
);
```

---

## Pattern B — Write to one specific repo (worktree isolation)

Pick the target repo explicitly. Add remaining repos via `RunOpts.repos` so Claude still sees them.  
Use `ClaudeRunner` (from `@dovepaw/agent-sdk`) instead of `spawnClaudeWithSignals` — it wraps worktree
spawning with a watchdog that detects hung CLI processes and retries once automatically.

```typescript
import { ClaudeRunner, makeTimestamp } from "@dovepaw/agent-sdk";

const runner = new ClaudeRunner(LOG_DIR, LOG_FILE);
const targetRepo = REPOS[0]; // or: resolveRepoName("my-repo-name", REPOS)
const branch = `{{AGENT_NAME}}-${makeTimestamp()}`;
const { code, stdout } = await runner.run(prompt, {
  cwd: targetRepo,
  repos: REPOS.filter((r) => r !== targetRepo),
  worktree: branch,
  taskName: "{{AGENT_NAME}}",
  timeoutMs: {{TIMEOUT_MS}},
});
```

For **parallel worktrees** (e.g. one per Jira ticket or alert group) — share one `ClaudeRunner` instance:

```typescript
const runner = new ClaudeRunner(LOG_DIR, LOG_FILE);
const results = await Promise.all(
  workItems.map(async (item) => {
    const branch = `{{AGENT_NAME}}-${item.id}-${makeTimestamp()}`;
    return runner.run(buildPrompt(item), {
      cwd: targetRepo,
      worktree: branch,
      taskName: `{{AGENT_NAME}}-${item.id}`,
      timeoutMs: {{TIMEOUT_MS}},
    });
  }),
);
```

---

## Pattern C — Multi-step with session continuation

Use when sequential steps need shared context (step 2 needs step 1's findings).  
Step 1 discovers; step 2 acts on the findings. Avoids re-explaining context.

```typescript
import { randomUUID } from "node:crypto";

const sessionId = randomUUID();

// Step 1: discovery / read-only
const { stdout: step1Output } = await runner.run(step1Prompt, {
  cwd: WORK_DIR,
  sessionId,
  taskName: "{{AGENT_NAME}}-step1",
  timeoutMs: STEP1_TIMEOUT_MS,
});

// Step 2: act on step 1's findings (continues same session — full context retained)
const { code, stdout } = await runner.run(step2Prompt, {
  cwd: WORK_DIR,
  resumeSession: sessionId,
  taskName: "{{AGENT_NAME}}-step2",
  timeoutMs: STEP2_TIMEOUT_MS,
});
```

Only use when steps are genuinely sequential and share context. Single-step agents do not need this.

---

## Combining patterns

These compose naturally. Examples:

**Stateful + worktrees (Type 3 + Pattern B):** scheduled agent that processes multiple repos in parallel, each in its own worktree — lock prevents two runs racing, worktrees prevent branch conflicts.

**Stateful + session chain (Type 3 + Pattern C):** scheduled agent that first scans (readOnly, step 1) then files tickets (acceptEdits, step 2) — lock ensures one run at a time, session chain means step 2 has full context from the scan.

**Simple + multi-repo read (Type 1 + Pattern A):** on-demand agent that summarises commits across all configured repos — no lock needed, no writes, just `--add-dir` for each repo.
