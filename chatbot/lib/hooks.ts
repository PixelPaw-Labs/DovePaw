/**
 * Shared query() hook configuration.
 *
 * buildAgentHooks — generic factory, usable by any query() caller
 * buildDoveHooks  — convenience wrapper for Dove's top-level query (route.ts)
 *
 * Sub-agent hooks live in subagent-hooks.ts.
 */

import { randomUUID } from "crypto";
import path from "path";
import type {
  UserPromptSubmitHookSpecificOutput,
  PreToolUseHookSpecificOutput,
  HookCallbackMatcher,
  HookEvent,
  CanUseTool,
} from "@anthropic-ai/claude-agent-sdk";
import type { AgentDef } from "@@/lib/agents";
import { bashHasWriteOperation } from "@@/lib/dove-mode-strategy";
import { doveAwaitToolName } from "@/lib/query-tools";
import { PendingRegistry, type PendingEntry } from "@/lib/pending-registry";
//import { StillRunningRetryCounter } from "@/lib/still-running-retry-counter";
import type { ChatSseEvent } from "@/lib/chat-sse";
import { addPendingPermission, abortPendingPermissions } from "@/lib/pending-permissions";
import { addPendingQuestion, abortPendingQuestions } from "@/lib/pending-questions";
import type { Question } from "@/lib/chat-sse";

// ─── MCP tool response parsing ───────────────────────────────────────────────

/**
 * Extracts the structured content from a PostToolUse `tool_response`.
 *
 * The SDK serialises MCP tool `structuredContent` as a JSON string when passing
 * it to hook callbacks. This function handles all observed shapes:
 *   - JSON string   → parsed directly (in-process MCP via createSdkMcpServer)
 *   - { structuredContent } object → unwrapped (external MCP over SSE)
 *   - plain object  → returned as-is (fallback)
 */
export function getMcpStructured(tool_response: unknown): unknown {
  if (typeof tool_response === "string") {
    try {
      return JSON.parse(tool_response) as unknown;
    } catch {
      return undefined;
    }
  }
  if (typeof tool_response === "object" && tool_response !== null) {
    return "structuredContent" in tool_response
      ? (tool_response as { structuredContent: unknown }).structuredContent
      : tool_response;
  }
  return undefined;
}

// ─── Generic hook builder ─────────────────────────────────────────────────────

export interface AgentHooksConfig {
  /** Pipe-separated tool name matcher for the PostToolUse still_running hook. */
  postToolUseMatcher: string;
  /** Registry tracking all pending in-flight operations. */
  registry: PendingRegistry;
  /** Appended to every user prompt via UserPromptSubmit hook. */
  userPromptReminder?: string;
  /**
   * Directories (cwd + additionalDirectories) that Edit/Write tools are
   * permitted to modify. Paths outside this set are denied via PreToolUse.
   */
  allowedDirectories?: string[];
  /**
   * Tools to block via PreToolUse hook (2nd-level gate, in addition to SDK disallowedTools).
   * Matcher is built dynamically from this list.
   */
  disallowedTools?: string[];
}

function buildPendingBlockReason(entries: PendingEntry[]): string {
  return [
    `⚠️ You have ${entries.length} pending operation(s) still running:`,
    ...entries.map((e) => `- call \`${e.awaitTool}\` with ${e.idKey}: "${e.id}"`),
    `These operations can run for a long time (minutes to hours) — decide an appropriate sleep interval based on the task type.`,
    `Keep calling await in a loop until the operation completes.`,
    `Never give up or stop polling; you are responsible for retrieving the final result.`,
    `Never recall any previous run from log or memory — always use the await tool with the id from the most recent still_running response.`,
  ].join("\n");
}

/**
 * Builds a pair of hooks (PostToolUse + Stop) from a generic config.
 * Suitable for any query() call that uses a start/await tool pattern.
 */
