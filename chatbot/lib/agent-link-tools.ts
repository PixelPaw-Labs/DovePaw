import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { AgentDef } from "@@/lib/agents";
import { z } from "zod";
import type { CollectedStream } from "@/lib/a2a-client";
import { ESCALATE_PATTERNS, HANDOFF_PATTERNS, REVIEW_PATTERNS } from "@/lib/agent-link-patterns";
import { TaskPoller } from "@/lib/task-poller";
import type { PendingRegistry } from "@/lib/pending-registry";
import { relaySessionEvent } from "@/lib/relay-to-chatbot";
import { HANDOFF_COMPLETENESS } from "./agent-script-tools";
import { withStartReminder } from "@@/lib/subagent-reminder";
import { taskRuntime } from "@/lib/task-runtime";

/** Emits a sender bubble to the group pool stream when the caller is in group mode. */
function emitGroupSenderBubble(
  callerAgentId: string | undefined,
  groupMeta: Record<string, unknown> | undefined,
  text: string,
): void {
  if (!callerAgentId || !groupMeta) return;
  const { groupContextId } = groupMeta;
  if (typeof groupContextId !== "string") return;
  relaySessionEvent(groupContextId, {
    type: "group_member",
    agentId: callerAgentId,
    text,
    done: true,
    isSender: true,
  });
}

// ─── Delegation thresholds ────────────────────────────────────────────────────

/** Minimum handoff score (0–100) in the stop-hook consideration prompt that forces a handoff call. */
export const HANDOFF_SCORE_THRESHOLD = 80;

export const CONFIDENCE_THRESHOLD: Record<string, { threshold: number; description: string }> = {
  high: {
    threshold: 0.7,
    description:
      "your output is pivotal — the recipient cannot meaningfully proceed, decide, or respond without it. " +
      "The handoff has clear directionality: there is an obvious and immediate action the recipient takes from what you are giving them. " +
      "Use this when you have completed something that directly feeds their next step, changes the direction of the overall task, or unblocks work that is waiting on you. " +
      "If you are uncertain whether it qualifies, ask: would the recipient be stuck or significantly misled without this? If yes, it is high.",
  },
  medium: {
    threshold: 0.85,
    description:
      "your output is complete and self-contained — the recipient can engage with it fully, build on it, or use it as a foundation for their own contribution. " +
      "It may not be the final word, but it adds real, concrete substance to the shared understanding. " +
      "Use this for the normal progression of work: your analysis is ready, your prediction is formed, your review covers the agreed scope, your part of a collaborative task is done. " +
      "The recipient has a clear next step but is not blocked without this — the handoff advances the work rather than unblocking it.",
  },
  low: {
    threshold: Infinity,
    description:
      "your output is preliminary, tangential, or informational only — the recipient may find it interesting but does not need it to do their part. " +
      "A formal handoff is not the right vehicle: share via message, add it as context, or hold it until you have something more complete. " +
      "If you are unsure whether it is low or medium, ask: is there a concrete action the recipient would take directly from this output? If not, it is low.",
  },
};

export const impactPlaceholder = Object.keys(CONFIDENCE_THRESHOLD).join("|");

export const thresholdClause = Object.entries(CONFIDENCE_THRESHOLD)
  .map(
    ([k, { threshold, description }]) =>
      `${k} ${threshold === Infinity ? "never handed off" : `≥ ${threshold}`} (${description})`,
  )
  .join(", ");

const [firstImpact, ...restImpacts] = Object.keys(CONFIDENCE_THRESHOLD);

/** Shared justification schema for all agent delegation tools (chat_to, review_with, escalate_to). */
export const justificationField = z
  .object({
    impact: z
      .enum([firstImpact, ...restImpacts] as [string, ...string[]])
      .describe(
        `Impact level of this handoff. Confidence threshold is impact-gated: ${thresholdClause}.`,
      ),
    pattern: z
      .string()
      .describe(
        "Which handoff pattern applies: 'Detection → Resolution', 'Aggregation → Action', 'Blocked by gap', or 'Phase handoff'.",
      ),
    handoff: z
      .string()
      .describe("One sentence describing the concrete output or blocker being handed off."),
    confidence: z
      .number()
      .min(0)
      .max(1)
      .describe(`Confidence score (0–1). Threshold is impact-gated: ${thresholdClause}.`),
  })
  .describe("Required on every delegation call. Fill this out before handing off.");

// ─── Link tool name helpers ───────────────────────────────────────────────────

