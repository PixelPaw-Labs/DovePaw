# 7. Agent logic runs as a child process, not inline in the A2A server

Date: 2026-05-02

## Status

Accepted

## Context

Each agent's A2A server receives an incoming task and must execute the agent's
work. There are two ways to do this:

**Inline execution** — import the agent's `main.ts` as a module (or inline its
logic) and call it as a function within the A2A server's Node.js process.

**Child process** — spawn `tsx main.ts` as a separate OS process, capture its
stdout/stderr, and collect the result when the process exits.

Inline execution appears simpler: no spawn overhead, no stdout capture, direct
access to the server's logger and event bus. But this simplicity breaks down
across six concerns that are fundamental to how DovePaw agents are designed to
work.

**Process isolation.** Agent scripts do heavy, potentially unstable work: cloning
repositories, running Claude CLI subprocesses, calling external APIs, writing to
disk. A crash, uncaught exception, or runaway memory allocation in an agent
would take down the A2A server's process if the logic ran inline — killing all
concurrently running tasks for that agent and severing the server's HTTP
connection to the chatbot. As a child process, the agent can be killed
independently. The A2A server remains alive to accept the next task.

**Environment sanitization.** Agent scripts require a carefully scoped runtime
environment: a specific working directory (the agent's workspace), a filtered
set of environment variables, `CLAUDECODE` unset so that nested `claude` CLI
invocations work correctly, and `DOVEPAW_TASK_ID` injected so the script can
post progress to the server's internal endpoint. Achieving this inline would
require threading a synthetic environment object through every function call in
the agent. A child process receives its environment at spawn time via
`spawnOptions.env` — the boundary is inherent.

**Plugin trust boundary.** Agent scripts live in third-party plugin repos. They
are not DovePaw's code. Running arbitrary plugin code inline in the A2A server
process would give that code full access to the server's module scope,
credentials, and event bus. A child process is a natural sandbox: the script
can only communicate with the server via stdout/stderr capture and the progress
HTTP endpoint. It cannot reach server internals.

**Parallel execution without shared-state risk.** Several agents (e.g. Forge)
spawn multiple concurrent runs — one per ticket — each in an isolated git
worktree. If each run were an in-process function call, all runs would share the
same module-level state and file descriptors. As child processes, runs are
completely isolated: separate memory spaces, separate working directories,
separate environment variables.

**Composability.** Because each script's only contract with DovePaw is "read env
vars, write stdout, optionally POST progress," the runtime can arrange
independent scripts into pipelines and parallel fan-outs without any script
needing to know about the others. DovePaw implements three concrete composition
patterns on top of this boundary: handoff (`start_chat_to_*` /
`await_chat_to_*`), peer review (`start_review_with_*` /
`await_review_with_*`), and group parallel execution (`start_group_*` / `await_group_*`). In each case the connection tools are
injected at runtime based on configured agent links — the scripts themselves
have no imports or references to each other. Inline execution would require
scripts to call each other's module exports directly, creating tight coupling
that would make independent deployment via plugin repos impossible.

**Language agnosticism.** Inline execution requires the agent to be a Node.js
module — the A2A server can only `import` TypeScript or JavaScript. A child
process contract is language-neutral: any executable that reads environment
variables and writes to stdout satisfies it. This means agent scripts could be
written in Python, Ruby, shell, or any other language without changes to the
A2A server. Currently all DovePaw agents are TypeScript, but the architecture
does not require it.

## Decision

We will always execute agent logic by spawning `tsx <scriptPath>` (or the
compiled `.mjs` equivalent) as a child process via `spawnAndCollect` in
`chatbot/a2a/lib/spawn.ts`. No A2A server or executor will import or call an
agent script's exports as in-process module functions.

Concretely:

- `spawn.ts` is the sole spawn site. All A2A executors go through this module.
- The spawned process receives its environment entirely through `spawnOptions.env`
  — no environment mutation of the parent process.
- Progress from within the script is communicated via HTTP POST to the A2A
  server's internal endpoint (`/internal/tasks/:taskId/progress`), not via shared
  in-memory objects or event emitters.
- Parallel agent runs spawn N independent child processes. No shared module
  state is permitted between concurrent runs.

Review checklist:

- No agent `main.ts` or agent package is imported in `chatbot/a2a/` code
- New agent execution paths call `startScript` or `spawnAndCollect`, not module
  imports
- Environment passed to child process is assembled in `buildAgentConfig` and
  spread at spawn time, not mutated on `process.env`

## Consequences

**Easier:**

- A crash or hang in an agent script does not kill the A2A server or any other
  concurrently running task. The server can log the failure, mark the task as
  failed, and continue accepting new requests.
- Environment isolation is guaranteed by the OS process boundary. There is no
  risk of an agent script accidentally reading or mutating the server's
  credentials or configuration.
- Parallel agent runs are trivially safe: each child process has independent
  memory, working directory, and file handles. No locking or shared-state
  coordination is needed.
- Plugin authors write standalone scripts, not modules that conform to a DovePaw
  internal API. A plugin repo's `main.ts` reads from the environment and writes
  to stdout — it has no coupling to DovePaw internals.
- Agent composition (handoff, review, group parallel execution) works without
  any script importing another. DovePaw injects connection tools at runtime;
  scripts remain fully independent and can be developed, installed, and
  versioned separately.
- The agent contract (env vars in, stdout/progress POST out) is language-neutral.
  A future plugin could ship a Python or shell script without any changes to the
  A2A server or executor.

**Harder / trade-offs:**

- There is spawn overhead on every task invocation. For very short tasks (under
  a second) the process startup cost is noticeable relative to the work done.
  This is acceptable given that real agent tasks are orders of magnitude longer,
  but microbenchmarks should not be used to justify moving logic inline.
- Progress streaming from within the script requires an HTTP POST to the server's
  internal endpoint rather than a direct in-memory call. Scripts that only write
  to stdout get buffered output with no live streaming until the process exits.
  This is a convention burden for plugin authors.
- Debugging a child process cannot use the A2A server's debug session directly.
  Log output from scripts flows through `createLogger` (writing to a file) rather
  than the server's structured logger. However, because agent scripts are
  standalone executables — reading instructions from env vars and writing results
  to stdout — they can also be run directly outside DovePaw with a minimal set
  of environment variables. This makes isolated debugging straightforward: the
  developer does not need the full DovePaw runtime running to reproduce a bug in
  a single script.