export function buildAgentHooks(
  config: AgentHooksConfig,
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const { postToolUseMatcher, registry, userPromptReminder, allowedDirectories, disallowedTools } =
    config;
  //const retryCounter = new StillRunningRetryCounter();
  const resolvedAllowed = allowedDirectories?.map((d) => path.resolve(d));

  const preToolUseHooks: HookCallbackMatcher[] = [
    {
      matcher: "ScheduleWakeup",
      hooks: [
        async (input) => {
          if (input.hook_event_name !== "PreToolUse") return { continue: true };
          if (!registry.hasPending()) return { continue: true };
          const pending = registry.getPending();
          const hookSpecificOutput: PreToolUseHookSpecificOutput = {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: [
              `⚠️ ScheduleWakeup cannot be used while await operations are pending — the wakeup will not fire in this session context.`,
              `You still have ${pending.length} pending operation(s):`,
              ...pending.map((e) => `- call \`${e.awaitTool}\` with ${e.idKey}: "${e.id}"`),
              `Keep calling the await tool directly in a loop until the operation completes.`,
              `Never schedule a wakeup to defer polling — poll in-session.`,
            ].join("\n"),
          };
          return { hookSpecificOutput };
        },
      ],
    },
  ];

  // 2nd-level gate: deny tools in the disallowedTools list (SDK disallowedTools is the 1st gate).
  // Filter out Bash(command *) patterns — those are SDK-level; hooks only match on plain tool names.
  const hookBlockedTools = disallowedTools?.filter((t) => !t.includes("(")) ?? [];
  if (hookBlockedTools.length > 0) {
    const matcher = hookBlockedTools.join("|");
    preToolUseHooks.push({
      matcher,
      hooks: [
        async (input) => {
          if (input.hook_event_name !== "PreToolUse") return { continue: true };
          const hookSpecificOutput: PreToolUseHookSpecificOutput = {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: `Tool is not permitted in this mode.`,
          };
          return { hookSpecificOutput };
        },
      ],
    });
  }

  // Block Bash write operations (redirects, rm, mv, etc.) when in a write-restricted mode.
  if (disallowedTools?.includes("Write")) {
    preToolUseHooks.push({
      matcher: "Bash",
      hooks: [
        async (input) => {
          if (input.hook_event_name !== "PreToolUse") return { continue: true };
          if (typeof input.tool_input !== "object" || input.tool_input === null)
            return { continue: true };
          const rawCommand: unknown = Reflect.get(input.tool_input, "command");
          const command = typeof rawCommand === "string" ? rawCommand : "";
          if (!bashHasWriteOperation(command)) return { continue: true };
          const hookSpecificOutput: PreToolUseHookSpecificOutput = {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: "Read-only mode: Bash write operations are not allowed.",
          };
          return { hookSpecificOutput };
        },
      ],
    });
  }

  if (resolvedAllowed && resolvedAllowed.length > 0) {
    preToolUseHooks.push({
      matcher: "Edit|Write",
      hooks: [
        async (input) => {
          if (input.hook_event_name !== "PreToolUse") return { continue: true };
          if (typeof input.tool_input !== "object" || input.tool_input === null)
            return { continue: true };
          const fp: unknown = Reflect.get(input.tool_input, "file_path");
          const filePath = typeof fp === "string" ? fp : undefined;
          if (!filePath) return { continue: true };
          const resolved = path.resolve(filePath);
          const allowed = resolvedAllowed.some(
            (dir) => resolved === dir || resolved.startsWith(dir + path.sep),
          );
          const hookSpecificOutput: PreToolUseHookSpecificOutput = {
            hookEventName: "PreToolUse",
            permissionDecision: allowed ? "allow" : "deny",
            ...(!allowed && {
              permissionDecisionReason: `"${resolved}" is outside the allowed directories: ${resolvedAllowed.join(", ")}.
                    You should stop and reconsider if you really need to access this path.
                    But NEVER proceed without explicit permission or try to bypass it automatically, as allowing access to this path could be dangerous.
                    If you really need to access this path, ask the user for explicit permission.`,
            }),
          };
          return { hookSpecificOutput };
        },
      ],
    });
  }

  return {
    ...(userPromptReminder && {
      UserPromptSubmit: [
        {
          hooks: [
            async (input) => {
              if (input.hook_event_name !== "UserPromptSubmit") return { continue: true };
              const hookSpecificOutput: UserPromptSubmitHookSpecificOutput = {
                hookEventName: "UserPromptSubmit",
                additionalContext: userPromptReminder,
              };
              return { hookSpecificOutput };
            },
          ],
        },
      ],
    }),
    PreToolUse: preToolUseHooks,
    Stop: [
      {
        hooks: [
          async (input) => {
            if (input.hook_event_name !== "Stop") return { continue: true };
            if (!registry.hasPending()) return { continue: true };
            return { decision: "block", reason: buildPendingBlockReason(registry.getPending()) };
          },
        ],
      },
    ],
    PostToolUse: [
      {
        matcher: postToolUseMatcher,
        hooks: [
          async (input) => {
            if (input.hook_event_name !== "PostToolUse") return { continue: true };
            const { tool_response } = input;
            const structured = getMcpStructured(tool_response);
            const status =
              typeof structured === "object" && structured !== null && "status" in structured
                ? (structured as { status: unknown }).status
                : undefined;
            if (status === "still_running") {
              //if (retryCounter.shouldRelease()) {
              //return { continue: true };
              //}
              return { decision: "block", reason: buildPendingBlockReason(registry.getPending()) };
            }
            return { continue: true };
          },
        ],
      },
    ],
  };
}

