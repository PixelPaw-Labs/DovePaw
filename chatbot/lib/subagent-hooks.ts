/**
 * Hook configuration specific to the QueryAgentExecutor sub-agent query().
 *
 * Separated from hooks.ts (generic/Dove hooks) so sub-agent concerns
 * — script start/await reminder, agent link self-reflection gate — are
 * owned and maintained here independently.
 */

import type {
  PreToolUseHookSpecificOutput,
  PostToolUseHookSpecificOutput,
  HookCallbackMatcher,
  HookEvent,
} from "@anthropic-ai/claude-agent-sdk";
import { ESCALATE_PATTERNS, HANDOFF_PATTERNS, REVIEW_PATTERNS } from "@/lib/agent-link-patterns";
import {
  CONFIDENCE_THRESHOLD,
  impactPlaceholder,
  startChatToToolName,
  startReviewWithToolName,
  startEscalateToToolName,
  awaitChatToToolName,
  awaitReviewWithToolName,
  awaitEscalateToToolName,
} from "@/lib/agent-tools";
import { buildAgentHooks } from "@/lib/hooks";
import { buildNotificationHooks } from "@/lib/notifications";
import type { PendingRegistry } from "@/lib/pending-registry";
import type { AgentNotificationConfig } from "@@/lib/settings-schemas";

// ─── Script reminder ──────────────────────────────────────────────────────────

export const SUBAGENT_PROMPT_REMINDER = `<reminder>
- When the user's intent is resolved by SOMETHING BEING DONE: ALWAYS START yourself first (returns runId immediately), tell the user what you've kicked off, then WAIT as a **background Task** concurrently.
</reminder>`;

export const GROUP_PROMPT_REMINDER = `<reminder>
- When the user's intent is resolved by SOMETHING BEING DONE: ALWAYS START yourself first (returns runId immediately), then WAIT as a **background Task** concurrently.
- Do NOT output and respond with any text such as narration, status updates, or confirmations.
</reminder>`;

// ─── Agent link self-reflection gate ─────────────────────────────────────────

const thresholdTable = Object.entries(CONFIDENCE_THRESHOLD)
  .map(
    ([k, { threshold, description }]) =>
      `  ${k.padEnd(10)}→ ${threshold === Infinity ? "never handed off" : `confidence ≥ ${threshold}`}  (${description})`,
  )
  .join("\n");

function buildReflectionPrompt(patterns: string, isGroupMode?: boolean): string {
  const ifNo = isGroupMode
    ? "If NO to any: do not re-call. Continue without the handoff and DO NOT explain your reasoning."
    : "If NO to any: do not re-call. Continue without the handoff and explain your reasoning.";
  return `<reminder>
You are about to delegate work to another agent. Pause and answer:

1. Have you completed your own task? If not, finish it first.
2. Do you have concrete, specific output to hand off (issues list, report, IDs, findings)?
   Vague intent ("check this", "take a look") is not a valid handoff.
3. Does the handoff match a clear pattern?
<patterns>
${patterns}
</patterns>

If YES to all: re-call this tool with a \`justification\` object:
  {
    "impact": "<${impactPlaceholder}>",
    "pattern": "<which pattern above applies>",
    "handoff": "<one sentence: what concrete output you are handing off>",
    "confidence": <0–1>
  }
${isGroupMode ? "Do NOT output and respond with any text such as narration, status updates, or confirmations.\n" : ""}
Impact-gated thresholds:
${thresholdTable}

${ifNo}
</reminder>`;
}

