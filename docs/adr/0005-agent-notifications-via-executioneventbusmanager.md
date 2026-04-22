# 5. Agent notifications via ExecutionEventBusManager

Date: 2026-04-22

## Status

Proposed

## Context

DovePaw supports per-agent push notifications (currently ntfy) that alert users
when an agent session starts or ends. The existing implementation wires these
notifications as Claude Agent SDK `PreToolUse` and `PostToolUse` hook callbacks
inside `QueryAgentExecutor`. Specifically, `buildNotificationHooks` in
`chatbot/lib/notifications.ts` returns hook matchers that fire an HTTP fetch to
the ntfy server when `start_run_script` is called (session start) and when
`await_run_script` returns `status: "completed"` (session end). These matchers
are assembled in `chatbot/lib/subagent-hooks.ts` and passed through
`chatbot/a2a/lib/query-agent-executor.ts` into the `query()` call options —
three files touched for a single concern.

Two concrete production risks emerged with this approach. First, the hook
callback `await`s `sendNotification()`, which issues an HTTP fetch to the ntfy
server with no timeout. The fetch sits on the agent's critical execution path:
the SDK cannot proceed past the hook until the fetch resolves. If the ntfy
server is reachable, this adds 100–500 ms of latency to every session start and
end. If the ntfy server is unreachable, the hook stalls for the OS TCP timeout
— approximately 75 seconds on macOS — freezing the agent for over a minute.

`UnboundedEventBusManager` was introduced in `chatbot/a2a/lib/base-server.ts`
to raise the per-bus `EventTarget` listener limit (see the `MaxListenersExceededWarning`
fix). It already intercepts every new `ExecutionEventBus` via
`createOrGetByTaskId`. The A2A SDK calls `_sendPushNotificationIfNeeded` on
every event but gates it on `capabilities.pushNotifications`, which DovePaw
sets to `false`. A separate, DovePaw-owned listener on the bus bypasses this
gate entirely and can fire notifications asynchronously with no impact on agent
execution.

Scheduled sessions (launchd daemons via `a2a-trigger.mjs`) go through the same
A2A server and therefore the same bus — notifications fire regardless of whether
the session was triggered by a user in the UI or by the scheduler.

Related: [GitHub issue #27](https://github.com/delexw/DovePaw/issues/27).

## Decision

We will move agent notifications out of Claude Agent SDK hooks and into
`UnboundedEventBusManager` in `chatbot/a2a/lib/base-server.ts`.

`createOrGetByTaskId` will attach a one-time async listener to each newly
created bus. The listener reads per-agent notification config from
`agentSettings` using the agent name available at server construction time and
dispatches ntfy calls asynchronously — fully off the agent execution path. The
mapping from A2A task state to notification event is: `"working"` → session
start (`onSessionStart`); `"completed" | "failed" | "canceled"` → session end
(`onSessionEnd`).

`sendNtfyNotification` will be updated to include an explicit fetch timeout
(5 seconds) so a slow ntfy server cannot cause the listener to accumulate
indefinitely.

`buildNotificationHooks` will be removed from `chatbot/lib/notifications.ts`
and its call sites in `chatbot/lib/subagent-hooks.ts` and
`chatbot/a2a/lib/query-agent-executor.ts` cleaned up.

The following table summarises the tradeoffs considered:

| Concern                 | SDK hook approach                                                      | EventBusManager approach                      | Reason                                                                                                                                                                                |
| ----------------------- | ---------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent execution latency | Blocks on ntfy HTTP round-trip (~100–500ms)                            | Zero — fires fully async off execution path   | Every session start/end pays the ntfy network cost; over many sessions this accumulates as wasted agent CPU time                                                                      |
| ntfy unreachable        | Hangs agent for OS TCP timeout (~75s)                                  | Agent unaffected; listener logs and continues | A misconfigured or offline notification endpoint becomes a hard dependency that can stall the entire agent workflow                                                                   |
| Configuration           | 3 files (notifications.ts, subagent-hooks.ts, query-agent-executor.ts) | 1 file (base-server.ts)                       | Adding a second notification channel requires changes in three places, increasing the risk of mismatched or missed wiring                                                             |
| Trigger granularity     | Script-level (start_run_script / await_run_script)                     | Task-level (execute() start/end)              | Script-level is more precise but requires the sub-agent to correctly call the tool; task-level fires unconditionally even if the sub-agent skips the tool or errors before calling it |
| Timing accuracy         | Fires when script actually starts/ends                                 | Fires slightly earlier (before repos clone)   | The gap is repository cloning time (~5–30s depending on repo size); negligible for user-facing notifications but worth knowing for observability tooling                              |
| SDK coupling            | Hook callbacks in agent execution loop                                 | No SDK hook dependency for notifications      | SDK version upgrades that change hook callback semantics or timing would silently affect notification delivery                                                                        |

## Consequences

**Easier:**

- Agent execution is no longer affected by the availability or latency of the
  ntfy server. A misconfigured or offline notification endpoint cannot stall or
  freeze a session.
- Notification configuration lives in one place. Adding a new notification
  channel requires changes only to `base-server.ts` and `notifications.ts`
  (the dispatch logic), not to the hook wiring across three files.
- Scheduled sessions (launchd) receive notifications automatically — the bus
  fires on every task regardless of how it was initiated.

**Harder / trade-offs:**

- Trigger granularity shifts from script-level to task-level. The "session
  started" notification fires when `QueryAgentExecutor.execute()` begins, which
  is before repository cloning and workspace setup. In practice the gap between
  task acceptance and script invocation is short (typically under 30 seconds),
  and users have not indicated that script-level precision matters. This
  trade-off is accepted.
- The bus listener receives every A2A event and must filter by `status.state`.
  Care is needed to avoid attaching duplicate listeners if `createOrGetByTaskId`
  is called multiple times for the same task — the existing `UnboundedEventBusManager`
  already proxies to an inner manager that deduplicate by task ID, so the
  listener should be attached only on the first creation, not on retrieval.
