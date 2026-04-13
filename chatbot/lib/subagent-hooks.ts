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
import {
  START_SCRIPT_TOOL,
  AWAIT_SCRIPT_TOOL,
  CONFIDENCE_THRESHOLD,
  impactPlaceholder,
  thresholdClause,
} from "@/lib/agent-tools";
import { buildAgentHooks } from "@/lib/hooks";
import type { PendingRegistry } from "@/lib/pending-registry";

// ─── Script reminder ──────────────────────────────────────────────────────────

const SUB_AGENT_PROMPT_REMINDER = `<reminder>
When the intent is to RUN this agent: call \`${START_SCRIPT_TOOL}\` first (returns runId immediately), then \`${AWAIT_SCRIPT_TOOL}\` as a background Task. Retry with the same runId if still_running.
When the intent is to HANDOFF to a linked agent: use chat_to_*, start_chat_to_*/await_chat_to_*, review_with_*, or escalate_to_* — only after your own work is complete and concrete. Delegation threshold is impact-gated: ${thresholdClause}.
</reminder>`;

// ─── Agent link self-reflection gate ─────────────────────────────────────────

const thresholdTable = Object.entries(CONFIDENCE_THRESHOLD)
  .map(
    ([k, { threshold, description }]) =>
      `  ${k.padEnd(10)}→ ${threshold === Infinity ? "never handed off" : `confidence ≥ ${threshold}`}  (${description})`,
  )
  .join("\n");

const CHAT_TO_REFLECTION_PROMPT = `<reminder>
You are about to delegate work to another agent. Pause and answer:

1. Have you completed your own task? If not, finish it first.
2. Do you have concrete, specific output to hand off (issues list, report, IDs, findings)?
   Vague intent ("check this", "take a look") is not a valid handoff.
3. Does the handoff match a clear pattern?
${HANDOFF_PATTERNS}

If YES to all: re-call this tool with a \`justification\` object:
  {
    "impact": "<${impactPlaceholder}>",
    "pattern": "<which pattern above applies>",
    "handoff": "<one sentence: what concrete output you are handing off>",
    "confidence": <0–100>
  }

Impact-gated thresholds:
${thresholdTable}

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
      const inputObj = tool_input !== null && typeof tool_input === "object" ? tool_input : null;

      const justificationRaw: unknown = inputObj
        ? Reflect.get(inputObj, "justification")
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
      const impact: unknown = Reflect.get(justificationRaw, "impact");

      const impactKey =
        typeof impact === "string" && impact in CONFIDENCE_THRESHOLD ? impact : undefined;

      if (impactKey === undefined) {
        const hookSpecificOutput: PreToolUseHookSpecificOutput = {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: `impact is missing or invalid ("${String(impact)}"). Re-call with impact: ${impactPlaceholder}.`,
        };
        return { hookSpecificOutput };
      }

      const entry = CONFIDENCE_THRESHOLD[impactKey];

      if (entry.threshold === Infinity) {
        const hookSpecificOutput: PreToolUseHookSpecificOutput = {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: `Low-impact handoffs are skipped. Handle via message instead, or raise the impact level if this is genuinely consequential.`,
        };
        return { hookSpecificOutput };
      }

      if (typeof confidence !== "number" || confidence < entry.threshold) {
        const hookSpecificOutput: PreToolUseHookSpecificOutput = {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason:
            typeof confidence !== "number"
              ? `confidence is missing or not a number. Re-call with a numeric confidence score (0–100).`
              : `Confidence ${confidence} is below the required threshold of ${entry.threshold} for ${impactKey} impact. Only proceed if genuinely confident this handoff is necessary and well-scoped.`,
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

// ─── Stop hook: handoff consideration ────────────────────────────────────────

const HANDOFF_CONSIDERATION_PROMPT = `<reminder>
Before you finish: have you considered whether to hand off your results to a linked agent?

If you produced concrete output (findings, issues, report, IDs), check whether any of these patterns apply:
${HANDOFF_PATTERNS}

If yes: call the appropriate chat_to_*, review_with_*, or escalate_to_* tool before stopping.
If no: you may stop.
</reminder>`;

// ─── Builder ──────────────────────────────────────────────────────────────────

/** Hooks for the QueryAgentExecutor sub-agent query(). */
export function buildSubAgentHooks(
  cwd: string,
  additionalDirectories: string[],
  hasAgentLinks: boolean,
  registry: PendingRegistry,
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const handoffConsiderationStop: HookCallbackMatcher = {
    hooks: [
      async (input) => {
        if (input.hook_event_name !== "Stop") return { continue: true };
        // Already reminded once this turn — let the agent stop.
        if (input.stop_hook_active) return { continue: true };
        // Pending operations exist — the base Stop hook handles that case.
        if (registry.hasPending()) return { continue: true };
        return { decision: "block", reason: HANDOFF_CONSIDERATION_PROMPT };
      },
    ],
  };

  const base = buildAgentHooks({
    postToolUseMatcher: "mcp__agents__await_.*",
    hasPendingWork: () => registry.hasPending(),
    getPendingDescriptions: () =>
      registry.getPending().map((e) => `call \`${e.awaitTool}\` with ${e.idKey}: "${e.id}"`),
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
    ...(hasAgentLinks && {
      Stop: [...(base.Stop ?? []), handoffConsiderationStop],
    }),
  };
}
