# 4. A2A-to-chatbot event relay via HTTP

Date: 2026-04-21

## Status

Accepted

## Context

DovePaw runs as two distinct OS processes: the **Next.js chatbot** (port 7473)
and one or more **A2A server** processes (one per registered agent). These
processes share no memory.

`publishSessionEvent` in `chatbot/lib/session-events.ts` is backed by an
in-process Node.js `EventEmitter` and a `Map` of session buffers. SSE endpoints
such as `/api/chat/stream/[sessionId]` and `/api/groups/stream/[groupContextId]`
subscribe to this emitter at request time. When a Next.js route handler calls
`publishSessionEvent`, the event reaches every active SSE subscriber in the same
process.

The A2A servers import `publishSessionEvent` from the same module. Because
Node.js modules are not shared across OS processes, each A2A server holds its
own separate copy of the `EventEmitter` and `Map`. A `publishSessionEvent` call
inside an A2A server writes to that server's local copy — a no-op for any
Next.js subscriber. This caused terminal events (`done`, `cancelled`, `error`)
emitted from `QueryAgentExecutor` to be silently dropped, and group-chat pool
stream events emitted during member-to-member communication to never reach the
browser.

A secondary concern arose for group-chat streaming: when member agents relay
their generated text to the group pool stream (`groupContextId`), that relay also
requires the event to land in the Next.js process, not in the A2A server that is
executing the member's Claude sub-agent.

A2A servers already make outbound HTTP calls to the chatbot as part of normal
operation (e.g. `TaskPoller` communicates back via A2A protocol). Adding one
more HTTP call for event relay introduces no new infrastructure dependency.

## Decision

**A2A server code must never call `publishSessionEvent` directly.** The function
is in-process only; calling it from an A2A server is always a no-op for Next.js
subscribers.

**All session event publishing from A2A server code must go through
`relaySessionEvent` in `chatbot/lib/relay-to-chatbot.ts`.** This function
POSTs `{ sessionId, event }` to `POST /api/internal/session-event` on the
chatbot, which calls `publishSessionEvent` in-process where SSE subscribers
live. The port is read from `process.env.DOVEPAW_PORT` with a fallback of
`"7473"`.

The relay is fire-and-forget: the A2A server does not block on the POST. Errors
are logged via `consola.warn` and the A2A task continues — a transient relay
failure must not crash or stall an agent execution.

For group-chat member text streaming, the relay follows the same path.
`A2AQueryDispatcher` accumulates streamed text in `groupStreamText` when
`groupRelay` is set; each `onTextDelta` call relays the growing text via
`emit({ type: "group_member", ... }, groupRelay.groupContextId)`. Because `groupContextId` is propagated through A2A task
`extraMetadata` at every tool-call hop, member-to-member chains (A → B → C)
each relay their text independently to the same group pool stream.

Review checklist:

- No `publishSessionEvent` import in any file under `chatbot/a2a/`
- Group-chat member text relay uses `relaySessionEvent` with `groupContextId`, not `contextId`
- New A2A-side terminal event sites (done, cancelled, error) use `relaySessionEvent`

## Consequences

**Easier:**

- Terminal events (`done`, `cancelled`, `error`) emitted by `QueryAgentExecutor`
  now reach Next.js SSE subscribers. The session stream endpoint
  (`/api/chat/stream/[sessionId]`) populates the in-memory buffer with live
  events, so clients connecting mid-run receive real-time deltas (Mode 1) rather
  than always falling back to DB replay (Mode 3). The DB fallback remains in
  place for restarts and buffer eviction.
- Group-chat member text streams in real time in the browser — both for members
  triggered directly by Dove and for members triggered by other members via
  agent-link tools — without any client-side session stream connection.
- The cross-process communication pattern is explicit and centralised in one
  helper function, making it easy to audit all A2A → chatbot event traffic.

**Harder / trade-offs:**

- Each terminal event and each streamed text chunk incurs an HTTP round-trip to
  localhost. For long-running agents with high text throughput, this is a
  meaningful number of loopback requests. Batching or a shared IPC transport
  could reduce this overhead but adds complexity not yet justified by observed
  performance.
- If the chatbot process is down or slow to respond, relay calls silently fail
  and the browser receives no live events for that session. The DB-backed fallback
  (Mode 3 in `/api/chat/stream/[sessionId]`) still serves the final session
  content on reconnect, so data is not lost — only real-time delivery is
  affected.
- The `POST /api/internal/session-event` endpoint has no authentication. It
  accepts any caller on localhost. This is acceptable for a local-only deployment
  but must be revisited before exposing DovePaw over a network.
