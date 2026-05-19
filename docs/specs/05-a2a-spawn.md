# Spec 05 · A2A Spawn → Child Process Flow

The path from "Dove decides to run agent X" all the way down to "the OS started a `tsx main.ts` child." Three indirections — A2A protocol, `QueryAgentExecutor`, `spawn.ts` — each justified by a separate ADR.

> Anchor ADRs: [0006](../adr/0006-orchestrate-agents-via-a2a-server-not-direct-script-spawn.md) (use A2A, not direct spawn) and [0007](../adr/0007-agent-logic-runs-as-child-process-not-inline-in-a2a-server.md) (always a child process, never inline).

## 1. The full layer cake

```mermaid
flowchart TD
  D[Dove route.ts query] --> MCP[start_<key> MCP tool]
  MCP --> TP[TaskPoller.start]
  TP --> CL[a2a-js client.startAgentStream]
  CL -- HTTP POST + SSE --> EXP[A2A Express server]
  EXP --> EXEC[QueryAgentExecutor.execute]
  EXEC --> Inner[inner MCP: start_script_<self> / await_script_<self> / mgmt / linkedTools]
  EXEC --> Q[Inner query — sub-agent SDK]
  Q --> SS[start_script_<self>]
  SS --> SPAWN[spawn.ts startScript]
  SPAWN --> PROC[tsx main.ts child process]
  PROC --> RUN[AgentRunner — Claude CLI or Codex CLI]

  PROC -.HTTP POST /internal/tasks/:taskId/progress.-> EXP
  EXEC -.relaySessionEvent.-> Next[/POST /api/internal/session-event/]
```

Every transition is justified:

| Boundary            | Required for                                                                            |
| ------------------- | --------------------------------------------------------------------------------------- |
| Dove → A2A          | Per-agent process isolation, A2A lifecycle, scheduler entry-point uniformity (ADR-0006) |
| A2A → child process | Crash isolation, env sanitation, plugin trust boundary, language agnosticism (ADR-0007) |

## 2. Dynamic port discovery

A2A ports are OS-assigned and written to a manifest:

```mermaid
sequenceDiagram
  participant E as Electron / npm run chatbot:servers
  participant A2As as Each A2A server
  participant FS as ~/.dovepaw/.ports.<dovePort>.json
  participant Dove as Dove MCP tools

  E->>A2As: getAvailablePort() per agent
  A2As->>A2As: bind 127.0.0.1:0, OS assigns port
  A2As->>A2As: app.listen(port, 127.0.0.1) — loopback only
  A2As-->>E: { agentName, port }
  E->>FS: writePortsManifest({ manifestKey: port, ... })
  Dove->>FS: resolveAgentPort(manifestKey) → readPortsManifest
  FS-->>Dove: port (or null if servers down)
  alt port null
    Dove-->>Dove: noServersMessage()
  end
```

A `null` port produces a user-facing reminder to run `npm run chatbot:servers` — never throws.

## 3. The A2A server (per agent)

```mermaid
classDiagram
  class createServerFromDef {
    +(def, port)
    builds AgentCard, sessionManager, publisherRegistry, executor
    calls createAgentServer
  }
  class createAgentServer {
    +(agentCard, executor, port, sessionManager?, publisherRegistry?)
    Express app + a2a-js handlers
    Routes:
    /a2a/jsonrpc, /a2a/rest, /sessions,
    /session/clear, /internal/tasks/:taskId/progress
  }
  class UnboundedEventBusManager {
    raises EventTarget listener cap to Infinity
    needed when many SSE clients subscribe per bus
  }
  createServerFromDef ..> createAgentServer
  createAgentServer ..> UnboundedEventBusManager
```

The `/internal/tasks/:taskId/progress` endpoint is how child processes push progress upward — they post `{ message, artifacts }` and the server publishes a status update on the matching A2A event bus.

## 4. QueryAgentExecutor — the heart

