/**
 * Hook configuration specific to the QueryAgentExecutor sub-agent query().
 *
 * Separated from hooks.ts (generic/Dove hooks) so sub-agent concerns
 * — script start/await reminder, agent link self-reflection gate — are
 * owned and maintained here independently.
 */

import type {
  PreToolUseHookSpecificOutput,
  HookCallbackMatcher,
  HookEvent,
} from "@anthropic-ai/claude-agent-sdk";
import { HANDOFF_PATTERNS } from "@/lib/agent-link-patterns";
import { hasPendingScripts, getPendingRunIds } from "@/a2a/lib/spawn";
import { START_SCRIPT_TOOL, AWAIT_SCRIPT_TOOL } from "@/lib/agent-tools";
import { buildAgentHooks } from "@/lib/hooks";

// ─── Script reminder ──────────────────────────────────────────────────────────

const SUB_AGENT_PROMPT_REMINDER = `<reminder>
When the intent is to RUN this agent: call \`${START_SCRIPT_TOOL}\` first (returns runId immediately), then \`${AWAIT_SCRIPT_TOOL}\` as a background Task. Retry with the same runId if still_running.
When the intent is to DELEGATE to a linked agent: use chat_to_*, start_chat_to_*/await_chat_to_*, review_with_*, or escalate_to_* — only after your own work is complete and concrete (confidence ≥ 90 required).
</reminder>`;

// ─── Agent link self-reflection gate ─────────────────────────────────────────

const CONFIDENCE_THRESHOLD = 90;

const CHAT_TO_REFLECTION_PROMPT = `<reminder>
You are about to delegate work to another agent. Pause and answer:

1. Have you completed your own task? If not, finish it first.
2. Do you have concrete, specific output to hand off (issues list, report, IDs, findings)?
   Vague intent ("check this", "take a look") is not a valid handoff.
3. Does the handoff match a clear pattern?
${HANDOFF_PATTERNS}

If YES to all: re-call this tool with a \`justification\` object:
  {
    "pattern": "<which pattern above applies>",
    "handoff": "<one sentence: what concrete output you are handing off>",
    "confidence": <0–100>
  }
The call proceeds only when confidence is ${CONFIDENCE_THRESHOLD} or above.

If NO to any: do not re-call. Continue without the handoff and explain your reasoning.
</reminder>`;

const chatToReflectionMatcher: HookCallbackMatcher = {
  // Matches the full MCP-prefixed names for all agent link tools.
  // Docs confirm matcher runs against the full tool name (e.g. mcp__agents__chat_to_fixer).
  matcher: "mcp__agents__(chat_to|start_chat_to|review_with|escalate_to)_.*",
  hooks: [
    async (input) => {
      if (input.hook_event_name !== "PreToolUse") return { continue: true };
      const { tool_input } = input;

      const justificationRaw: unknown =
        tool_input !== null && typeof tool_input === "object"
          ? Reflect.get(tool_input, "justification")
          : undefined;

      if (
        justificationRaw === null ||
        justificationRaw === undefined ||
        typeof justificationRaw !== "object"
      ) {
        const hookSpecificOutput: PreToolUseHookSpecificOutput = {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: CHAT_TO_REFLECTION_PROMPT,
        };
        return { hookSpecificOutput };
      }

      const confidence: unknown = Reflect.get(justificationRaw, "confidence");
      if (typeof confidence !== "number" || confidence < CONFIDENCE_THRESHOLD) {
        const hookSpecificOutput: PreToolUseHookSpecificOutput = {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason:
            typeof confidence !== "number"
              ? `justification.confidence is missing or not a number. Re-call with a numeric confidence score (0–100). Threshold: ${CONFIDENCE_THRESHOLD}.`
              : `Confidence ${confidence} is below the required threshold of ${CONFIDENCE_THRESHOLD}. Only proceed if genuinely confident this handoff is necessary and well-scoped.`,
        };
        return { hookSpecificOutput };
      }

      const hookSpecificOutput: PreToolUseHookSpecificOutput = {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
      };
      return { hookSpecificOutput };
    },
  ],
};

// ─── Builder ──────────────────────────────────────────────────────────────────

/** Hooks for the QueryAgentExecutor sub-agent query(). */
export function buildSubAgentHooks(
  cwd: string,
  additionalDirectories: string[],
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const base = buildAgentHooks({
    postToolUseMatcher: "mcp__agents__await_.*",
    hasPendingWork: hasPendingScripts,
    getPendingIds: getPendingRunIds,
    getStillRunningId: (s) => {
      if (typeof s !== "object" || s === null) return undefined;
      // await_run_script returns { runId }, await_chat_to_* returns { taskId }
      const id: unknown = Reflect.get(s, "runId") ?? Reflect.get(s, "taskId");
      return typeof id === "string" ? id : undefined;
    },
    userPromptReminder: SUB_AGENT_PROMPT_REMINDER,
    allowedDirectories: [cwd, ...additionalDirectories],
  });
  return {
    ...base,
    PreToolUse: [...(base.PreToolUse ?? []), chatToReflectionMatcher],
  };
}
