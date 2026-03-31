/**
 * Shared query() hook configuration.
 *
 * buildAgentHooks — generic factory, usable by any query() caller
 * buildDoveHooks  — convenience wrapper for Dove's top-level query (route.ts)
 * buildSubAgentHooks — convenience wrapper for QueryAgentExecutor sub-agents
 */

import type {
  PostToolUseHookSpecificOutput,
  HookCallbackMatcher,
  HookEvent,
} from "@anthropic-ai/claude-agent-sdk";
import type { AgentDef } from "@@/lib/agents";
import { doveAwaitToolName, hasPendingTasks, getPendingTaskIds } from "@/lib/query-tools";
import { AWAIT_SCRIPT_TOOL } from "@/lib/agent-tools";
import { hasPendingScripts, getPendingRunIds } from "@/a2a/lib/spawn";
import { StillRunningRetryCounter } from "@/lib/still-running-retry-counter";

// ─── Generic hook builder ─────────────────────────────────────────────────────

export interface AgentHooksConfig {
  /** Pipe-separated tool name matcher for the PostToolUse still_running hook. */
  postToolUseMatcher: string;
  /** Returns true when there is at least one pending in-flight operation. */
  hasPendingWork: () => boolean;
  /** Returns the IDs of all currently pending operations. */
  getPendingIds: () => string[];
  /** Extracts the operation ID from a still_running structuredContent payload. */
  getStillRunningId: (structured: unknown) => string | undefined;
}

/**
 * Builds a pair of hooks (PostToolUse + Stop) from a generic config.
 * Suitable for any query() call that uses a start/await tool pattern.
 */
export function buildAgentHooks(
  config: AgentHooksConfig,
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const { postToolUseMatcher, hasPendingWork, getPendingIds, getStillRunningId } = config;
  const retryCounter = new StillRunningRetryCounter();

  return {
    Stop: [
      {
        hooks: [
          async (input) => {
            if (input.hook_event_name !== "Stop") return { continue: true };
            if (input.stop_hook_active || !hasPendingWork()) return { continue: true };
            const ids = getPendingIds();
            return {
              continue: false,
              systemMessage: [
                `⚠️ You have ${ids.length} pending operation(s) still running (id: ${ids.join(", ")}).`,
                `You MUST call the await tool yourself with the id.`,
                `These operations can run for a long time (minutes to hours) — decide an appropriate sleep interval based on the task type.`,
                `Keep calling await in a loop until the operation completes.`,
                `Never give up or stop polling; you are responsible for retrieving the final result.`,
              ].join(" "),
            };
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
            const structured =
              typeof tool_response === "object" &&
              tool_response !== null &&
              "structuredContent" in tool_response
                ? (tool_response as { structuredContent: unknown }).structuredContent
                : undefined;
            const status =
              typeof structured === "object" && structured !== null && "status" in structured
                ? (structured as { status: unknown }).status
                : undefined;
            if (status === "still_running") {
              if (retryCounter.shouldRelease()) {
                return {
                  continue: true,
                  systemMessage:
                    "Releasing control to the agent to surface progress updates before the next await attempt.",
                };
              }
              const id = getStillRunningId(structured);
              const hookSpecificOutput: PostToolUseHookSpecificOutput = {
                hookEventName: "PostToolUse",
                additionalContext: `⚠️ Still running (id: ${id}). You MUST call the await tool again yourself with id "${id}".`,
              };
              return { hookSpecificOutput };
            }
            return { continue: true };
          },
        ],
      },
    ],
  };
}

// ─── Convenience wrappers ─────────────────────────────────────────────────────

/** Hooks for Dove's top-level query() in route.ts. */
export function buildDoveHooks(
  agents: AgentDef[],
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  return buildAgentHooks({
    postToolUseMatcher: agents.map((a) => `mcp__agents__${doveAwaitToolName(a)}`).join("|"),
    hasPendingWork: hasPendingTasks,
    getPendingIds: getPendingTaskIds,
    getStillRunningId: (s) => {
      if (typeof s !== "object" || s === null || !("taskId" in s)) return undefined;
      const val: unknown = Reflect.get(s, "taskId");
      return typeof val === "string" ? val : undefined;
    },
  });
}

/** Hooks for the QueryAgentExecutor sub-agent query(). */
export function buildSubAgentHooks(): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  return buildAgentHooks({
    postToolUseMatcher: `mcp__agents__${AWAIT_SCRIPT_TOOL}`,
    hasPendingWork: hasPendingScripts,
    getPendingIds: getPendingRunIds,
    getStillRunningId: (s) => {
      if (typeof s !== "object" || s === null || !("runId" in s)) return undefined;
      const val: unknown = Reflect.get(s, "runId");
      return typeof val === "string" ? val : undefined;
    },
  });
}