```mermaid
sequenceDiagram
  participant REQ as A2A RequestContext (taskId, contextId, userMessage)
  participant E as QueryAgentExecutor
  participant Pub as ExecutorPublisher
  participant SM as SessionManager
  participant Reader as AgentConfigReader
  participant WS as createAgentWorkspace
  participant CB as buildAgentConfig
  participant Inner as withMcpQuery (inner tools)
  participant Q as query() sub-agent
  participant FS as filesystem + repo clones

  REQ->>E: execute(reqCtx, eventBus)
  E->>Pub: new ExecutorPublisher(eventBus, taskId, contextId)
  E->>Pub: publishTask() (registers in ResultManager)
  E->>SM: restore(contextId) → existingState?
  E->>Reader: resolveAgentSettings (extraEnv, repoSlugs)
  alt existingState (resume)
    E->>WS: reuse existingState.workspace
  else fresh
    E->>WS: createAgentWorkspace(name, alias, taskId)
    WS->>FS: mkdir + .claude/settings.json (ScheduleWakeup→sleep) + seed dovepaw-browser skill
  end
  E->>CB: buildAgentConfig(def, cwd, env+securityEnv+DOVEPAW_A2A_PORT, repoSlugs)
  E->>Reader: resolveLinkedTools (empty in group OR worker mode)
  E->>Inner: withMcpQuery({ start_script_<self>, await_script_<self>, mgmt, linkedTools })
  Inner->>Q: query({ cwd, env, systemPrompt, hooks: buildSubAgentHooks, ... })
  Q-->>E: stream events → A2AQueryDispatcher
  Q->>E: end_turn → finalise (relaySessionEvent done, save session, mark task completed)
```

`existingState` decides resume vs fresh — `subagentSessionId` is passed to `query({ resume })` and the workspace dir is reused.

`buildSubAgentPrompt()` produces the inner system prompt — embeds persona, agent's file boundaries, and the per-agent management tool table (install/uninstall/load/unload/status/logs).

## 4.1 Full chain — A2A request → agent script's first line

The §4 and §5 diagrams cover the executor and the spawn separately. This one stitches them with every filesystem side effect called out in order, so a reader can answer "what exactly was written to disk between Dove's `start_<key>` and `tsx main.ts` starting?" without cross-referencing.

```mermaid
sequenceDiagram
  participant Dove
  participant A2A as A2A server
  participant E as QueryAgentExecutor
  participant WS as createAgentWorkspace
  participant Prov as MemoryProvider
  participant SDK as Sub-agent query()
  participant SS as start_script_self tool
  participant Clone as recloneReposIntoWorkspace
  participant FS as filesystem
  participant Proc as child tsx main.ts

  Dove->>A2A: start_key — sendMessageStream with senderAgentId, extraMetadata
  A2A->>E: execute(reqCtx, eventBus)
  E->>WS: createAgentWorkspace(name, alias, taskId)
  WS->>FS: mkdir workspaces/.agent/alias-id8/
  WS->>FS: write workspace/.claude/settings.json — ScheduleWakeup → sleep + deny (NO Karpathy here)
  WS->>FS: cp dovepaw-browser skill into workspace/.claude/skills/

  alt group mode (extraMetadata.isGroupChat)
    E->>Prov: provider.init(groupContextId, groupMomentsPath)
    Prov->>FS: OpenViking: HTTP mkdir viking://agent/id/memories<br/>OR Markdown: mkdir groupMomentsPath/moments/
    Note over E,FS: roster.md + members/ dir written by makeStartGroupTool BEFORE this point
  end

  E->>E: buildAgentConfig (extraEnv = security + DOVEPAW_A2A_PORT + AGENT_WORKSPACE + REPO_LIST)
  E->>E: resolveLinkedTools (empty in group OR worker mode)
  E->>SDK: query({ cwd=workspace, env, hooks: buildSubAgentHooks, systemPrompt: buildSubAgentPrompt })

  SDK->>SS: start_script_self(instruction)
  SS->>Prov: buildReadReminder(workspacePath OR groupMomentsPath, contextId)
  alt OpenViking active
    Prov->>FS: write workspacePath/memory.sh (mode 0755) — curl wrapper around HTTP API
    Prov-->>SS: reminder = "bash workspacePath/memory.sh read topic"
  else Markdown active
    Prov-->>SS: reminder = "read workspacePath/moments/"
  end

  SS->>Clone: recloneReposIntoWorkspace(workspace, repoSlugs)
  loop per repo
    Clone->>FS: rm -rf workspace/repo (idempotent)
    Clone->>FS: gh repo clone slug workspace/repo
    Clone->>FS: write workspace/repo/.claude/settings.local.json<br/>permissions + UserPromptSubmit Karpathy (base64-inlined) + PermissionRequest auto-allow
    Clone->>FS: cp dovepaw-browser skill into workspace/repo/.claude/skills/
  end

  SS->>SS: extraEnv += DOVEPAW_TASK_ID, REPO_LIST=cloned paths, DOVE_MEMORY_REMINDER=reminder text
  SS->>Proc: spawn(tsx, [scriptPath, instruction], { cwd: workspace, env, detached:true })
  Note over Proc: AgentRunner reads DOVE_MEMORY_REMINDER and appends to system prompt of any nested Claude CLI invocation
```

