# Spec 10 · UI Surfaces — Chat Page, Settings, Dialogs

The browser surfaces and the React hooks that drive them. Covers the chat page, settings pages, permission/question dialogs, group swimlane, session history, and the SSE event taxonomy the UI consumes. Written under the **critical-reading rule** — Section 10 surfaces concrete UI bugs and design gaps rather than just transcribing the code.

## 1. Component tree (top-down)

```mermaid
flowchart TB
  layout["app/layout.tsx<br/>+ OpenVikingFirstBootModal mount"]
  layout --> page["app/page.tsx — server component<br/>reads agentConfigs, plugins, doveSettings, groups (server-initial-props)"]
  page --> ChatApp["ChatApp — client root<br/>ConversationProvider + activeAgentId state"]
  ChatApp --> Sidebar["AgentSidebar<br/>grouped by plugin · Dove pinned · Kiln for tmp agents"]
  ChatApp --> Agent["AgentChat (key=activeAgentId)<br/>routes to single OR group view"]

  Agent -- "agentId starts with 'group:'" --> Group["GroupChatView<br/>uses useGroupChatSession"]
  Agent -- "otherwise" --> Single["AgentChatSession<br/>uses useChatSession"]

  Single --> Pane["ChatPane"]
  Single --> History["SessionHistoryPanel"]

  Pane --> Bar["ChatInputBar"]
  Pane --> Msgs["ChatMessage list"]
  Pane --> PB["PermissionBanner / QuestionBanner"]
  Pane --> ProcBar["ProcessingBar (heartbeat)"]
  Pane --> Intro["IntroCard + SuggestionChips"]

  Group --> Swim["GroupSwimlane<br/>(swimlane-buckets, group-swimlane-lane, group-swimlane-bubble, etc.)"]
  Group --> Bar
```

The `key={activeAgentId}` on `<AgentChat>` is load-bearing: switching agents fully remounts the chat, so each `useChatSession` instance owns its own refs and timers. (Same identity-key reasoning the server-side `MessageAccumulator` uses for stable message IDs.)

## 2. Settings pages

```mermaid
flowchart LR
  settingsLayout["app/settings/layout.tsx"]
  settingsLayout --> sp["app/settings/page.tsx — overview"]
  settingsLayout --> al["app/settings/agent-links/page.tsx<br/>+ canvas geometry (Spec 09)"]
  settingsLayout --> ag["app/settings/agents/page.tsx<br/>+ per-agent settings.agents/&lt;name&gt;/agent.json edits"]
  settingsLayout --> gp["app/settings/groups/page.tsx<br/>+ settings.groups/&lt;name&gt;/group.json edits"]
  settingsLayout --> pl["app/settings/plugins/page.tsx<br/>+ plugins.json CRUD"]
  ov["OpenVikingTab (in /settings)"] --> ovapi["POST /api/openviking/config"]

  sp -. "router.refresh() on save" .-> sp
  ag -. "save → POST /api/settings/agents<br/>router.refresh()" .-> ag
  gp -. "save → POST /api/settings/groups<br/>router.refresh()" .-> gp
  pl -. "addPlugin / removePlugin / syncPlugin / updatePlugin" .-> pl
```

Every settings page follows the same pattern:

