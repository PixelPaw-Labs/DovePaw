# Spec 02 · Security & Permission Guardrails

How DovePaw decides whether a tool call may proceed, and how it asks the user when a decision is genuinely required.

> **Two layers, never one.** SDK `disallowedTools` is exact-name matching only. The PreToolUse hook re-evaluates the same list as a regex for prefixed/grouped patterns. Either layer alone is insufficient.

## 1. Security modes

Three modes, set globally via Dove settings (`effectiveDoveSettings(globalSettings).securityMode`). The exact shape and behaviour lives in [`lib/security-policy.ts`](../../lib/security-policy.ts) and [`packages/agent-sdk/src/security-policy.ts`](../../packages/agent-sdk/src/security-policy.ts).

| Mode         | `permissionMode`    | `allowDangerouslySkipPermissions` | `readOnly` | `settingSources`       | `disallowedTools`                          |
| ------------ | ------------------- | --------------------------------- | ---------- | ---------------------- | ------------------------------------------ |
| `read-only`  | `default`           | false                             | true       | project + local        | `READ_ONLY_DISALLOWED_TOOLS` (~30 entries) |
| `supervised` | `acceptEdits`       | false                             | false      | project + user + local | `[]`                                       |
| `autonomous` | `bypassPermissions` | true                              | false      | project + user + local | `[]`                                       |

```mermaid
stateDiagram-v2
  [*] --> ReadOnly
  ReadOnly --> Supervised: user picks supervised
  Supervised --> Autonomous: user picks autonomous
  Autonomous --> Supervised
  Supervised --> ReadOnly
  ReadOnly: read-only<br/>permissionMode: default<br/>disallowedTools: 30+ entries<br/>readOnly: true
  Supervised: supervised<br/>permissionMode: acceptEdits<br/>canUseTool fires for risky tools<br/>readOnly: false
  Autonomous: autonomous<br/>permissionMode: bypassPermissions<br/>allowDangerouslySkipPermissions: true
```

`buildSecurityEnv()` exports the mode into the child process as `DOVEPAW_SECURITY_MODE` (and optionally `DOVEPAW_ALLOW_WEB_TOOLS=1`). `AgentRunner` reads these to compute the right `ClaudeRunner` / `CodexRunner` options ([`packages/agent-sdk/src/agent-runner.ts`](../../packages/agent-sdk/src/agent-runner.ts)).

## 2. Two-layer enforcement

```mermaid
flowchart TD
  attempt["Tool call attempt"]
  attempt --> sdk{"SDK disallowedTools exact match?"}
  sdk -- yes --> reject1["SDK rejects before hook fires"]
  sdk -- no --> hook{"PreToolUse regex matcher matches?<br/>e.g. mcp__claude_ai_Gmail_.*"}
  hook -- yes --> deny["permissionDecision: deny"]
  hook -- no --> path{"Edit or Write outside allowed dirs?"}
  path -- yes --> deny
  path -- no --> bash{"Bash write op in read-only mode?"}
  bash -- yes --> deny
  bash -- no --> mode{"permissionMode"}
  mode -- bypassPermissions --> allow["run"]
  mode -- acceptEdits --> ask["canUseTool — Edit/Write auto-accept,<br/>others prompt user"]
  mode -- default --> ask
  ask -- approve --> allow
  ask -- deny --> rejected["deny"]
```

`ALWAYS_DISALLOWED_TOOLS` is a regex-only list — patterns like `mcp__claude_ai_Gmail_.*` cover every variant of a service (plain / Workato / Testing Admin Only). SDK exact-matching would miss every one of them; only the hook gate catches them.

## 3. Edit/Write path allowlist

```mermaid
sequenceDiagram
  participant LLM as Agent
  participant Hook as PreToolUse Edit|Write
  participant FS as filesystem

  LLM->>Hook: Edit { file_path: "/etc/passwd" }
  Hook->>FS: realpath(file_path) — fall back to path.resolve if missing
  Hook->>Hook: any allowed dir startsWith resolved? (with sep)
  Hook-->>LLM: permissionDecision: deny<br/>"outside the allowed directories: …"
  LLM->>Hook: Edit { file_path: "<cwd>/foo.ts" }
  Hook->>FS: realpath
  Hook-->>LLM: permissionDecision: allow
```

Allowed dirs:

- **Dove**: `AGENTS_ROOT` + `getLaunchdAdditionalDirs()` + `DOVEPAW_TMP_DIR` + `DOVEPAW_DIR`
- **Sub-agent**: `cwd` (workspace) + scheduler dirs + `agentPersistentLogDir/StateDir/ConfigDir` + `agentSourceDir`