/** Tool name for sending a message to a linked agent (start_chat_to_* pattern). */
export const startChatToToolName = (manifestKey: string): string => `start_chat_to_${manifestKey}`;
/** Returns true when a tool name is a handoff-initiating agent-link tool. */
export const isHandoffToolName = (name: string): boolean =>
  name.includes(startChatToToolName("")) ||
  name.includes(startReviewWithToolName("")) ||
  name.includes(startEscalateToToolName(""));
/** Tool name for collecting the result of a start_chat_to_* call. */
export const awaitChatToToolName = (manifestKey: string): string => `await_chat_to_${manifestKey}`;
/** Tool name for submitting work to a reviewing agent (start_review_with_* pattern). */
export const startReviewWithToolName = (manifestKey: string): string =>
  `start_review_with_${manifestKey}`;
/** Tool name for collecting the result of a start_review_with_* call. */
export const awaitReviewWithToolName = (manifestKey: string): string =>
  `await_review_with_${manifestKey}`;
/** Tool name for escalating a blocker to a specialist agent (start_escalate_to_* pattern). */
export const startEscalateToToolName = (manifestKey: string): string =>
  `start_escalate_to_${manifestKey}`;
/** Tool name for collecting the result of a start_escalate_to_* call. */
export const awaitEscalateToToolName = (manifestKey: string): string =>
  `await_escalate_to_${manifestKey}`;

// ─── Agent link tool ──────────────────────────────────────────────────────────

/**
 * Fire-and-forget start tool for parallel fan-out.
 * Carries the full handoff description so the model understands when to delegate.
 * A PreToolUse hook gates every invocation — the model must include a `justification`
 * field (populated on retry after self-reflection) before the hook allows the call through.
 */
export function makeStartChatToTool(
  targetDef: AgentDef,
  signal?: AbortSignal,
  backgroundTasks?: Promise<CollectedStream>[],
  registry?: PendingRegistry,
  callerAgentId?: string,
  groupMeta?: Record<string, unknown>,
) {
  const { displayName, manifestKey, description } = targetDef;
  return tool(
    startChatToToolName(manifestKey),
    `Send a message to ${displayName} and wait for their response.

${displayName} specialises in: "${description}"

${HANDOFF_PATTERNS(displayName)}`,
    {
      instruction: z
        .string()
        .describe(
          `The task or findings to hand off to ${displayName}. ${HANDOFF_COMPLETENESS} ` +
            `Open by addressing ${displayName} by name (e.g. "@${displayName}, I have done X and need Y"). ` +
            `Write in first person — never refer to yourself by name or in third person, ` +
            `because ${displayName} receives this as a direct message from you, not a report about you. ` +
            `Do not prescribe how ${displayName} should respond or instruct them on their style — that is their decision, not yours.`,
        ),
      contextId: z.string().optional().describe("Continue a prior session. Omit to start fresh."),
      justification: justificationField,
    },
    async ({ instruction, contextId }) => {
      emitGroupSenderBubble(callerAgentId, groupMeta, instruction);
      return await new TaskPoller(
        manifestKey,
        displayName,
        signal,
        registry,
        awaitChatToToolName(manifestKey),
        targetDef.name,
      ).start(withStartReminder(instruction, manifestKey), {
        contextId,
        backgroundTasks,
        senderAgentId: callerAgentId,
        extraMetadata: groupMeta,
        groupSource: "chat",
      });
    },
  );
}

/**
 * Await tool for parallel fan-out — polls a task started by start_chat_to_*.
 * Returns the full agent context (thinking + actions + response) when complete,
 * or { status: "still_running", taskId } if the poll window expired.
 *
 * Mirrors Dove's makeAwaitTool pattern: races subscribeTaskStream against
 * AWAIT_POLL_TIMEOUT_MS so the PostToolUse still_running hook can enforce retries.
 */
export function makeAwaitChatToTool(
  targetDef: AgentDef,
  signal?: AbortSignal,
  registry?: PendingRegistry,
) {
  const { displayName, manifestKey } = targetDef;
  return tool(
    awaitChatToToolName(manifestKey),
    `Collect the result of a previously started ${displayName} task.\n` +
      `Call this after ${startChatToToolName(manifestKey)} to retrieve the agent's output.`,
    {
      taskId: z.string().describe("The taskId returned by " + startChatToToolName(manifestKey)),
      timeoutMs: z
        .number()
        .int()
        .min(10000)
        .describe(taskRuntime.buildDescription(targetDef.name, awaitChatToToolName(manifestKey))),
    },
    async ({ taskId, timeoutMs }) => {
      return await new TaskPoller(
        manifestKey,
        displayName,
        signal,
        registry,
        awaitChatToToolName(manifestKey),
        targetDef.name,
      ).poll(taskId, timeoutMs);
    },
  );
}

