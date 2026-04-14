# 2. Do not use Claude Code loop or ScheduleWakeup for agent polling in bounded query sessions

Date: 2026-04-15

## Status

Accepted

## Context

DovePaw agents (e.g. memory-dream, forge, oncall-analyzer) are triggered by Dove via custom
MCP tools — `start_run_script` returns a `runId` immediately, and `await_run_script` polls
until the agent finishes. This is a deliberate A2A process-boundary pattern, not an
implementation detail.

When an `await_run_script` call returns `still_running`, the agent (Dove) sometimes chose
to call `ScheduleWakeup` to defer polling — scheduling a future session turn to check back.
This caused a silent failure: `ScheduleWakeup` is a Claude Code `/loop` primitive designed
for **persistent interactive CLI sessions**, where the session remains alive across the sleep
window. In DovePaw, Dove runs inside a bounded `query()` call in the A2A server. When
`query()` reaches `end_turn`, it resolves and exits — any `ScheduleWakeup` timer registered
within that session is discarded and never fires.

The failure mode was subtle:

1. Dove called `await_run_script` → `still_running`
2. Dove called `ScheduleWakeup(90s)` → `end_turn`
3. Stop hook (first fire, `stop_hook_active: false`) correctly blocked and forced a retry
4. Dove polled once more → still running → called `ScheduleWakeup` again → `end_turn`
5. Stop hook (second fire, `stop_hook_active: true`) allowed the stop to prevent an infinite
   block loop
6. Session exited. The scheduled wakeup was never executed. The `await_run_script` result
   was permanently lost.

A separate question arose during this investigation: could the SDK agent loop (`query()`)
replace the `start_run_script` / `await_run_script` pattern entirely? The answer is no.
The start/await pattern crosses an **A2A process boundary** — each agent runs in its own
process with its own workspace (`AGENT_WORKSPACE`), injected `envVars`, agent-specific MCP
tools, independent lifecycle, and launchd scheduling. Replacing with the SDK `Agent` tool
(in-process subagent nesting) would collapse all agents into Dove's process and config,
destroying agent isolation, independent lifecycles, and daemon scheduling.

## Decision

**`ScheduleWakeup` must not be called while `await_run_script` (or any equivalent await
tool) has a pending result.** Doing so silently drops the result because the wakeup cannot
fire after `query()` resolves.

**The start/await MCP pattern must not be replaced by the SDK agent loop.** The A2A process
boundary is load-bearing: it provides per-agent workspace isolation, injected secrets,
independent process lifecycles, launchd daemon compatibility, and cross-session runId
resumability. The SDK `Agent` tool is in-process subagent nesting — a different primitive
suited for work inside a single agent, not for Dove-to-agent handoff.

These decisions are enforced with a `PreToolUse` hook in `chatbot/lib/hooks.ts`
(`buildAgentHooks`) that denies `ScheduleWakeup` calls whenever pending await operations
exist, with a clear error message directing the agent to poll in-session instead.

## Consequences

**Easier:**

- Dove is guaranteed to retrieve every `await_run_script` result — polling must complete
  in-session.
- The Stop hook's `stop_hook_active` guard functions correctly: by the time it fires a
  second time, `ScheduleWakeup` has already been blocked, so the agent cannot accidentally
  exit with a pending result.
- The architectural boundary between Dove (orchestrator) and agents (isolated processes) is
  explicit and defended in code.

**Harder / trade-offs:**

- Dove cannot sleep cheaply between polls. It must call `await_run_script` in a loop,
  relying on `StillRunningRetryCounter` to surface naturally without blocking the UI on
  every cycle. For agents that run 10+ minutes this means many polling turns within the
  same `query()`.
- The prohibition on replacing start/await with the SDK loop means the custom MCP tool
  machinery (`start_run_script`, `await_run_script`, `runningScripts` map, `PendingRegistry`,
  `StillRunningRetryCounter`, Stop hook) must be maintained. This complexity is the cost of
  proper agent isolation.
