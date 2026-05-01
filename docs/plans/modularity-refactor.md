# Modularity Refactor

Goal: make the basic flow (Dove chat → A2A servers → agent scripts + hooks + cross-platform scheduling)
extractable to other projects. Features (plugins, groups, agent links, persistence, macOS launchd) are
additive layers that DovePaw enables but a new project can omit.

Branch: `refactor/modularity`

Rules:

- Every commit leaves DovePaw **fully working** (TypeScript compiles, tests pass, no feature broken)
- Each commit is the smallest possible change
- Verify after every commit: `npm run agents:test && npm run test`
- Full stack check where noted: `npm run chatbot:dev:all`

---

## Phase 1 — Path splits

- [ ] **Commit 1 — `lib/launchd-paths.ts`**
  - Create `lib/launchd-paths.ts` with: `LAUNCH_AGENTS_DIR`, `SCHEDULER_ROOT`, `AGENTS_DIST`, `plistFilePath`, `agentDistScript`, `schedulerScript`, `schedulerNodeModule`, `A2A_TRIGGER_SCRIPT`
  - `lib/paths.ts`: remove those symbols, add `export * from "./launchd-paths"`
  - Update direct importers: `lib/launchd.ts`, `lib/plist-generate.ts`, `lib/installer.ts`, `lib/a2a-trigger.ts`, `chatbot/lib/paths.ts`
  - Verify: `npm run agents:test`

- [ ] **Commit 2 — `lib/plugin-paths.ts`**
  - Create `lib/plugin-paths.ts` with: `PLUGINS_DIR`, `PLUGINS_REGISTRY_FILE`, `AGENT_SDK_DIR`, `AGENT_SDK_SRC`
  - `lib/paths.ts`: remove those, add `export * from "./plugin-paths"`
  - Update: `lib/plugin-manager.ts`, `scripts/deploy-sdk.ts`
  - Verify: `npm run agents:test`

- [ ] **Commit 3 — `lib/group-paths.ts`**
  - Create `lib/group-paths.ts` with: `GROUP_SETTINGS_DIR`, `groupConfigDir`, `groupConfigFile`, `GROUP_WORKSPACE_ROOT`
  - `lib/paths.ts`: remove those, add `export * from "./group-paths"`
  - Update: `lib/agent-groups.ts`, `lib/group-config.ts`, `chatbot/lib/query-tools.ts`
  - Verify: `npm run agents:test`

---

## Phase 1 — agent-tools.ts splits

- [ ] **Commit 4 — `chatbot/lib/agent-mgmt-tools.ts`**
  - Create `chatbot/lib/agent-mgmt-tools.ts` with `makeAgentMgmtTools`, `MGMT_TOOL`
  - `chatbot/lib/agent-tools.ts`: remove those definitions, add `export * from "./agent-mgmt-tools"`
  - No consumer changes needed (barrel re-exports)
  - Verify: `npm run agents:test && npm run test`

- [ ] **Commit 5 — `chatbot/lib/agent-script-tools.ts`**
  - Create `chatbot/lib/agent-script-tools.ts` with: `makeStartScriptTool`, `makeAwaitScriptTool`, `buildSubAgentPrompt`, `MOMENTS_PATTERN`, `HANDOFF_COMPLETENESS`, `startRunScriptToolName`, `awaitRunScriptToolName`, `withStartReminder`
  - `chatbot/lib/agent-tools.ts`: remove those definitions, add `export * from "./agent-script-tools"`
  - **Do NOT remove `isGroupChat` parameter** — stays in `makeStartScriptTool` for now
  - Verify: `npm run agents:test && npm run test`

- [ ] **Commit 6 — `chatbot/lib/agent-link-tools.ts`**
  - Create `chatbot/lib/agent-link-tools.ts` with: all link tool factories (`makeStartChatToTool`, `makeAwaitChatToTool`, `makeStartReviewTool`, `makeAwaitReviewTool`, `makeStartEscalateTool`, `makeAwaitEscalateTool`), constants (`justificationField`, `CONFIDENCE_THRESHOLD`, `impactPlaceholder`, `thresholdClause`), and all link tool-name helpers
  - `chatbot/lib/agent-tools.ts`: remove those definitions, add `export * from "./agent-link-tools"`
  - After this commit `agent-tools.ts` is a pure barrel of 3 re-exports
  - Verify: `npm run agents:test && npm run test`

---

## Phase 1 — query-tools.ts split

- [ ] **Commit 7 — `chatbot/lib/group-tools.ts` (create only, not yet wired)**
  - Create `chatbot/lib/group-tools.ts` with `makeInitGroupTool`, `makeStartGroupTool`, `makeAwaitGroupTool`, `doveInitGroupToolName`, `doveStartGroupToolName`, `doveAwaitGroupToolName` — copied from `query-tools.ts`
  - `chatbot/lib/query-tools.ts`: add `export * from "./group-tools"` — group tools now re-exported from both
  - No consumer changes yet — `route.ts` still imports from `query-tools`
  - Verify: `npm run agents:test && npm run test`