// ─── Review strategy tools ────────────────────────────────────────────────────

/**
 * Fire-and-forget start tool for review delegation.
 * Sends content to a reviewing agent and returns a taskId immediately.
 * Use makeAwaitReviewTool to collect the approve/reject decision.
 */
export function makeStartReviewTool(
  targetDef: AgentDef,
  signal?: AbortSignal,
  registry?: PendingRegistry,
  callerAgentId?: string,
  groupMeta?: Record<string, unknown>,
  callerDisplayName?: string,
) {
  const { displayName, manifestKey, description } = targetDef;
  return tool(
    startReviewWithToolName(manifestKey),
    `Submit your output to ${displayName} for review before it goes upstream.\n\n` +
      `${displayName} specialises in: "${description}"\n\n` +
      `The reviewer will respond with only a JSON object: {"decision":"APPROVED"|"REJECTED","reason":"<comprehensive feedback>"}\n\n` +
      REVIEW_PATTERNS(displayName),
    {
      content: z
        .string()
        .describe(
          `Your review request — describe what you have done and what you need reviewed. ${HANDOFF_COMPLETENESS} ` +
            `Open by addressing ${displayName} by name (e.g. "@${displayName}, I have completed X, please review Y"). ` +
            `Write in first person — the reviewer reads this as your direct submission, not a third-party description. ` +
            `Must be complete, not a draft.`,
        ),
      context: z.string().optional().describe("Additional context the reviewer needs."),
      justification: justificationField,
    },
    async ({ content, context }) => {
      emitGroupSenderBubble(callerAgentId, groupMeta, content);
      const instruction = [
        `You are reviewing the following work product.`,
        `Your entire final response must be ONLY a JSON object — no text before or after it.`,
        `The JSON must have exactly this shape:`,
        `{"decision":"APPROVED"|"REJECTED","reason":"<comprehensive explanation: cover what is correct, what is missing or wrong, what must change for approval, and any risks — be thorough>"}`,
        ...(callerDisplayName
          ? [`In the reason field, address the sender as @${callerDisplayName}.`]
          : []),
        `\nWork product:\n`,
        `${content}\n\n`,
        ...(context ? [`\nContext:\n${context}`] : []),
      ].join("\n");
      return new TaskPoller(
        manifestKey,
        displayName,
        signal,
        registry,
        awaitReviewWithToolName(manifestKey),
        targetDef.name,
      ).start(withStartReminder(instruction, manifestKey), {
        senderAgentId: callerAgentId,
        extraMetadata: groupMeta,
        groupSource: "review",
      });
    },
  );
}

/**
 * Await tool for review delegation — polls a task started by start_review_with_*.
 * Parses the approve/reject JSON decision from the reviewer's output when complete.
 */
export function makeAwaitReviewTool(
  targetDef: AgentDef,
  signal?: AbortSignal,
  registry?: PendingRegistry,
) {
  const { displayName, manifestKey } = targetDef;
  return tool(
    awaitReviewWithToolName(manifestKey),
    `Collect the review decision from a previously submitted ${displayName} review.\n` +
      `Call this after ${startReviewWithToolName(manifestKey)} to retrieve the approve/reject decision.`,
    {
      taskId: z.string().describe("The taskId returned by " + startReviewWithToolName(manifestKey)),
      timeoutMs: z
        .number()
        .int()
        .min(10000)
        .describe(
          taskRuntime.buildDescription(targetDef.name, awaitReviewWithToolName(manifestKey)),
        ),
    },
    async ({ taskId, timeoutMs }) => {
      const pollResult = await new TaskPoller(
        manifestKey,
        displayName,
        signal,
        registry,
        awaitReviewWithToolName(manifestKey),
        targetDef.name,
      ).poll(taskId, timeoutMs);

      const sc = pollResult.structuredContent;
      if (!sc || !("result" in sc)) return pollResult;

      const output = sc.result.output ?? "";
      let decision: "APPROVED" | "REJECTED" | "NO_DECISION" = "NO_DECISION";
      let reason: string | undefined;
      const reviewSchema = z.object({
        decision: z.enum(["APPROVED", "REJECTED"]).optional(),
        reason: z.string().optional(),
      });
      const tryParseReview = (text: string) => {
        try {
          return reviewSchema.safeParse(JSON.parse(text.trim()));
        } catch {
          return null;
        }
      };
      // Reviewer is prompted to output only JSON — try the full output first.
      // Fall back to extracting the first {...} block spanning multiple lines.
      const parsed =
        tryParseReview(output) ??
        (() => {
          const m = output.match(/\{[\s\S]*"decision"[\s\S]*\}/);
          return m ? tryParseReview(m[0]) : null;
        })();
      if (parsed?.success) {
        if (parsed.data.decision) decision = parsed.data.decision;
        reason = parsed.data.reason;
      }
      const decisionLine = `Review decision: ${decision}${reason ? `\nReason: ${reason}` : ""}`;
      return {
        content: [{ type: "text" as const, text: decisionLine }],
        structuredContent: { ...sc, decision, reason },
      };
    },
  );
}