The disk-write order, top to bottom, on a fresh group-mode invocation with OpenViking active and one repo to clone:

1. `workspace/` (mkdir)
2. `workspace/.claude/settings.json` (ScheduleWakeup hook only)
3. `workspace/.claude/skills/dovepaw-browser/` (skill seed)
4. OpenViking namespace `viking://agent/<contextId>/memories` (HTTP, not disk)
5. `workspace/memory.sh` (OpenViking provider only)
6. `workspace/<repo>/` (gh clone)
7. `workspace/<repo>/.claude/settings.local.json` (Karpathy + permissions + PermissionRequest)
8. `workspace/<repo>/.claude/skills/dovepaw-browser/` (skill seed)

The group-only artifacts (`groupMomentsPath/members/roster.md`, `groupMomentsPath/moments/`) live in a _separate_ directory — the group moments workspace — written by `makeStartGroupTool` before any member's `QueryAgentExecutor.execute()` runs. See [Spec 07 §4](07-group-vs-single.md).

## 5. `start_script_<self>` → spawn.ts

```mermaid
sequenceDiagram
  participant SDK as Sub-agent SDK
  participant SS as makeStartScriptTool
  participant Mem as getMemoryProvider
  participant Re as recloneReposIntoWorkspace
  participant SP as spawn.ts startScript
  participant Run as runningScripts Map
  participant Proc as child process (tsx main.ts)
  participant Reg as PendingRegistry
  participant SM as AgentTaskStateMachine

  SDK->>SS: start_script_<self>(instruction?)
  SS->>Mem: buildReadReminder + rosterReadReminder (group)
  SS->>Re: clone repoSlugs into workspace (idempotent — rm then clone)
  Re-->>SS: clonedPaths
  SS->>SS: extraEnv += { DOVEPAW_TASK_ID, REPO_LIST, DOVE_MEMORY_REMINDER }
  SS->>SP: startScript(finalConfig, instruction, signal, taskId as runId)
  SP->>Proc: spawn(tsx, [scriptPath, instruction], { cwd, env, stdio, detached:true })
  SP->>Run: runningScripts.set(runId, { phase:"running", promise, startTime })
  Note over Proc: process exits → resolve promise with stdout
  SP-->>SS: { runId }
  SS->>Reg: register({ awaitTool: await_script_<self>, idKey:"runId", id:runId })
  SS->>SM: transition(runId, manifestKey, "running")
  SS-->>SDK: { runId }
```

Worth highlighting:

- **`detached: true`** — the child gets its own process group so `process.kill(-pid, "SIGTERM")` cleans up Claude CLI subprocesses spawned by the script.
- **`OPENVIKING_CLI_CONFIG_FILE` env** — set only when the sidecar's port file exists; falls through to the user's global `~/.openviking/ovcli.conf` otherwise.
- **`runId = taskId`** — the script's runId is identical to the A2A taskId, so workspace dir `<alias>-<first8 of taskId>` and the runId share a traceable suffix.

## 6. `await_script_<self>` lifecycle

