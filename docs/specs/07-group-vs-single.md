# Spec 07 · Group vs Single Agent Mode

A group is a named collection of agents that can be invoked together via a single `start_group_<name>` MCP tool. Dove fans out to 1–3 relevant members; each member runs in its own A2A task but shares one moments workspace and one group SSE stream.

> Anchor ADRs: [0009](../adr/0009-orchestrator-owned-await-chain.md) (the group barrier is a counter, not a ledger) and [0010](../adr/0010-group-start-topology-transitive-reachability-fallback.md) (start-topology selection).

## 1. The two-axis decision

```mermaid
flowchart TB
  start[Dove turn]
  start --> e{Eligible groups exist?<br/>linksFile.groups.filter members >= 2}
  e -- yes --> b[buildDovePromptReminder<br/>+ register start_group_* tools<br/>+ include GROUP_ORCHESTRATOR_REMINDER gate]
  e -- no --> l[buildDoveLeanReminder<br/>no group-orchestration score gate]

  b --> u{User's intent — group or solo?}
  u -- group/team --> sg[Dove calls start_group_<name>]
  u -- solo --> sa[Dove calls ask_/start_/await_ for single agent]
```

Group mode is **not** a global switch — it's per-call. Dove can interleave solo calls and group calls in the same turn.

## 2. Storage layout

```mermaid
flowchart LR
  L["agent-links.json"] --> G["groups: name, description, members array"]
  L --> Li["links: source/target/strategy/direction/group?"]
  CG["settings.groups/&lt;name&gt;/group.json"] --> R["repos: ids"]
  CG --> E["envVars"]
  G -. "shown in UI, eligible if >= 2" .-> Dove
  Li -. "used by GroupStartTopology to pick preferred members" .-> SG["start_group_&lt;name&gt;"]
  CG -. "merged into member's settings on dispatch" .-> QAE["QueryAgentExecutor"]
```

- Group membership and group description live in `agent-links.json` (`linksFile.groups`).
- Group-shared repos + env vars live in `~/.dovepaw/settings.groups/<name>/group.json` (see [`lib/group-config.ts`](../../lib/group-config.ts)).
- Eligible for Dove: `members.length >= 2`.

## 3. Member selection — preferred vs reachability fallback (ADR-0010)

```mermaid
flowchart TD
  links["group's chat-strategy links"] --> top["GroupStartTopology"]
  top --> pref["preferred: outDeg > 0 AND inDeg == 0<br/>true DAG roots only"]
  pref -- non-empty --> c1["candidates = preferred"]
  pref -- empty --> reach["fallback: highest transitive reachability"]
  reach --> all0{"all scores 0?"}
  all0 -- yes --> c2["candidates = full roster"]
  all0 -- no --> c3["candidates = ties at max score"]
  c1 --> ui["buckets rendered in tool description"]
  c2 --> ui
  c3 --> ui
```

Why this matters: bidirectional / cyclic groups have no pure DAG root. The old isolated-node fallback returned an empty bucket, the LLM saw nothing, and the eligibility gate was bypassed. Now reachability picks the most structurally central members.

`reachability(name, visited)` is a cycle-safe DFS — each member's score is an independent DFS from that member's node. `dual` links expand in both directions in the adjacency list (mirroring `outDeg`/`inDeg`).

## 4. `start_group_*` flow

```mermaid
sequenceDiagram
  participant L as Dove LLM
  participant SG as makeStartGroupTool
  participant Top as GroupStartTopology
  participant Prov as MemoryProvider
  participant FS as ~/.dovepaw/workspaces/group-<slug>-<id8>/
  participant DB as sessions table
  participant Reg as groupMemberCounters
  participant TP as TaskPoller per member

  L->>SG: start_group_<name>({ groupOrchestrationScore, members[1..3] })
  SG->>Top: preferred(memberDefs)
  Top-->>SG: preferred OR fallback
  SG->>SG: ranked = proposed.sort by relevance desc
  SG->>SG: dispatched = ranked.filter(>= 90).slice(0, 3)
  alt dispatched is empty
    SG-->>L: "No members scored above threshold — stopping."
  else
    SG->>Prov: provider.init(groupContextId, groupMomentsPath)
    SG->>FS: mkdir members/, write members/roster.md
    SG->>DB: upsertSession { id: groupContextId, agentId: group:<name>, ... }
    SG->>DB: setActiveSession(group:<name>, groupContextId)
    par per dispatched member
      SG->>SG: publish sender bubble + agent_status start
      SG->>TP: TaskPoller.start(...) with extraMetadata = groupMeta
      TP-->>SG: { taskId }
      SG->>SG: publish agent_status running
      SG->>Reg: counter.started += 1
    end
    SG-->>L: { memberTaskIds, groupContextId }
  end
```

Each dispatched member's A2A `extraMetadata` carries `{ isGroupChat, groupContextId, groupMomentsPath, groupName }`. The receiving `QueryAgentExecutor.resolveGroupChatOverrides()` reads these and switches into group mode.

The eligibility threshold `GROUP_MEMBER_RELEVANCE_THRESHOLD = 90` blocks tangential members. The cap of 3 dispatched per call bounds concurrent token spend.

## 5. Group completion counter (ADR-0009)

```mermaid
stateDiagram-v2
  [*] --> Empty
  Empty --> Open: start_group_* dispatched N members<br/>counter = { started: N, completed: 0 }
  Open --> Open: await_<key>(groupContextId=...) completes<br/>counter.completed++
  Open --> Closed: counter.completed >= counter.started<br/>publishSessionEvent done<br/>setSessionStatus done<br/>counters.delete(groupContextId)
  Closed --> [*]
```