// ─── Escalation strategy tools ───────────────────────────────────────────────

/**
 * Fire-and-forget start tool for escalation delegation.
 * Escalates a blocker to a supervisor/specialist agent and returns a taskId immediately.
 * Use makeAwaitEscalateTool to collect the guidance.
 */
export function makeStartEscalateTool(
  targetDef: AgentDef,
  signal?: AbortSignal,
  registry?: PendingRegistry,
  callerAgentId?: string,
  groupMeta?: Record<string, unknown>,
  callerDisplayName?: string,
) {
  const { displayName, manifestKey, description } = targetDef;
  return tool(
    startEscalateToToolName(manifestKey),
    `Escalate a blocker to ${displayName} and receive a taskId immediately.\n\n` +
      `${displayName} specialises in: "${description}"\n\n` +
      ESCALATE_PATTERNS(displayName),
    {
      blocker: z
        .string()
        .describe(
          `The specific decision or problem you cannot resolve alone. ${HANDOFF_COMPLETENESS} ` +
            `Open by addressing ${displayName} by name (e.g. "@${displayName}, I cannot decide X because Y"). ` +
            `Write in first person from your own perspective — not a third-party description. The receiving agent needs to understand your situation, not read a report about you.`,
        ),
      context: z
        .string()
        .describe(
          `What you have tried and what you know so far. ` +
            `Write in first person ("I tried X, it failed because Y. I know Z but not W.") — ` +
            `this is your investigation log, not a summary written about you. Be concrete: include commands run, errors seen, assumptions made.`,
        ),
      justification: justificationField,
    },
    async ({ blocker, context, justification }) => {
      emitGroupSenderBubble(callerAgentId, groupMeta, blocker);
      const instruction = [
        `ESCALATION — confidence: ${justification.confidence}/1\n`,
        ...(callerDisplayName
          ? [`Open your response by addressing the sender as @${callerDisplayName}.`]
          : []),
        `Blocker: ${blocker}`,
        `\nContext:\n${context}`,
        `\nPlease provide guidance or make the decision so I can continue.`,
      ].join("\n");
      return new TaskPoller(
        manifestKey,
        displayName,
        signal,
        registry,
        awaitEscalateToToolName(manifestKey),
        targetDef.name,
      ).start(withStartReminder(instruction, manifestKey), {
        senderAgentId: callerAgentId,
        extraMetadata: groupMeta,
        groupSource: "escalation",
      });
    },
  );
}

/**
 * Await tool for escalation delegation — polls a task started by start_escalate_to_*.
 * Returns the supervisor's guidance or decision when complete.
 */
export function makeAwaitEscalateTool(
  targetDef: AgentDef,
  signal?: AbortSignal,
  registry?: PendingRegistry,
) {
  const { displayName, manifestKey } = targetDef;
  return tool(
    awaitEscalateToToolName(manifestKey),
    `Collect the guidance from a previously started ${displayName} escalation.\n` +
      `Call this after ${startEscalateToToolName(manifestKey)} to retrieve the decision or guidance.`,
    {
      taskId: z.string().describe("The taskId returned by " + startEscalateToToolName(manifestKey)),
      timeoutMs: z
        .number()
        .int()
        .min(10000)
        .describe(
          taskRuntime.buildDescription(targetDef.name, awaitEscalateToToolName(manifestKey)),
        ),
    },
    async ({ taskId, timeoutMs }) => {
      return new TaskPoller(
        manifestKey,
        displayName,
        signal,
        registry,
        awaitEscalateToToolName(manifestKey),
        targetDef.name,
      ).poll(taskId, timeoutMs);
    },
  );
}