```mermaid
stateDiagram-v2
  [*] --> running: startScript created entry
  running --> done: process exit (output cached)
  running --> still_running: SCRIPT_POLL_TIMEOUT_MS elapsed
  still_running --> running: caller pollss again
  done --> drained: awaitScript returned cached output → delete entry
  drained --> [*]

  state running {
    [*] --> awaiting_promise
    awaiting_promise --> race: Promise.race(promise, timeout)
    race --> done: promise resolved first
    race --> still_running: timeout fired
  }
```

The cache (`phase:"done"`) is critical — `awaitScript` was failing with `not_found` when a script completed between polls. The two-phase state cleans up only after the caller actually read the output.

## 7. Env sanitation in the child

The child receives an explicitly-constructed env, never `process.env` mutation:

```text
{ ...process.env,                           // base
  ...openvikingEnv,                         // ovcli redirect (if sidecar up)
  ...config.extraEnv,                       // includes:
    // AGENT_WORKSPACE (cwd)
    // REPO_LIST (comma-joined clone paths)
    // DOVEPAW_TASK_ID (A2A taskId)
    // DOVEPAW_A2A_PORT
    // DOVEPAW_SECURITY_MODE / DOVEPAW_DISALLOWED_TOOLS / DOVEPAW_ALLOW_WEB_TOOLS
    // DOVE_MEMORY_REMINDER (textual reminder for AgentRunner to append to system prompt)
    // user-configured envVars
}
```

The child must not see `CLAUDECODE=1` — that would suppress nested Claude CLI invocations. The sub-agent's `query()` already sets `DOVEPAW_SUBAGENT=1` so the Karpathy shell hook skips its own injection inside agent processes.

## 8. AgentRunner — Claude vs Codex routing

```mermaid
flowchart TD
  prompt[run prompt + opts] --> model[Resolve effective model]
  model --> br{isCodex?}
  br -- yes --> codex[CodexRunner.run with sandbox + approval policy from env]
  br -- no --> claude[ClaudeRunner.run with --resume / repos / hooks / disallowedTools]
  codex --> stdout1[code + stdout]
  claude --> stdout2[code + stdout]
```

`isCodexModel`: model is `"codex"` or starts with `"gpt"`. Everything else (including blank) is Claude.

`resolveClaudeSecurityOpts()` reads `DOVEPAW_SECURITY_MODE` from env and:

- picks `permissionMode` from the strategy
- concatenates `disallowedTools` (mode + web tools)
- installs a `Bash` PreToolUse hook in read-only mode (same `bashHasWriteOperation` check)

Critical Codex notes:

- `env` field on `CodexOptions` _replaces_ `process.env` — always spread `...process.env` explicitly
- `approvalPolicy` maps to `"on-request"` for read-only/supervised, `"never"` for autonomous
- `webSearchEnabled` honours `DOVEPAW_ALLOW_WEB_TOOLS=1`

## 9. Workspace lifecycle

```mermaid
stateDiagram-v2
  [*] --> CreateOrRestore
  CreateOrRestore --> Working: cwd ready, .claude/settings.json written
  Working --> Cloned: recloneReposIntoWorkspace per start_script_*
  Cloned --> Working
  Working --> Saved: SessionManager.set(contextId, state)
  Saved --> Working: subsequent turns reuse workspace
  Saved --> Cleanup: SessionManager.delete(contextId) OR evictOldest (>20)
  Cleanup --> [*]: rm -rf workspace dir
```

`MAX_SESSIONS = 20` — when the in-memory session map exceeds that, the oldest entry's workspace is removed. Evict is opportunistic — never blocks the new session.

`STOP` (user-pause) does **not** delete the workspace — only the trash-icon delete cascades to `SessionManager.delete()`.

## 10. Workspace hooks — two distinct surfaces

The per-task workspace dir and the repo clones inside it get **different** `.claude/` configs. Confusing the two is a common reading error, so this section keeps them strictly separated.

