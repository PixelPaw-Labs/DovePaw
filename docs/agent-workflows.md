# Agent Script Workflows

Each agent is a `main.ts` file that defines a **workflow**. The workflow can be anything — a single skill call, a sequence of prompts, or a full multi-step pipeline that loops across repos, spawns parallel Claude subprocesses, and hands off to other agents.

The pattern is always the same: **TypeScript for the deterministic parts, Claude CLI for the judgment.**

## Workflow Complexity Spectrum

**Simple — invoke a single skill:**

```typescript
async function main() {
  const instruction = process.argv[2] ?? "run across all repos";
  await spawnClaudeWithSignals({
    prompt: `/my-skill ${instruction}`,
    cwd: process.env.AGENT_WORKSPACE!,
  });
}
```

**Medium — glue two skills with a prompt between them:**

```typescript
async function main() {
  const repo = process.argv[2]!;

  // Step 1: gather findings
  await spawnClaudeWithSignals({
    prompt: `/audit-skill analyse ${repo}`,
    cwd: repo,
  });

  // Step 2: act on findings — same session has full context from step 1
  await spawnClaudeWithSignals({
    prompt: `Based on the audit above, open a PR fixing the critical issues only.`,
    cwd: repo,
    resume: true,
  });
}
```

**Full pipeline — loop, parallelize, chain across agents:**

```typescript
async function main() {
  const repos = instruction ? [instruction] : process.env.REPO_LIST!.split(",");

  // Phase 1: parallel analysis
  const results = await Promise.all(
    repos.map((repo) => spawnClaudeWithSignals({ prompt: buildAnalysisPrompt(repo), cwd: repo })),
  );

  // Phase 2: sequential fix pass where order matters
  for (const repo of reposThatNeedFix(results)) {
    await spawnClaudeWithSignals({ prompt: buildFixPrompt(repo), cwd: repo });
  }
}
```

The TypeScript layer owns: which repos, what order, when to parallelize, how to structure the prompt, when to retry. Claude owns: reading code, making judgements, writing files, opening PRs.

## Workflow Shape

Every workflow follows the same structure:

```
Configuration   — env vars, paths, logger
buildPrompt()   — compose what Claude CLI receives (a skill call, raw prose, or both)
main()          — orchestrate: gather data → spawnClaudeWithSignals() → handle output
```

`spawnClaudeWithSignals()` from `@dovepaw/agent-sdk` is the only place Claude runs. Everything before it is deterministic.

## Dual-Mode Entry

Workflows are dual-mode. The same file handles both paths:

| Trigger                   | `process.argv[2]`         | Mode                                           |
| ------------------------- | ------------------------- | ---------------------------------------------- |
| Chatbot invocation        | User's instruction string | Interactive — acts on the specific instruction |
| launchd schedule (no arg) | `undefined`               | Batch — iterates all repos in `REPO_LIST`      |

## SDK Helpers

`@dovepaw/agent-sdk` provides utilities available in every workflow:

| Helper                              | Purpose                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| `spawnClaudeWithSignals(opts)`      | Spawns a Claude CLI subprocess; forwards abort signals; streams output                           |
| `createLogger(name)`                | Writes structured logs to `~/.dovepaw/agents/logs/<name>.log`                                    |
| `emitProgress(message, artifacts?)` | Emits a progress update visible in the chatbot UI                                                |
| `resolveClaudeSecurityOpts()`       | Reads `DOVEPAW_SECURITY_MODE` and returns the correct permission mode for nested `query()` calls |

## Environment Variables

Every workflow receives these from the A2A executor:

| Variable                | Value                                           |
| ----------------------- | ----------------------------------------------- |
| `AGENT_WORKSPACE`       | Isolated workspace directory for this run       |
| `REPO_LIST`             | Comma-separated repos configured for this agent |
| `DOVEPAW_SECURITY_MODE` | `read-only` / `supervised` / `autonomous`       |

Per-agent secrets are declared in `agent.json` under `envVars` and injected at daemon install time.

## Logging

Use `createLogger` — never `console.log`. `console.log` writes to the captured stdout buffer; `createLogger` writes to the persistent log at `~/.dovepaw/agents/logs/<name>.log`.

```typescript
const log = createLogger("my-agent");
log.info("Starting run");
log.warn("Rate limit hit, retrying");
log.error("Repo not found", { repo });
```

## Plugin Layout

Each workflow lives in a plugin repo:

```
my-plugin-repo/
  dovepaw-plugin.json     — plugin manifest (name, version, agents list)
  agents/my-agent/
    agent.json            — agent metadata (name, description, schedule, icon)
    main.ts               — workflow entry point
```

The `agent.json` `description` field is the MCP tool description Dove reads — write it as an explicit trigger contract. See [agent-links.md](agent-links.md) for how the description controls routing and handoff.