// ─── Convenience wrappers ─────────────────────────────────────────────────────

const DOVE_LEAN_REMINDER = `<reminder>
- When the user's intent is resolved by RECEIVING INFORMATION about an agent listed in <agents>, ALWAYS call \`mcp__agents__ask_*\`. It returns \`{ taskId }\` immediately. Tell the user what you asked, then WAIT as a **background Task** to collect the response without blocking the conversation.
- When the user's intent is resolved by SOMETHING BEING DONE — for one agent or multiple — ALWAYS call \`mcp__agents__start_*\` first (returns \`{ taskId, manifestKey }\` immediately), tell the user what you've kicked off, then WAIT via \`mcp__agents__await_*\` as a **background Task** concurrently.
NEVER invoke SKILLs unless the user explicitly asks you to. If you think a skill is relevant, AskUserQuestion about it and let them decide whether to use it but the priority is always to use the most specific agent tools available for the task.
</reminder>`;

const DOVE_PROMPT_REMINDER = `<reminder>
- When the user's intent is resolved by RECEIVING INFORMATION about an agent listed in <agents>, ALWAYS call \`mcp__agents__ask_*\`. It returns \`{ taskId }\` immediately. Tell the user what you asked, then WAIT as a **background Task** to collect the response without blocking the conversation.
- When the user's intent is resolved by SOMETHING BEING DONE — for one agent or multiple — ALWAYS call \`mcp__agents__start_*\` first (returns \`{ taskId, manifestKey }\` immediately), tell the user what you've kicked off, then WAIT via \`mcp__agents__await_*\` as a **background Task** concurrently.
- When the user's intent maps to a GROUP'S BUSINESS DOMAIN, ALWAYS call \`mcp__agents__init_group_*\` → \`mcp__agents__start_group_*\` for up to 3 members whose roles best match the task, then MOVE ON — members continue the work in the Group Chat; DO NOT call \`mcp__agents__await_group_*\`.
- When the user's intent is to **CREATE or SCAFFOLD a new DovePaw agent**, ALWAYS invoke the \`/sub-agent-builder\` skill first — never write agent files manually.
NEVER invoke SKILLs unless the user explicitly asks you to. If you think a skill is relevant, AskUserQuestion about it and let them decide whether to use it but the priority is always to use the most specific agent tools available for the task.
</reminder>`;