```mermaid
flowchart TB
  ws["Per-task workspace dir<br/>~/.dovepaw/workspaces/.&lt;agent&gt;/&lt;alias&gt;-&lt;id8&gt;/<br/>(created by createAgentWorkspace → writeWorkspaceSettings)"]
  ws --> wssettings[".claude/settings.json<br/>outputStyle: Sub-agent<br/>PreToolUse ScheduleWakeup → python sleep + deny<br/>NO Karpathy hook here"]
  ws --> clone1["repo clone 1/<br/>(written by recloneReposIntoWorkspace → writeWorkspacePermissions)"]
  ws --> clone2["repo clone 2/<br/>(same)"]
  clone1 --> c1settings[".claude/settings.local.json<br/>permissions.allow: Write/**, Edit/**, Bash(*)<br/>UserPromptSubmit → base64-inlined Karpathy script<br/>PermissionRequest Edit|Write → auto-allow"]
  clone2 --> c2settings[".claude/settings.local.json<br/>same as clone 1"]
```

### Workspace dir — `<workspace>/.claude/settings.json`

Written once at workspace creation by `writeWorkspaceSettings(workspacePath)`:

```text
{
  "outputStyle": "Sub-agent",
  "hooks": {
    "PreToolUse": [
      { "matcher": "ScheduleWakeup",
        "hooks": [{ "type":"command",
          "command": "python3 -c \"... time.sleep(delaySeconds) ...\"
                     && printf '{\"hookSpecificOutput\":{\"permissionDecision\":\"deny\", ...}}'" }]
      }
    ]
  }
}
```

This is the **only** hook the workspace itself owns. The Karpathy `UserPromptSubmit` hook is **not** present at this layer.

### Repo clone — `<workspace>/<repo-name>/.claude/settings.local.json`

Written by `writeWorkspacePermissions(clonePath)` after each `gh repo clone`:

- `permissions.allow`: `Write(/**)`, `Edit(/**)`, `Bash(*)`
- `UserPromptSubmit` → Karpathy script inlined as `echo <base64> | base64 -d | bash` (path-independent, survives the clone being copied anywhere)
- `PermissionRequest` matching `Edit|Write` → auto-allow (the only way to bypass Claude Code's hardcoded `.claude/` self-edit block — see [upstream issue 37765](https://github.com/anthropics/claude-code/issues/37765))

These settings exist so nested Claude CLI invocations the agent script makes inside its clones can write freely without per-call permission prompts, _and_ still get the Karpathy reminder at every user turn inside that nested session.

### Sub-agent's own `query()` call — neither

The outer sub-agent SDK call inside `QueryAgentExecutor` reads neither of the above. Its hooks come from `buildSubAgentHooks` directly (see [Spec 01](01-hook-injection.md)). `DOVEPAW_SUBAGENT=1` is set in the spawn env, which short-circuits the Karpathy shell script even if it ran.

## 11. Cancellation

```mermaid
sequenceDiagram
  participant U as User STOP / DELETE / SIGTERM
  participant SR as sessionRunner
  participant AC as AbortController
  participant SDK as Claude Agent SDK
  participant SP as spawn.ts
  participant Proc as child process group

  U->>SR: PATCH /api/chat stop or DELETE /api/chat
  SR->>AC: subprocessController.abort
  AC->>SDK: query unwinds
  SDK->>SP: PendingRegistry resolves remaining, signal aborts spawned procs
  SP->>Proc: process.kill -pid SIGTERM
  Proc-->>SP: exit
  AC->>SDK: any open canUseTool promises resolve via abort race
  Note over SDK: PostToolUse / Stop hooks no longer relevant
```

`subprocessController` is separate from the SSE `connectionController` — a browser disconnect does **not** kill the child process. Only explicit STOP/DELETE or process exit does.

## Related

- [Spec 00 — Topology](00-topology-overview.md)
- [Spec 01 — Hook injection](01-hook-injection.md) (workspace's ScheduleWakeup hook and PostToolUse Stop blocker)
- [Spec 02 — Security guardrails](02-security-guardrails.md) (env-driven security mode in AgentRunner)
- [Spec 03 — Orchestrator behaviour](03-orchestrator-behaviour.md) (the layer above)
- [Spec 06 — Memory management](06-memory-management.md) (`DOVE_MEMORY_REMINDER` injection)
- ADRs [0006](../adr/0006-orchestrate-agents-via-a2a-server-not-direct-script-spawn.md), [0007](../adr/0007-agent-logic-runs-as-child-process-not-inline-in-a2a-server.md)
