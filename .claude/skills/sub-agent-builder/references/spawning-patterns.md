# Spawning Patterns

These patterns apply to **all three agent types** (Simple, Skill-based, Stateful).
Pick the right one based on what the agent does with repos. They can be combined — e.g. a stateful agent can use worktrees (B) inside its orchestration loop, or chain session steps (C) after the lock is acquired.

---

## Pattern A — No repos, or read-only access to all repos

Always run Claude in `AGENT_WORKSPACE`. Give Claude read access to repos via `--add-dir`.  
**Never use `REPOS[0]` as cwd** — `REPOS` is a list and the agent may need all of them.

```typescript
const repoFlags = REPOS.flatMap((r) => ["--add-dir", r]);
const { code, stdout } = await spawnClaudeWithSignals(
  ["--permission-mode", "readOnly", ...repoFlags, "-p", prompt],
  { cwd: WORK_DIR, taskName: "{{AGENT_NAME}}", timeoutMs: {{TIMEOUT_MS}} },
);
```

---

## Pattern B — Write to one specific repo (worktree isolation)

Pick the target repo explicitly. Add remaining repos with `--add-dir` so Claude still sees them.  
Use `-w <branch>` to sandbox changes in a git worktree — keeps the main branch clean.

```typescript
const targetRepo = REPOS[0]; // or: resolveRepoName("my-repo-name", REPOS)
const otherFlags = REPOS.filter((r) => r !== targetRepo).flatMap((r) => ["--add-dir", r]);
const branch = `{{AGENT_NAME}}-${makeTimestamp()}`;
const { code, stdout } = await spawnClaudeWithSignals(
  ["--permission-mode", "acceptEdits", "-w", branch, ...otherFlags, "-p", prompt],
  { cwd: targetRepo, taskName: "{{AGENT_NAME}}", timeoutMs: {{TIMEOUT_MS}} },
);
```

For **parallel worktrees** (e.g. one per Jira ticket or alert group):

```typescript
const results = await Promise.all(
  workItems.map(async (item) => {
    const branch = `{{AGENT_NAME}}-${item.id}-${makeTimestamp()}`;
    return spawnClaudeWithSignals(
      ["--permission-mode", "acceptEdits", "-w", branch, "-p", buildPrompt(item)],
      { cwd: targetRepo, taskName: `{{AGENT_NAME}}-${item.id}`, timeoutMs: {{TIMEOUT_MS}} },
    );
  }),
);
```

---

## Pattern C — Multi-step with session continuation

Use when sequential steps need shared context (step 2 needs step 1's findings).  
Step 1 discovers; step 2 acts on the findings. Avoids re-explaining context.

```typescript
const sessionId = randomUUID();

// Step 1: discovery / read-only
const { stdout: step1Output } = await spawnClaudeWithSignals(
  ["--session-id", sessionId, "--permission-mode", "readOnly", "-p", step1Prompt],
  { cwd: WORK_DIR, taskName: "{{AGENT_NAME}}-step1", timeoutMs: STEP1_TIMEOUT_MS },
);

// Step 2: act on step 1's findings (continues same session — full context retained)
const { code, stdout } = await spawnClaudeWithSignals(
  ["--resume", sessionId, "--permission-mode", "acceptEdits", "-p", step2Prompt],
  { cwd: WORK_DIR, taskName: "{{AGENT_NAME}}-step2", timeoutMs: STEP2_TIMEOUT_MS },
);
```

Only use when steps are genuinely sequential and share context. Single-step agents do not need this.

---

## Combining patterns

These compose naturally. Examples:

**Stateful + worktrees (Type 3 + Pattern B):** scheduled agent that processes multiple repos in parallel, each in its own worktree — lock prevents two runs racing, worktrees prevent branch conflicts.

**Stateful + session chain (Type 3 + Pattern C):** scheduled agent that first scans (readOnly, step 1) then files tickets (acceptEdits, step 2) — lock ensures one run at a time, session chain means step 2 has full context from the scan.

**Simple + multi-repo read (Type 1 + Pattern A):** on-demand agent that summarises commits across all configured repos — no lock needed, no writes, just `--add-dir` for each repo.