/** Hooks for Dove's top-level query() in route.ts. */
export function buildDoveHooks(
  agents: AgentDef[],
  registry: PendingRegistry,
  cwd: string,
  additionalDirectories: string[],
  options: { includeGroupReminder?: boolean; disallowedTools?: string[] } = {},
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  return buildAgentHooks({
    postToolUseMatcher: agents.map((a) => `mcp__agents__${doveAwaitToolName(a)}`).join("|"),
    registry,
    userPromptReminder: options.includeGroupReminder ? DOVE_PROMPT_REMINDER : DOVE_LEAN_REMINDER,
    allowedDirectories: [cwd, ...additionalDirectories],
    disallowedTools: options.disallowedTools,
  });
}

/**
 * Builds the canUseTool callback for Dove's query().
 *
 * The SDK sends a `can_use_tool` control request when Claude Code needs
 * permission to use a tool (including sensitive-path operations that
 * `permissionMode: "acceptEdits"` doesn't auto-approve). This callback
 * sends a `permission` SSE event to the browser and awaits the user's
 * decision before returning allow/deny to the SDK.
 *
 * Returns both the callback and an `abort` function that denies all
 * in-flight permission requests for this specific query — scoped so that
 * cancelling one session doesn't affect concurrent sessions in other tabs.
 */
export function buildDoveCanUseTool(send: (event: ChatSseEvent) => void): {
  canUseTool: CanUseTool;
  abortPermissions: () => void;
} {
  const activePermissionIds = new Set<string>();
  const activeQuestionIds = new Set<string>();

  const canUseTool: CanUseTool = async (
    toolName,
    input,
    { title, displayName, blockedPath, signal },
  ) => {
    // ── AskUserQuestion: surface questions to the browser and await answers ──
    if (toolName === "AskUserQuestion") {
      // input is Record<string, unknown> — index directly, no assertion needed.
      const rawQuestions = input["questions"];
      // After Array.isArray, TypeScript narrows to any[] (isArray's own signature).
      // The SDK validates AskUserQuestion's schema before canUseTool fires, so
      // the array really does contain Question objects.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SDK-validated schema
      const questions = (Array.isArray(rawQuestions) ? rawQuestions : []) as Question[];
      const requestId = randomUUID();
      activeQuestionIds.add(requestId);
      send({ type: "question", requestId, questions });
      const abortPromise = new Promise<Record<string, string>>((resolve) => {
        signal.addEventListener("abort", () => resolve({}), { once: true });
      });
      const answers = await Promise.race([addPendingQuestion(requestId), abortPromise]);
      if (signal.aborted) abortPendingQuestions(new Set([requestId]));
      activeQuestionIds.delete(requestId);
      return {
        behavior: "allow" as const,
        updatedInput: { ...(input as object), answers },
      };
    }

    // ── All other tools: permission approval flow ────────────────────────────
    const requestId = randomUUID();
    activePermissionIds.add(requestId);
    send({
      type: "permission",
      requestId,
      toolName: displayName ?? toolName,
      toolInput: blockedPath ? { ...input, file_path: blockedPath } : input,
      title: title ?? undefined,
    });
    // Race user response against SDK abort (e.g. user cancels while prompt is open).
    // If aborted first, deny immediately so query() can unwind without deadlocking.
    const abortPromise = new Promise<false>((resolve) => {
      signal.addEventListener("abort", () => resolve(false), { once: true });
    });
    const allowed = await Promise.race([addPendingPermission(requestId), abortPromise]);
    // If abort won the race the POST never arrived, so the resolver is still in the map.
    // (If the user responded, resolvePendingPermission already removed it — this is a no-op.)
    if (signal.aborted) abortPendingPermissions(new Set([requestId]));
    activePermissionIds.delete(requestId);
    return allowed
      ? { behavior: "allow" as const, updatedInput: input }
      : { behavior: "deny" as const, message: "User denied permission" };
  };

  return {
    canUseTool,
    abortPermissions: () => {
      abortPendingPermissions(activePermissionIds);
      abortPendingQuestions(activeQuestionIds);
    },
  };
}