- [ ] **Commit 8 — cut `query-tools.ts` loose from db** _(atomic: 2 files)_
  - `chatbot/app/api/chat/route.ts`: update group tool imports to come from `@/lib/group-tools`
  - `chatbot/lib/query-tools.ts`: remove group function definitions, remove `export * from "./group-tools"`, remove all db imports (`upsertSession`, `setActiveSession`, `setGroupMessage`, `setSessionStatus`), remove group-specific imports (`AgentGroup`, `GROUP_WORKSPACE_ROOT`, `readOrCreateGroupConfig`)
  - Verify: `npm run agents:test && npm run test && npm run chatbot:dev:all`

---

## Phase 1 — subagent-hooks.ts split

- [ ] **Commit 9 — `chatbot/lib/agent-link-hooks.ts`**
  - Create `chatbot/lib/agent-link-hooks.ts` with the link justification-gate PreToolUse matchers (chat_to, review_with, escalate_to reflection hooks) extracted from `subagent-hooks.ts`
  - `chatbot/lib/subagent-hooks.ts`: remove those matchers, add `export * from "./agent-link-hooks"` — `buildSubAgentHooks` signature unchanged
  - Verify: `npm run agents:test && npm run test`

---

## Phase 2 — Decoupling

- [ ] **Commit 10 — persistence bootstrap** _(atomic: 3 files — splitting breaks session status writes)_
  - Create `chatbot/lib/persistence.ts` with `enablePersistence()` that calls `closeStaleSessions()` and wires `sessionRunner.configure({ onComplete, onAbort })`
  - `chatbot/lib/session-runner.ts`: add `configure(callbacks: SessionStatusCallbacks)` method, replace direct `setSessionStatus` calls with `this.callbacks.onComplete?.(id)` / `onAbort?.(id)`, remove `db.ts` import
  - `chatbot/app/api/chat/route.ts`: replace `closeStaleSessions()` with `enablePersistence()` import
  - Verify: `npm run agents:test && npm run chatbot:dev:all` — check session status still writes to db

- [ ] **Commit 11 — executor persistence** _(atomic: 2 files)_
  - `chatbot/a2a/lib/query-agent-executor.ts`: add `ExecutorPersistence` interface (covering `upsertSession`, `setActive`, `setStatus`, `saveSession`), make it optional constructor param, replace all 4+ direct db call sites with `this.persistence?.…()`
  - `chatbot/a2a/lib/base-server.ts`: create concrete `ExecutorPersistence` adapter from db imports, pass it to `QueryAgentExecutor` constructor
  - Verify: `npm run agents:test && npm run chatbot:dev:all` — check session history still persists

- [ ] **Commit 12 — executor launchd deps** _(atomic: 2 files)_
  - `chatbot/a2a/lib/query-agent-executor.ts`: accept optional `mgmtTools?: Tool[]` constructor param (default `[]`), replace `...makeAgentMgmtTools(this.def)` with `...this.mgmtTools`; remove `LAUNCH_AGENTS_DIR` from hardcoded `additionalDirectories`
  - `chatbot/a2a/lib/base-server.ts`: pass `mgmtTools: makeAgentMgmtTools(def)` and add `LAUNCH_AGENTS_DIR` to additionalDirectories when constructing executor — keeps DovePaw behavior unchanged
  - Verify: `npm run agents:test && npm run chatbot:dev:all`

- [ ] **Commit 13 — Dove prompt group reminder**
  - `chatbot/lib/hooks.ts`: `buildDoveHooks` gains `options: { includeGroupReminder?: boolean } = {}`, uses lean reminder (ask/start/await only) when false, full group-aware reminder when true
  - `chatbot/app/api/chat/route.ts`: pass `{ includeGroupReminder: true }` to preserve current DovePaw behavior
  - Verify: `npm run agents:test && npm run test`

---

## Phase 2 — route.ts isolation

- [ ] **Commit 14 — extract launchd section from route.ts**
  - Create `chatbot/lib/launchd-feature.ts` with `getLaunchdAdditionalDirs()` returning `[LAUNCH_AGENTS_DIR, SCHEDULER_ROOT]` and `buildLaunchdSystemPromptSection(settings)` returning the launchd/cron/scheduler prose currently inlined in `buildSystemPrompt`
  - `chatbot/app/api/chat/route.ts`: replace inline launchd path list and system-prompt block with calls to those helpers
  - No behavior change — same values, different source file
  - Verify: `npm run agents:test`

