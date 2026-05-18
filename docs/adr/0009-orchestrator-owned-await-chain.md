# 9. Orchestrator-owned await chain

Date: 2026-05-18

## Status

Accepted

## Context

Agent-to-agent handoffs in DovePaw were previously driven by peer-handoff tools
— `start_chat_to_*`, `await_chat_to_*`, `start_review_with_*`,
`await_review_with_*`, `start_escalate_to_*`, `await_escalate_to_*` — that let
any sub-agent call the next agent in a chain directly. For a three-agent pipeline
`Dove → A → B → C`, agent A would invoke B and wait for it, B would invoke C and
wait for it, and each layer would block until the full downstream chain resolved.

This created several compounding problems:

**O(depth) await stacking.** Every layer in the chain holds an open `await_*`
call for the entire duration of all layers below it. With three hops the
innermost agent finishes first but A cannot complete until B finishes, which
cannot complete until C finishes. Each intermediate agent burns active model
context waiting on a call it could not influence.

**Tight coupling between sub-agents.** Sub-agents needed to know which other
agents they could hand off to and under what conditions. Orchestration logic
was distributed across multiple agent prompts and tool definitions rather than
concentrated at one decision point. Adding a new agent to an existing chain
required updating every agent that could hand off to it.

**Fragile gap-recovery.** To handle interruptions mid-chain, the runtime
maintained a `group-task-store` ledger, a `group-checkpoint` mechanism, and a
`group-recovery` module that attempted to detect which members had already
completed and restart only the incomplete portion. This code was ~500 lines and
carried its own test suite. In practice it was brittle: the checkpoint was
written after tool calls, not before, so a crash between calls left ambiguous
state.

**Duplicate group completion signal.** The `await_group_*` tool acted as a
barrier that could only fire once all members reported completion via the ledger.
Any member that failed silently — exiting without updating the ledger — left the
barrier open indefinitely.

The underlying cause in all four cases is the same: orchestration responsibility
was distributed into sub-agents rather than owned by the entity that started the
conversation.

## Decision

We will move all orchestration to the conversation-starter — Dove for
user-initiated flows, or the directly-chatted sub-agent for flows where the user
talks to a sub-agent directly.

Sub-agents invoked by Dove (`senderAgentId` is set) are **workers**. They
execute their own script and return a result. They do not receive peer-handoff
tools and they do not receive the links reminder. They cannot and must not invoke
the next agent in a chain themselves.

Sub-agents invoked directly by the user (`senderAgentId` is undefined,
`isDirectChat = true`) are **mini-orchestrators**. They receive
`start_<linkedKey>` / `await_<linkedKey>` tools for every agent reachable
transitively from their outgoing links (resolved via BFS at session startup).
They behave identically to Dove for the agents below them.

After each `await_*` completes, a PostToolUse hook (`buildLinksReminder` in
`chatbot/lib/hooks.ts`) injects an XML links reminder listing the completed
agent's outgoing links — their handoff range, strategy (HANDOFF / REVIEW /
ESCALATE), and score patterns. The orchestrator reads this reminder, scores
0–100, and decides whether to chain the next call. No downstream agent is
involved in that decision.

Group completion no longer uses a ledger. `start_group_*` registers the member
count in `groupMemberCounters` (in `chatbot/lib/group-member-counter.ts`,
separated to avoid a circular import). Each `await_<memberKey>(groupContextId)`
increments the counter; the last completion fires the `done` SSE event and calls
`setSessionStatus("done")`, then cleans up the counter. Members call their own
`await_run_script_<self>` and return; the group orchestrator above them (Dove)
drives the member loop with individual `await_<memberKey>` calls.

Review checklist:

- New sub-agent code must not call peer agents directly. Any agent-to-agent
  handoff must be initiated by the orchestrator layer (Dove or a
  `isDirectChat=true` sub-agent), not from within a running sub-agent session.
- The `isDirectChat` gate in `query-agent-executor.ts` must remain the sole
  switch for registering linked-agent tools and the links reminder hook. Do not
  register these tools for any session where `senderAgentId` is defined.
- `buildLinksReminder` must return `null` (not an empty reminder) when no
  outgoing links exist or when all links resolve to the current agent — it is
  used as a conditional injection guard in the PostToolUse hook.
- Transitive link resolution (`resolveTransitiveTargets` in
  `chatbot/a2a/lib/agent-config-reader.ts`) must cover all reachable agents
  before session start. If the links reminder surfaces an agent name that has no
  corresponding `start_*`/`await_*` tool already registered, the orchestrator
  cannot act on it.
- Group session setup: `start_group_*` must register a member count before any
  `await_<memberKey>` fires. Launching members without calling `start_group_*`
  first will cause the counter to never reach its target, leaving the group SSE
  stream open.

## Consequences

**Easier:**

- Orchestration logic lives in one place: the hooks injected into the
  conversation-starter's session. Changing handoff scoring or routing only
  requires touching `buildLinksReminder` and the orchestrator's system prompt,
  not the prompts of every agent in the chain.
- Sub-agent prompts are simpler. Workers describe what they do and return
  results; they carry no knowledge of which agent comes next or under what
  conditions.
- The group gap-recovery and ledger code (`group-task-store.ts`,
  `group-recovery.ts`, `group-checkpoint.ts`) is deleted — roughly 500 lines
  and a test suite. Group completion is now a counter decrement, which is
  correct by construction as long as every dispatched member calls exactly one
  `await_<memberKey>` with the group context ID.
- Net change of PR #47 is −3,073 lines (+387 / −3,460). Fewer moving parts
  means fewer places for interruption handling to fail.

**Harder / trade-offs:**

- Any flow that previously relied on a sub-agent calling a peer directly is now
  broken and must be redesigned so the orchestrator chains the call. There is no
  backwards-compatible shim — the peer-handoff tools are deleted.
- The group SSE stream will hang open if `start_group_*` is called but no
  `await_<memberKey>` with `groupContextId` is ever issued (for example, if a
  future code path dispatches members without going through the standard group
  setup). The Stop hook still prevents the orchestrator from stopping while
  pending tasks exist, so in practice this should be unreachable; but it is a
  silent failure mode that produces no error and requires inspecting server logs
  to diagnose.
- Mini-orchestrator mode (directly-chatted sub-agents) requires transitive link
  resolution at session startup. For deep or cyclic graphs this BFS runs once at
  session open, but the number of registered tools scales with the size of the
  reachable subgraph. Large graphs should be verified to stay within any tool
  count limits enforced by the SDK.
- The `isDirectChat` / `senderAgentId` distinction is now load-bearing. Any
  future entry point that invokes a sub-agent without setting `senderAgentId`
  will accidentally promote it to orchestrator mode and give it peer tools it
  should not have. New invocation paths in `query-agent-executor.ts` must
  explicitly set `senderAgentId` unless the intent is to grant orchestrator
  privileges.