1. **Server component reads from disk** and passes `initialX` props (the project's standard "no hydration flash" pattern).
2. **Client component owns form state** prefilled from `initialX`.
3. **Save POSTs to an `/api/settings/*` route**; server writes through `lib/settings.ts` → optionally to S3 via `pushConfig()`.
4. **`router.refresh()` after success** re-renders server components without a full reload (sidebar, agent lists pick up the change).

The agent-links canvas is the one exception: its geometry is pure client-side (Spec 09 §6) and the edge layout responds live to drag without going through the server.

## 3. SSE event taxonomy (browser consumption)

```mermaid
classDiagram
  class ChatSseEvent {
    discriminated by `type`
  }
  class Session {
    type: session
    sessionId: string
  }
  class Text {
    type: text
    content: string
  }
  class Thinking {
    type: thinking
    content: string
  }
  class ToolCall {
    type: tool_call
    name: string
  }
  class ToolInput {
    type: tool_input
    content: string (JSON)
  }
  class Done {
    type: done
    content?: string (fallback when no text deltas)
  }
  class Cancelled {
    type: cancelled
  }
  class Error_ {
    type: error
    content: string
  }
  class Progress {
    type: progress
    result: StreamedResult
  }
  class Permission {
    type: permission
    requestId
    toolName, toolInput, title?
  }
  class Question {
    type: question
    requestId
    questions[]
  }
  class GroupMember {
    type: group_member
    agentId
    text, done
    isSender?
  }
  class AgentStatus {
    type: agent_status
    agentKey, id, status
  }

  ChatSseEvent <|.. Session
  ChatSseEvent <|.. Text
  ChatSseEvent <|.. Thinking
  ChatSseEvent <|.. ToolCall
  ChatSseEvent <|.. ToolInput
  ChatSseEvent <|.. Done
  ChatSseEvent <|.. Cancelled
  ChatSseEvent <|.. Error_
  ChatSseEvent <|.. Progress
  ChatSseEvent <|.. Permission
  ChatSseEvent <|.. Question
  ChatSseEvent <|.. GroupMember
  ChatSseEvent <|.. AgentStatus
```

Effort levels filter what reaches the browser:

| Effort | text                                                  | thinking     | tool_call                          | tool_input   | progress     | structural events |
| ------ | ----------------------------------------------------- | ------------ | ---------------------------------- | ------------ | ------------ | ----------------- |
| `none` | suppressed                                            | suppressed   | suppressed                         | suppressed   | suppressed   | pass-through      |
| `low`  | pass-through (with `\n\n` separator after tool calls) | suppressed   | inserts separator, then suppressed | suppressed   | suppressed   | pass-through      |
| `high` | pass-through                                          | pass-through | pass-through                       | pass-through | pass-through | pass-through      |

`structural events` = session, error, cancelled, done, permission, question, group_member, agent_status.

## 4. `useChatSession` — the central client hook

```mermaid
stateDiagram-v2
  [*] --> Idle: mount → load active session
  Idle --> Streaming: sendMessage → POST /api/chat (SSE)
  Streaming --> Streaming: events drain to processActiveStreamEvent → setMessages
  Streaming --> Idle: done OR cancelled OR error
  Idle --> Reconnect: setSessionId (history click)
  Reconnect --> SseReplay: status=running AND resumeHint (resumeSeq, last assistant text)
  Reconnect --> Polling: status=running AND no resumeHint (Dove-triggered A2A session)
  SseReplay --> Idle: done / cancelled
  Polling --> Idle: status flips done/cancelled
  Idle --> Idle: newSession → reset state + PUT active_session id=null
  Idle --> Idle: deleteSession → DELETE /api/chat
  Streaming --> Idle: cancelMessage → abortRef.abort + fire-and-forget DELETE method=stop
```

### Two reconnect strategies

```mermaid
flowchart TD
  rec["reconnectRunningSession"]
  rec --> rh{"resumeSeq > 0<br/>AND lastAssistant<br/>AND resumeText present?"}
  rh -- yes --> sse["connectStream(sessionId, warmReconnect, resumeHint)<br/>GET /api/chat/stream/&lt;sessionId&gt;?after=&lt;seq&gt;<br/>replays buffered events via readSseStream"]
  rh -- no --> poll["startPolling<br/>poll DB session detail every N ms<br/>fall through Dove-triggered A2A sessions whose events aren't in /api/chat/stream/"]
```

The buffered `/api/chat/stream/` endpoint has a 60-second TTL (session-events.ts). After 60s of no subscribers, the buffer is cleared. A reconnect attempt that arrives after that falls into the DB-polling path. This is why long-running Dove-A2A sessions can be reopened from history without losing prior content.

### Message queue while loading

```mermaid
sequenceDiagram
  participant U as User
  participant Hook as useChatSession
  participant Queue as pendingQueueRef
  participant Drain as useEffect drain

  U->>Hook: sendMessage(text1)
  Hook->>Hook: isLoading=true, fetch POST starts
  U->>Hook: sendMessage(text2) while loading
  Hook->>Queue: push text2
  U->>Hook: sendMessage(text3) while loading
  Hook->>Queue: push text3
  Hook->>Hook: stream ends → isLoading=false
  Drain->>Drain: isLoading change fires effect
  Drain->>Hook: sendMessage(text2)  -- auto-drain
  Note over Drain: text3 stays queued until text2 finishes — but see Concern 1
```

## 5. Permission / question dialog flow

```mermaid
sequenceDiagram
  participant SDK as Dove SDK
  participant SSE as SSE stream
  participant Hook as useChatSession
  participant State as pendingPermissions[]
  participant UI as PermissionBanner
  participant API as POST /api/chat/permission

  SDK->>SSE: { type:"permission", requestId, toolName, toolInput, title }
  SSE->>Hook: processActiveStreamEvent → setPendingPermissions(prev → prev+event)
  State->>UI: banner renders with Allow / Deny
  UI->>Hook: resolvePermission(requestId, allowed)
  Hook->>API: POST { requestId, allowed }
  API-->>Hook: 200 ok
  Hook->>State: pendingPermissions.filter(!== requestId)
  API-->>SDK: pending Promise resolves → canUseTool returns allow/deny

  alt POST fails (network error or 404)
    Hook->>UI: banner stays visible — user can retry
  end
```

`AskUserQuestion` flow is identical but with `pendingQuestions` and `/api/chat/question`. Both endpoints look up the request in the shared `globalThis.__dovePending*` map (see Spec 02 §5) and resolve the SDK-side Promise.

## 6. Group swimlane

```mermaid
flowchart TD
  group["GroupChatView<br/>useGroupChatSession(groupName)"]
  group --> stream["/api/groups/stream/&lt;groupContextId&gt; SSE"]
  stream --> evts{event.type}
  evts -- "group_member (isSender=true)" --> sender["sender bubble (Dove's tailored instruction)"]
  evts -- "group_member (isSender=false, done=false)" --> live["member bubble live append (text accumulates)"]
  evts -- "group_member (done=true)" --> close["close member bubble id (dedupe via useRef Set)"]
  evts -- "agent_status start/running" --> lane["lane shows animation"]
  evts -- "agent_status completed/failed/canceled/rejected" --> mark["lane shows final marker"]
  evts -- "done" --> stop["close group stream"]
```

The swimlane uses `useSwimlaneSteps` to group bubbles into per-member lanes, and `swimlane-buckets.ts` to bucket sequential steps. The dedupe `useRef Set` is critical — without it, stream reconnects would create duplicate sender bubbles for the same `start_*` dispatch.

## 7. Session history

`SessionHistoryPanel` reads from `useAgentSessions(agentId)`, which fetches `GET /api/sessions?agentId=<id>`. Each session row has `id`, `label`, `status`, `startedAt`. The panel:

- Shows the active session ID highlighted
- Shows `runningSessionIds` (from DB + live `isLoading`) with a spinner
- Click → `session.setSessionId(id)` → reconnect flow ([§4](#4-usechatsession--the-central-client-hook))
- Trash icon → `session.deleteSession(id)` → DELETE `/api/chat` → DB row + workspace deleted (Spec 11 Concern 1)

```mermaid
sequenceDiagram
  participant U as User
  participant Hist as SessionHistoryPanel
  participant Hook as useChatSession
  participant API as fetch
  participant DB as SQLite (via API)

  U->>Hist: click session row
  Hist->>Hook: setSessionId(id)
  Hook->>Hook: abort current stream, clear state
  Hook->>API: GET /api/sessions/&lt;agentId&gt;/&lt;id&gt;
  API->>DB: SELECT messages, status, resumeSeq
  API-->>Hook: stamped messages
  alt status == running
    Hook->>Hook: reconnectRunningSession → SSE or polling
  else
    Hook->>Hook: setMessages(stamped) — done view
  end
```

## 8. ConversationContext

`ConversationProvider` lives in `chat-app.tsx` and exposes `isLoading`, `activeAgentId`, `doveIsRunning`. Consumers read it for cross-cutting UI state (e.g. agent-button shimmer, sidebar processing badges).

A consumer call **outside** the provider returns a fallback `{ isLoading: false, ... }` instead of throwing — components that may render outside the provider don't need null-checks at every call site.

## 9. SSR-safe `localStorage` reads

Per the project convention, every component that reads `localStorage` must use a static SSR-safe default in `useState` and apply the persisted value inside `useEffect`. Otherwise hydration mismatches occur.

## 10. Bugs / flaws / open concerns

### Concern 1 · ★★★ — STOP doesn't stop the message queue

`cancelMessage()` aborts the current fetch and sets `setIsLoading(false)`. The drain `useEffect` fires immediately on the `isLoading` transition and sends the next queued message. From the user's perspective: I click STOP, the current response stops, and the _next queued message starts running_. Intent was almost certainly to stop everything.

Fix shape: `cancelMessage` should also clear `pendingQueueRef` (or the drain effect should check a "cancel requested" flag and bail). Three lines.

### Concern 2 · ★★ — `cancelMessage` server call is fire-and-forget

```ts
void fetch(agentChatUrl(agentId), {
  method: "DELETE",
  ...
  body: JSON.stringify({ sessionId, method: "stop" }),
});
```

No `await`, no error handling. If the network call fails (Next.js process restart between client abort and DELETE arriving), the server-side `sessionRunner.abort(sessionId)` never runs. The subprocess keeps going. The UI shows "cancelled" but the next user turn will see the previous PendingRegistry blocking, ghost SSE events flowing in, etc.

Fix shape: await the DELETE, surface a banner on failure with a retry button. Or at least log the failure to the console so server-side state inconsistency is observable.

### Concern 3 · ★★ — `clearAllHistory` doesn't abort running sessions

```ts
const handleClearAllHistory = React.useCallback(async () => {
  await fetch("/api/sessions/all", { method: "DELETE" });
  newSessionRef.current?.();
}, []);
```

`DELETE /api/sessions/all` clears the DB. If a Dove session was running, its subprocess keeps running with no DB row, no UI representation, no way to stop it short of restarting the Next.js process. Orphan subprocess until natural completion or SIGTERM.

Fix shape: server side, iterate `sessionRunner.getRunningSessionIds()` and `sessionRunner.abort()` each before `deleteAllSessions()`. Cross-link: [Spec 11 Concern 1](11-abort-pipeline.md#concern-1--★★★--stop-deletes-sub-agent-workspaces) compounds this — every "running" session's workspace gets wiped on the cascade.

### Concern 4 · ★★ — `cancelled` clears banners, `error` does not

In `processActiveStreamEvent`, the `cancelled` branch does `setPendingPermissions([])` + `setPendingQuestions([])`. The `error` branch does not. After an error:

- Permission banner stays visible
- User clicks Allow → POST `/api/chat/permission` → server-side map already cleared by `abortPendingPermissions` from route.ts catch → 404
- The Hook's `resolvePermission` catch path "leaves the banner visible so the user can retry" — so the user clicks again, same 404, banner stays forever

Fix shape: clear pending permissions/questions on `error` too. Or change `resolvePermission` to remove the banner on 404 specifically.

### Concern 5 · ★★ — `processActiveStreamEvent` silently drops `agent_status` and `group_member`

The function dispatches on `event.type` for 9 known types, and ignores anything else. `agent_status` and `group_member` arrive on the active SSE stream when Dove dispatches members in a group — but neither is handled in the single-agent hook. They're handled by `useGroupChatSession`'s separate group SSE stream subscription, so the loss is OK in practice — but if a single-agent session ever received an `agent_status` event (e.g. through some accidental relay), it would be silently swallowed with no log.

Fix shape: log unknown event types in development. Add an exhaustiveness check on the discriminated union (the existing `ChatSseEvent` union has these as members, so TS won't catch the omission).

### Concern 6 · ★ — `removeFromQueue(index)` is index-based and racey

```ts
const removeFromQueue = useCallback((index: number) => {
  const next = pendingQueueRef.current.filter((_, i) => i !== index);
  pendingQueueRef.current = next;
  setPendingQueue(next);
}, []);
```

If the drain effect fires between the user's click event and this callback, the queue may have shifted by one. The user clicks the X on row 2; row 0 dispatches; row 2 becomes the "old row 3". The X click removes the new row 2, not the intended message.

Fix shape: key by message text + a generated id rather than positional index. Tracked by users frequently enough that it's worth fixing.

### Concern 7 · ★ — `messageReady` lazy creation can lose the assistant bubble

`connectStream` with `messageReady=false` only creates the assistant message on the first `text` event or `done` with `content`. If a session completes with no text output and `done` without `content` (e.g. a sub-agent that emits only tool calls and finishes), the user sees no assistant bubble at all — the cold-reconnect branch never runs the creator. The polling fallback handles this differently (always creates a bubble on first poll).

Verifying: spec 06's group flow says members emit moments via tool calls and may have no final text. In group mode this goes through `useGroupChatSession`, not `connectStream`, so the bug surface is small. But sub-agent direct-chat sessions that produce only tool-call output would have this issue.

Fix shape: also create the bubble on the first non-text event (tool_call, tool_input, progress), not just text/done-with-content.

### Concern 8 · ★ — `connectStream` `after=<seq>` race with mid-replay events

The reconnect URL is `?after=<lastSeqRef.current>`. While the GET response is being assembled on the server, new events may be appended to the session_events log with seq > after. The server's stream endpoint should atomically snapshot + subscribe, but no spec describes this contract. If the snapshot is racy, the client might miss events between `seq=after+1` and the moment the subscription actually starts.

Fix shape: verify `/api/chat/stream/[sessionId]` handler does snapshot-then-subscribe atomically. If not, fix server-side. Not in the UI surface but worth flagging from here so the next person investigates.

### Concern 9 · ★ — `pendingQueue` doesn't survive page reload

`pendingQueue` lives in `useState` only. Reload the page and queued messages are gone. For long Dove turns where the user queues multiple follow-ups, an accidental reload silently discards them.

Fix shape: persist to `localStorage` keyed by agentId. Restore in mount effect.

## 11. Things that are well-designed (audit pass)

- **Component remount via `key={activeAgentId}`** — no manual ref/state reset needed on agent switch.
- **Server-initial-props pattern** — avoids hydration flash for settings + active agent state.
- **`useLayoutEffect` for isLoading propagation to ConversationContext** — shimmer animation stays in sync with the chat area, no one-frame trailing flash.
- **`useRef Set` for group sender-bubble dedup across stream reconnects** — fixes the duplicate-bubble class of bugs that come from messages-state-based dedupe.
- **`abortPermissions` scoped to per-query Set** — Spec 02 §5; never affects other tabs.
- **`messageReady` lazy creation pattern** — solves the "(no response)" placeholder for cold reconnects with no buffered events. (Has Concern 7 edge case, but the base idea is sound.)
- **Two reconnect strategies (SSE vs polling) chosen by `resumeHint` presence** — naturally falls through for Dove-triggered A2A sessions whose buffered SSE expired after 60s.

## Related

- [Spec 02 — Security guardrails](02-security-guardrails.md) §5 (server side of permission round-trip)
- [Spec 03 — Orchestrator behaviour](03-orchestrator-behaviour.md) (Dove route.ts, session lifecycle)
- [Spec 06 — Memory management](06-memory-management.md) §9 (OpenViking first-boot modal + settings tab)
- [Spec 07 — Group vs single mode](07-group-vs-single.md) §7 (pool SSE stream the swimlane consumes)
- [Spec 08 — Plugin lifecycle](08-plugin-lifecycle.md) (settings → plugins page)
- [Spec 09 — Agent links & canvas](09-agent-links-canvas.md) (settings → agent-links page)
- [Spec 11 — Abort pipeline](11-abort-pipeline.md) Concerns 1 and 7 (compound effects in the UI)