- [ ] **Commit 15 — groups conditional in route.ts**
  - `chatbot/app/api/chat/route.ts`: wrap group tool registration in `if (eligibleGroups.length > 0)` — no groups configured → no group tools registered, no behavior change for DovePaw with groups
  - Verify: `npm run chatbot:dev:all`

---

## Phase 3 — InProcessScheduler

- [ ] **Commit 16 — `chatbot/a2a/lib/in-process-scheduler.ts`** _(new file only, not yet wired)_
  - Write tests first: `chatbot/a2a/lib/__tests__/in-process-scheduler.test.ts` (mock timers, mock A2A client, mock `readScheduledAgentsConfig`)
  - Implement `InProcessScheduler`:
    - Reads port manifest **lazily at fire time** (not at start)
    - `scheduledJobs[]` takes precedence over top-level `schedule` when both present
    - Handles `runAtLoad` per-job (fire immediately on start)
    - Skips past-due `onetime` jobs on startup
    - `interval` → `setInterval`; `calendar` → `setTimeout` to next occurrence then re-arm; `onetime` → single `setTimeout`
    - `stop()` clears all timers
  - Not wired into `start-all.ts` yet
  - Verify: `npm run agents:test`

- [ ] **Commit 17 — wire InProcessScheduler into start-all.ts**
  - `chatbot/a2a/start-all.ts`: after port manifest is written, start scheduler when `process.platform !== "darwin"` or `DOVEPAW_IN_PROCESS_SCHEDULER=1`
  - Verify: macOS unchanged; Linux/env-var activates scheduler

- [ ] **Commit 18 — build.ts Linux skip**
  - `build.ts`: wrap plist install block in `if (process.platform === "darwin")`
  - Verify: `npm run agents:test`

---

## Phase 4 — UI

- [ ] **Commit 19 — `chat-pane.tsx` historyPanel prop**
  - `chatbot/components/agent-chat/chat-pane.tsx`: add `historyPanel?: React.ReactNode` prop, render it where `SessionHistoryPanel` is currently inlined
  - Update call site (DovePaw's page/layout) to pass `historyPanel={<SessionHistoryPanel ... />}` — keeps current behavior
  - Verify: `npm run test`

- [ ] **Commit 20 — settings nav data-driven**
  - `chatbot/app/settings/layout.tsx`: Groups nav link conditional on `groups.length > 0`; Plugins nav link conditional on `plugins.length > 0`; remove Agent Links nav link
  - No new config — reactive to server-side data already loaded in this file
  - Verify: `npm run test`

- [ ] **Commit 21 — page.tsx agent-links cleanup**
  - `chatbot/app/page.tsx`: remove `readAgentLinksFile()` call if its only remaining consumers were the agent-links nav link (now removed) and groups data passed to settings layout. Verify no other component depends on it before removing.
  - Verify: `npm run test && npm run chatbot:dev:all`

---

## Summary

| #   | Commit                            | Phase                    | Status |
| --- | --------------------------------- | ------------------------ | ------ |
| 1   | lib/launchd-paths.ts              | 1 - paths                | ⬜     |
| 2   | lib/plugin-paths.ts               | 1 - paths                | ⬜     |
| 3   | lib/group-paths.ts                | 1 - paths                | ⬜     |
| 4   | agent-mgmt-tools.ts               | 1 - agent-tools split    | ⬜     |
| 5   | agent-script-tools.ts             | 1 - agent-tools split    | ⬜     |
| 6   | agent-link-tools.ts               | 1 - agent-tools split    | ⬜     |
| 7   | group-tools.ts (create)           | 1 - query-tools split    | ⬜     |
| 8   | query-tools db decoupling         | 1 - query-tools split    | ⬜     |
| 9   | agent-link-hooks.ts               | 1 - subagent-hooks split | ⬜     |
| 10  | persistence bootstrap             | 2 - decouple             | ⬜     |
| 11  | executor persistence              | 2 - decouple             | ⬜     |
| 12  | executor launchd deps             | 2 - decouple             | ⬜     |
| 13  | Dove prompt group reminder        | 2 - decouple             | ⬜     |
| 14  | launchd-feature.ts extract        | 2 - route isolation      | ⬜     |
| 15  | groups conditional in route       | 2 - route isolation      | ⬜     |
| 16  | InProcessScheduler (tests + impl) | 3 - scheduler            | ⬜     |
| 17  | wire scheduler into start-all     | 3 - scheduler            | ⬜     |
| 18  | build.ts Linux skip               | 3 - scheduler            | ⬜     |
| 19  | chat-pane historyPanel prop       | 4 - UI                   | ⬜     |
| 20  | settings nav data-driven          | 4 - UI                   | ⬜     |
| 21  | page.tsx agent-links cleanup      | 4 - UI                   | ⬜     |