function makeReflectionMatcher(matcher: string, reflectionPrompt: string): HookCallbackMatcher {
  return {
    matcher,
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
            permissionDecisionReason: reflectionPrompt,
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
                ? `confidence is missing or not a number. Re-call with a numeric confidence score (0–1).`
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
}

function buildReflectionMatchers(isGroupMode?: boolean): HookCallbackMatcher[] {
  return [
    makeReflectionMatcher(
      `mcp__agents__${startChatToToolName(".*")}`,
      buildReflectionPrompt(HANDOFF_PATTERNS(), isGroupMode),
    ),
    makeReflectionMatcher(
      `mcp__agents__${startReviewWithToolName(".*")}`,
      buildReflectionPrompt(REVIEW_PATTERNS(), isGroupMode),
    ),
    makeReflectionMatcher(
      `mcp__agents__${startEscalateToToolName(".*")}`,
      buildReflectionPrompt(ESCALATE_PATTERNS(), isGroupMode),
    ),
  ];
}

// ─── Stop hook: handoff consideration ────────────────────────────────────────

function buildHandoffConsiderationPrompt(
  tools: Array<{ name: string; description: string }>,
  isGroupMode?: boolean,
): string {
  const toolsXml = tools
    .map(
      (t) =>
        `  <tool>\n    <name>${t.name}</name>\n    <description>${t.description}</description>\n  </tool>`,
    )
    .join("\n");
  const ifNo = isGroupMode
    ? "If no: stop immediately and DO NOT explain your reasoning."
    : "If no: stop immediately and explain your reasoning.";
  return `<reminder>
Before you finish: have you considered whether to hand off your results to a linked agent?

<handoff_tools>
${toolsXml}
</handoff_tools>

If yes: call the appropriate tool before stopping.
${isGroupMode ? "Do NOT output and respond with any text such as narration, status updates, or confirmations.\n" : ""}${ifNo}
</reminder>`;
}

// ─── Group chat silence hooks ─────────────────────────────────────────────────

// After start_*: agent must call the await tool next — no output allowed.
// After await_*: agent has the result — no narration, deliver response directly.

const GROUP_START_MATCHER = [
  `mcp__agents__${startChatToToolName(".*")}`,
  `mcp__agents__${startReviewWithToolName(".*")}`,
  `mcp__agents__${startEscalateToToolName(".*")}`,
].join("|");

const GROUP_AWAIT_MATCHER = [
  `mcp__agents__${awaitChatToToolName(".*")}`,
  `mcp__agents__${awaitReviewWithToolName(".*")}`,
  `mcp__agents__${awaitEscalateToToolName(".*")}`,
].join("|");

const GROUP_START_SILENCE = `<reminder>
You have started a handoff task. 
Call the corresponding await tool immediately to collect the result.
Do NOT output and respond with any text such as narration, status updates, or confirmations before calling the await tool.
</reminder>`;

const GROUP_AWAIT_SILENCE = `<reminder>
Do NOT output any text or narration between tool calls.
Proceed directly to the next tool call.
Only deliver your response when you have fully completed your task with concrete results to share.
</reminder>`;

function makeGroupSilenceHook(matcher: string, context: string): HookCallbackMatcher {
  return {
    matcher,
    hooks: [
      async (input) => {
        if (input.hook_event_name !== "PostToolUse") return { continue: true };
        const hookSpecificOutput: PostToolUseHookSpecificOutput = {
          hookEventName: "PostToolUse",
          additionalContext: context,
        };
        return { hookSpecificOutput };
      },
    ],
  };
}

const groupStartHandoffHook = makeGroupSilenceHook(GROUP_START_MATCHER, GROUP_START_SILENCE);
const groupAwaitHandoffHook = makeGroupSilenceHook(GROUP_AWAIT_MATCHER, GROUP_AWAIT_SILENCE);

// ─── Builder ──────────────────────────────────────────────────────────────────

/** Hooks for the QueryAgentExecutor sub-agent query(). */
export function buildSubAgentHooks(
  cwd: string,
  additionalDirectories: string[],
  agentLinkTools: Array<{ name: string; description: string }>,
  registry: PendingRegistry,
  manifestKey: string,
  agentDisplayName?: string,
  notifications?: AgentNotificationConfig,
  env?: Record<string, string | undefined>,
  isGroupMode?: boolean,
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const hasAgentLinks = agentLinkTools.length > 0;
  const handoffConsiderationStop: HookCallbackMatcher = {
    hooks: [
      async (input) => {
        if (input.hook_event_name !== "Stop") return { continue: true };
        // Already reminded once this turn — let the agent stop.
        if (input.stop_hook_active) return { continue: true };
        // Pending operations exist — the base Stop hook handles that case.
        if (registry.hasPending()) return { continue: true };
        return {
          decision: "block",
          reason: buildHandoffConsiderationPrompt(agentLinkTools, isGroupMode),
        };
      },
    ],
  };

  const notifHooks =
    notifications && agentDisplayName
      ? buildNotificationHooks(manifestKey, agentDisplayName, notifications, env)
      : {};

  const base = buildAgentHooks({
    postToolUseMatcher: "mcp__agents__await_.*",
    registry,
    userPromptReminder: isGroupMode ? GROUP_PROMPT_REMINDER : SUBAGENT_PROMPT_REMINDER,
    allowedDirectories: [cwd, ...additionalDirectories],
  });
  return {
    ...base,
    PreToolUse: [
      ...(base.PreToolUse ?? []),
      ...(notifHooks.PreToolUse ?? []),
      ...buildReflectionMatchers(isGroupMode),
    ],
    PostToolUse: [
      ...(base.PostToolUse ?? []),
      ...(notifHooks.PostToolUse ?? []),
      ...(isGroupMode ? [groupStartHandoffHook, groupAwaitHandoffHook] : []),
    ],
    ...(hasAgentLinks && {
      Stop: [...(base.Stop ?? []), handoffConsiderationStop],
    }),
  };
}