No ledger, no checkpoint, no recovery file — just a `Map<groupContextId, { started, completed }>` in [`chatbot/lib/group-member-counter.ts`](../../chatbot/lib/group-member-counter.ts) (isolated from the rest to avoid a circular import).

**Failure mode** (acknowledged in ADR-0009): if `start_group_*` registers members but no `await_<memberKey>(groupContextId=…)` is ever issued, the SSE stream stays open. The Stop hook usually prevents this — but if a future code path bypasses it, the only diagnostic is server logs.

## 6. Member-side runtime — group mode switches

```mermaid
flowchart TD
  qae["QueryAgentExecutor.execute"] --> meta{"metadata.isGroupChat?"}
  meta -- yes --> g["groupOverrides set"]
  meta -- no --> s["solo path"]

  g --> noSess["Group members always start fresh — no resume"]
  g --> mergeCfg["Merge groupConfig.repos + envVars into member settings"]
  g --> noLinked["resolveLinkedTools → empty"]
  g --> dispatcher["A2AQueryDispatcher with groupRelay = groupContextId + agentName"]
  g --> hooks["buildSubAgentHooks isGroupMode=true<br/>+ makeGroupScriptAwaitToneHook<br/>+ makeGroupMomentSaveHook"]
  g --> prompt["buildSubAgentPrompt isGroupMode=true → no narration discipline"]
  g --> reminder["UserPromptSubmit = buildGroupReminder<br/>start_* discipline + no-narration"]
```

`A2AQueryDispatcher.groupRelay` does two things:

- Relays each text delta as `{ type:"group_member", agentId, text: accumulated, done:false }` to the group SSE pool — the swimlane shows live deltas
- On every `onToolCall`, **discards** accumulated `groupStreamText` (only post-tool text reaches the pool — keeps prose clean)
- On `onFinalOutput`, sends `{ done:true }` to close the bubble

A member's SQLite session is independent — moments are the shared layer.

## 7. The pool SSE stream

```mermaid
sequenceDiagram
  participant U as Browser /api/groups/stream/:groupCtxId
  participant Pub as publishSessionEvent in-process buffer
  participant Rel as relaySessionEvent HTTP
  participant Mem as Member A2AQueryDispatcher

  Mem->>Rel: { type:"group_member", agentId, text, done? } toSessionId=groupContextId
  Rel->>Pub: POST /api/internal/session-event { sessionId: groupContextId, event }
  Pub-->>U: SSE event
  Note over U: swimlane appends to that member's bubble
  Mem->>Rel: { type:"done" } when last counter tick fires (in await_<key> tool)
  Rel->>Pub: relay
  Pub-->>U: closes group session
```

**Never filter group pool events by `event.text` truthiness** — `done:true` may carry empty text and must pass through to clear bubble IDs ([MEMORY.md](../../.claude/projects/-Users-yang-liu-Envato-others-DovePaw/memory/project_group_chat_done_event_filter.md)).

## 8. Group-orchestrator score gate (Spec 01 cross-ref)

The PreToolUse `start_*` gate is registered on Dove **whenever at least one eligible group exists** (`eligibleGroups.length > 0` in `route.ts`) — not only when a particular call happens inside a group session. That means **every** Dove-side `start_*` call in such a workspace must clear the gate, including ones for solo agents.

The gate logic (in `buildDoveHooks`, group branch):

| Tool input shape                      | Decision                                                                                                                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `group.groupOrchestrationScore >= 80` | allow                                                                                                                                                                                                               |
| `group.groupOrchestrationScore < 80`  | deny — "score is X, must be >= 80" + group-orchestrator rules                                                                                                                                                       |
| `group` field missing entirely        | deny — asks the model whether it is in a group; if YES recall with the field, if NO recall without (but the next attempt without the field will be denied again — this forces explicit orchestrator-mode reasoning) |

Reminders verbatim from `GROUP_ORCHESTRATOR_REMINDER`:

Rules covered (from `dove-lean-reminder.ts`):

- Don't claim "no handoffs needed" when independent outputs ≠ convergence
- Don't pre-assign handoffs inside member instructions
- Don't stop after one round
- These rules do **not** bypass `justification.confidence`

## 9. Group session DB representation

```mermaid
flowchart LR
  R["sessions row<br/>id=groupContextId, agentId=group:&lt;name&gt;, workspacePath=groupMomentsPath"]
  R --> ASr["active_sessions: agentId=group:&lt;name&gt;, sessionId=groupContextId"]
  R --> EV["publishSessionEvent done sets status=done"]
```

When the user revisits the group session from history, the chat page mounts the swimlane component and reads from this row.

## 10. Cleanup

- On `done` event from the last member completion → `setSessionStatus(groupContextId, "done")` and `groupMemberCounters.delete(groupContextId)`.
- On user delete → cascades through `deleteSession(groupContextId)` (which cascades to `dove_agent_contexts`).
- `delete` of any member's contextId removes its row from the DB; the group session is unaffected.
- `provider.delete(groupContextId, groupMomentsPath)` should be called by the route handler — verify in code before relying on it.

## Related

- [Spec 03 — Orchestrator behaviour](03-orchestrator-behaviour.md) (Dove is the only group orchestrator)
- [Spec 04 — Handoff pattern](04-handoff-pattern.md) (`group` field on `start_*`, group-orch score gate)
- [Spec 06 — Memory management](06-memory-management.md) (`provider.init` lifecycle)
- [Spec 09 — Agent links & canvas](09-agent-links-canvas.md) (group definitions + topology source)
- ADRs [0009](../adr/0009-orchestrator-owned-await-chain.md), [0010](../adr/0010-group-start-topology-transitive-reachability-fallback.md)
