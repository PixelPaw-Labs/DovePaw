# 6. Orchestrate agents via A2A server, not direct script spawn

Date: 2026-05-02

## Status

Accepted

## Context

Each DovePaw agent is a TypeScript script (`main.ts`) that lives in a plugin
repo. When a user or Dove asks an agent to do work, there are two ways the
orchestration layer could invoke it:

**Direct spawn** — call `tsx main.ts` (or the compiled `.mjs` equivalent)
directly from within the orchestrating process, collect stdout, and return when
the process exits.

**A2A server** — send an A2A message to the agent's persistent HTTP server,
which in turn spawns the script, and receive results via SSE.

The direct spawn path is simpler on the surface but breaks down in three ways:

First, **responsiveness**. A direct spawn inside an MCP tool call is a blocking
operation from the SDK's perspective. The tool call does not return until the
process exits. Real agent tasks — cloning repos, running Claude subprocesses,
calling external APIs — routinely take minutes. During that time the
orchestrating sub-agent (Dove) is frozen: it cannot stream progress to the UI,
cannot respond to cancellation, and cannot interleave other work. The user sees
silence.

Second, **lifecycle management**. An OS process has only two observable states:
running or exited. Agents have richer state: submitted, working, completed,
failed, cancelled — with the ability to query past tasks and resume interrupted
ones via a persistent `contextId`. The A2A protocol provides this lifecycle
natively; direct spawn provides none of it.

Third, **entry-point uniformity**. Agents are triggered from multiple sources:
the chatbot UI, other agents, and macOS launchd daemons (via `a2a-trigger.mjs`)
operating on a schedule. If the invocation path were direct spawn, each trigger
source would need its own mechanism for spawning, managing, and observing the
script. The A2A server is a single HTTP endpoint that all callers share,
regardless of how the session originated.

## Decision

We will invoke agents exclusively through their A2A server. No code in DovePaw's
chatbot or orchestration layer will spawn an agent script process directly.

Concretely, this means:

- Dove's sub-agent calls `start_<agentName>` to start an agent session and
  `await_<agentName>` to poll for its result. The `start_*` tool returns a
  `runId` immediately; the agent script runs in the A2A server's process space
  and streams progress back via the event bus.
- The launchd daemon trigger (`a2a-trigger.mjs`) sends an A2A message to the
  server's port rather than spawning the script directly.
- Management tooling (logs, install, uninstall) communicates with the A2A server
  via its internal HTTP endpoints, not by invoking scripts.

The A2A servers are started once by the Electron process and remain alive for
the application's lifetime. They own the task store, session persistence, and
event bus for their agent. The chatbot layer is a pure client.

Review checklist:

- No `spawn`, `exec`, or `tsx` calls targeting agent `main.ts` or compiled
  `.mjs` files outside of `chatbot/a2a/lib/spawn.ts`
- New agent invocation paths use `startAgentStream` or `sendMessageStream`
  from `lib/a2a-client.ts`
- Daemon triggers go through `a2a-trigger.ts`, not direct script invocation

## Consequences

**Easier:**

- Dove remains responsive during long-running agent tasks. The `start_*` /
  `await_*` split allows the sub-agent to stream progress updates, accept
  cancellation, and interleave calls to other agents — none of which are
  possible when a tool call blocks on a child process.
- Task state is uniform and queryable. Any caller can ask the A2A server for
  the current state of a task and retrieve its history, without needing to track
  PIDs or buffer stdout themselves.
- All entry points (UI, daemon, agent-to-agent) share one invocation contract.
  Adding a new trigger source means implementing an A2A client, not a new spawn
  mechanism.
- A crash in an agent script is isolated to the A2A server process. It does not
  kill Dove's orchestration session or the chatbot's Next.js process.

**Harder / trade-offs:**

- There is indirection. To understand what happens when an agent runs, a reader
  must trace through the A2A client, the server handler, the executor, and
  finally the spawn layer — roughly four files instead of one `spawn()` call.
  This cost is paid once when learning the system and not on every change.
- All A2A servers must be running before agents can be invoked. Cold-start
  scenarios (e.g. running a single agent in a test without Electron) require
  starting at least that agent's server first. The `npm run chatbot:servers`
  script handles this, but it is a prerequisite that direct spawn would not have.
- Streaming progress from inside the agent script to the UI requires the script
  to POST to the A2A server's internal progress endpoint rather than writing to
  stdout. Scripts that only write stdout get captured output but no live
  streaming. This is a documentation and convention burden on plugin authors.