The hook resolves both stored and requested paths with `realpath` — handles macOS case-insensitivity and symlinks. New writes (file doesn't exist yet) fall back to `path.resolve`.

## 4. Read-only mode disallow list

```mermaid
flowchart LR
  RD[READ_ONLY_DISALLOWED_TOOLS]
  RD --> wt[Write / Edit / NotebookEdit / TodoWrite]
  RD --> bw[Bash rm/mv/cp/mkdir/rmdir/touch/tee/dd/truncate/chmod/chown/ln/install]
  RD --> int[Bash python / python3 / node / nodejs / ruby / perl / php]
  RD --> tm[Agent / TaskCreate / TaskStop / TaskUpdate / TeamCreate / TeamDelete / SendMessage]
  RD --> cr[CronCreate / CronDelete]
  RD --> wkt[EnterWorktree]
```

`bashHasWriteOperation()` is the inline check for Bash payloads that survive the prefix filter — regex `>\s*\S|sed\s+[^|&;]*-i` after stripping quoted strings. Defends against `echo x > /tmp/y` and `sed -i ...`.

## 5. Browser permission round-trip (Dove)

```mermaid
sequenceDiagram
  participant SDK as Claude Agent SDK
  participant Hook as buildDoveCanUseTool
  participant Map as pending-permissions Map (globalThis)
  participant SSE as SSE stream
  participant UI as Browser

  SDK->>Hook: canUseTool(toolName, input, { signal, title })
  Hook->>Map: addPendingPermission(requestId) → Promise
  Hook->>SSE: { type: "permission", requestId, toolName, toolInput }
  SSE-->>UI: render permission dialog
  UI->>UI: user clicks Allow / Deny
  UI->>SDK: POST /api/chat/permission { requestId, allowed }
  Note over SDK,Map: route handler calls resolvePendingPermission(requestId, allowed)
  Map-->>Hook: Promise resolves to bool
  alt user response wins
    Hook-->>SDK: { behavior: "allow", updatedInput }
  else SDK aborts first
    Hook->>Map: abortPendingPermissions({requestId})
    Hook-->>SDK: { behavior: "deny", message: "User denied permission" }
  end
```

Key correctness properties:

- The `Map<requestId, resolver>` lives on `globalThis.__dovePendingPermissions` so Next.js HMR doesn't lose it mid-prompt (see [`chatbot/lib/pending-permissions.ts`](../../chatbot/lib/pending-permissions.ts)).
- `abortPendingPermissions` takes a **set scoped to the current query**, not all entries — cancelling one tab can't deny prompts open in another.
- `AskUserQuestion` reuses the same plumbing via `pending-questions.ts` — same race against `signal.abort`.

## 6. Sub-agent permission round-trip (cross-process)

The sub-agent runs in an A2A process. It can't reach the in-process Map. It POSTs to the Next.js process instead, which then runs the same Dove-side round-trip.

```mermaid
sequenceDiagram
  participant Sub as Sub-agent SDK (A2A process)
  participant SubHook as buildSubagentCanUseTool
  participant Next as POST /api/internal/subagent-permission
  participant UI as Browser SSE

  Sub->>SubHook: canUseTool(...)
  SubHook->>Next: POST { contextId, requestId, toolName, toolInput }
  Next->>UI: relay permission event to session SSE
  UI->>Next: POST /api/chat/permission { requestId, allowed }
  Next-->>SubHook: HTTP 200 = allow, anything else = deny
  SubHook-->>Sub: behavior allow / deny
```

Only enabled when `userMessage.metadata.directUserChat === true`. Worker-mode sub-agents (called by Dove) don't get `canUseTool` at all — they run under `permissionMode: "acceptEdits"` and rely on the hook gates above for safety.

## 7. Notes on `canUseTool` reliability

`canUseTool` is **not** invoked for every tool call — the SDK skips it when `permissionMode` permits the action. This means `canUseTool` cannot be relied on as a security gate. **PreToolUse hooks are the only reliable gate.** All deny decisions for security live in `buildAgentHooks`, never in `canUseTool`.

## 8. Always-disallowed tools (every mode, every agent)

`ALWAYS_DISALLOWED_TOOLS` is layered on top of the mode-specific list at every call site:

```text
mcp__claude_ai_Assets_.*
mcp__claude_ai_Gmail_.*
mcp__claude_ai_Google_(Calendar|Drive|Sheets)_.*
mcp__claude_ai_(HubSpot|Jira|Confluence|Slack|Slack_Workato|Envato_Creative_Companion)_.*
```

These are claude.ai-side remote MCP integrations that DovePaw chose not to expose. They are blocked unconditionally by the hook regex matcher.

## Related

- [Spec 01 — Hook injection](01-hook-injection.md) (the disallow + path hooks are part of `buildAgentHooks`)
- [Spec 05 — A2A spawn](05-a2a-spawn.md) (mode env vars flow to AgentRunner)
- [Spec 03 — Orchestrator](03-orchestrator-behaviour.md) (`directUserChat` metadata path)
