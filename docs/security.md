# Security

Dove operates in one of three modes, configured in Settings → Dove. The mode controls what tools Dove and its sub-agents can use, and whether the user is asked to approve actions before they happen.

## Dove modes

| Mode                       | SDK permission mode | Effect                                                                                                                                                                       |
| -------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **read-only**              | `default`           | Blocks all write tools via SDK `disallowedTools` + PreToolUse hooks. Write-capable Bash patterns (redirects, `rm`, `mv`, interpreters) are caught by a secondary regex gate. |
| **supervised** _(default)_ | `acceptEdits`       | File edits are auto-approved; Bash commands and other tool calls prompt the user in the browser before executing.                                                            |
| **autonomous**             | `bypassPermissions` | All tool use is auto-approved. Suitable for fully-trusted local use only.                                                                                                    |

## Permission flow

```mermaid
sequenceDiagram
    actor User as User (Browser)
    participant API as Next.js /api/chat
    participant SDK as Claude Agent SDK
    participant Gate1 as disallowedTools (gate 1)
    participant Gate2 as PreToolUse hooks (gate 2)
    participant canUse as canUseTool callback
    participant Script as Agent Script (main.ts)

    User->>API: POST /api/chat { message }
    note over API: resolve security mode
    API->>SDK: query({ permissionMode, disallowedTools, hooks, canUseTool })

    note over API,canUse: Hard security rules (.claude/rules/security.md)<br/>Never print/echo/log secret values — use variable names only<br/>Never dump process.env — writes secrets to JSONL history permanently<br/>Never hardcode secrets — load from env or secure store<br/>Never log headers, env dumps, or config objects<br/>Never put secrets in URLs — use headers or request body

    loop each tool call
        SDK->>Gate1: check disallowedTools
        alt blocked
            Gate1-->>SDK: deny
        else passes
            Gate1-->>SDK: allow
            SDK->>Gate2: PreToolUse hook

            alt blocked tool / Bash write (read-only)
                Gate2-->>SDK: deny
            else path outside allowedDirectories
                Gate2-->>SDK: deny
            else passes
                Gate2-->>SDK: allow

                alt autonomous mode
                    note over SDK: bypassPermissions — execute directly
                else supervised mode
                    SDK->>canUse: can_use_tool?
                    canUse-->>User: SSE { type, requestId, toolName }
                    User->>API: POST /api/chat/permission { requestId, allowed }
                    alt allowed
                        canUse-->>SDK: allow
                    else denied
                        canUse-->>SDK: deny
                    end
                end

                SDK->>SDK: execute tool
            end
        end
    end

    note over SDK,Script: when Dove calls ask_* / start_* (agent invocation)
    SDK->>Script: spawn(tsx, [scriptPath, instruction],<br/>{ env DOVEPAW_SECURITY_MODE, DOVEPAW_DISALLOWED_TOOLS, AGENT_WORKSPACE, REPO_LIST,<br/>  cwd isolated workspace, secrets from OS Keychain })
    note over Script: resolveClaudeSecurityOpts() reads DOVEPAW_SECURITY_MODE<br/>enforces permissionMode + disallowedTools on inner query()
    Script-->>SDK: output via A2A SSE

    SDK-->>User: SSE stream (text · done · error)
```

## PreToolUse hooks (enforcement layer)

PreToolUse hooks run inside the SDK's tool-dispatch loop and act as a second gate independent of the SDK's own permission model.

**Read-only enforcement.** When Dove mode is `read-only`, the hooks block every tool on the `disallowedTools` list (e.g. `Write`, `Edit`, `TodoWrite`, `CronCreate`) and inspect every `Bash` call for write patterns (output redirects `>`, `sed -i`, destructive commands). A tool that reaches the hook and matches is denied with an explanatory reason — it cannot be bypassed by the agent.

**Directory restriction.** Both Dove and each agent sub-process are given an `allowedDirectories` list (Dove: the project `cwd` plus any additional directories it needs; sub-agents: the workspace path plus the agent source and persistent state directories). Any `Edit`, `Write`, `NotebookEdit`, or `Bash` write call targeting a path outside that list is denied by a PreToolUse hook before the file is touched:

```
"<resolved_path>" is outside the allowed directories: ~/.dovepaw/workspaces/<agent>-<taskId>/...
You should stop and reconsider if you really need to access this path.
```

The agent is instructed to ask the user for explicit permission before retrying.

**ScheduleWakeup guard.** A hook blocks `ScheduleWakeup` while any `await_*` tool call is pending, preventing agents from scheduling a wake-up to defer polling.

## Interactive permissions (`canUseTool`)

In `supervised` mode, Dove uses a `canUseTool` callback instead of auto-approving everything. When a tool call needs approval, the server sends a `permission` SSE event to the browser:

```json
{
  "type": "permission",
  "requestId": "...",
  "toolName": "Bash",
  "toolInput": { "command": "..." },
  "title": "..."
}
```

The user approves or denies via `POST /api/chat/permission`:

```json
{ "requestId": "...", "allowed": true }
```

Until the user responds, the agent is paused. If the browser disconnects, pending permissions are aborted and the agent stops waiting.

## Sub-agent isolation

Agents launched by Dove run as SDK sub-agents with a permission mode inherited from Dove's security mode: `read-only` propagates fully (blocking all writes); `supervised` and `autonomous` both map to `acceptEdits` (no interactive approval UI for sub-agents). Each sub-agent runs with:

- An isolated workspace directory under `~/.dovepaw/workspaces/<alias>-<taskId>/` (see Spec [05-a2a-spawn](specs/05-a2a-spawn.md))
- A sanitised environment — clean PATH, `CLAUDECODE` unset, secrets resolved from OS Keychain at spawn time and injected as env vars only for the child process
- `allowedDirectories` restricted to the workspace, the agent's source directory, and its persistent state directory

→ Engineering reference: [docs/specs/02-security-guardrails.md](specs/02-security-guardrails.md).
