/**
 * MCP tool factories for the Dove chat API.
 *
 * makeAskTool   — sends instruction, returns result after full task completion
 * makeStartTool — fires task, returns taskId as soon as the task is accepted
 * makeAwaitTool — subscribes to an existing task, returns result when it completes
 *
 * makeAskTool and makeAwaitTool share the same stream-collection logic via
 * collectStreamText — the only difference is which stream they subscribe to.
 */

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import type { AgentDef } from "@@/lib/agents";
import { z } from "zod";
import { resolveAgentPort, createAgentClient } from "@/lib/a2a-client";
import type { CollectedStream } from "@/lib/a2a-client";
import {
  TaskPoller,
  noServersMessage,
  unreachableMessage,
  isConnectionError,
} from "@/lib/task-poller";
import type { PendingRegistry } from "@/lib/pending-registry";
import { AGENT_LINK_STRATEGIES, type AgentLinkStrategy } from "@@/lib/agent-links-schemas";
import { withStartReminder, withMemoryReminder } from "@@/lib/subagent-reminder";
import { agentPersistentStateDir } from "@/lib/paths";
import { taskRuntime } from "@/lib/task-runtime";
import type { AgentTaskStateMachine } from "@/lib/agent-task-state";
import { groupMemberCounters } from "@/lib/group-member-counter";
import { publishSessionEvent } from "@/lib/session-events";
import { setGroupMessage, setSessionStatus } from "@/lib/db";

// ─── Justification gate ───────────────────────────────────────────────────────

export const CONFIDENCE_THRESHOLD: Record<string, { threshold: number; description: string }> = {
  high: {
    threshold: 0.7,
    description:
      "your output is pivotal — the recipient cannot meaningfully proceed, decide, or respond without it. " +
      "The handoff has clear directionality: there is an obvious and immediate action the recipient takes from what you are giving them.",
  },
  medium: {
    threshold: 0.85,
    description:
      "your output is complete and self-contained — the recipient can engage with it fully, build on it, or use it as a foundation for their own contribution. " +
      "Use this for the normal progression of work: your analysis is ready, your prediction is formed, your part of a collaborative task is done.",
  },
  low: {
    threshold: Infinity,
    description:
      "your output is preliminary, tangential, or informational only — the recipient may find it interesting but does not need it to do their part. " +
      "A formal handoff is not the right vehicle: share via message, add it as context, or hold it until you have something more complete.",
  },
};

const [firstImpact, ...restImpacts] = Object.keys(CONFIDENCE_THRESHOLD);

const thresholdClause = Object.entries(CONFIDENCE_THRESHOLD)
  .map(
    ([k, { threshold, description }]) =>
      `${k} ${threshold === Infinity ? "never handed off" : `≥ ${threshold}`} (${description})`,
  )
  .join(", ");

export const justificationField = z
  .object({
    impact: z
      .enum([firstImpact, ...restImpacts] as [string, ...string[]])
      .describe(`Impact level of this handoff. Threshold is impact-gated: ${thresholdClause}.`),
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
      .describe(
        `Confidence score as a decimal fraction 0.0–1.0 (e.g. 0.9 = 90% confident). Threshold is impact-gated: ${thresholdClause}.`,
      ),
  })
  .describe("Required on every delegation call. Fill this out before handing off.");

// ─── Structured content types ─────────────────────────────────────────────────

export const AgentCallMode = {
  Ask: "ask",
  Start: "start",
} as const;
export type AgentCallMode = (typeof AgentCallMode)[keyof typeof AgentCallMode];

/** Returned by ask_* tools when a task is successfully submitted. */
export type TaskStartedContent = {
  taskId: string;
  /** A2A context ID — pass this back on the next ask_* call to resume the same session. */
  contextId: string;
};

export type { TaskStartedWithKeyContent } from "@/lib/task-poller";

/**
 * Structured result collected from a completed A2A task stream.
 * Separates content by type so the UI can render each category appropriately.
 */
export type { CollectedStream, StreamedResult } from "@/lib/a2a-client";

export type {
  TaskCompletedContent,
  TaskStillRunningContent,
  AwaitToolContent,
} from "@/lib/task-poller";

// ─── Agent context store ──────────────────────────────────────────────────────

/** Minimal interface makeAskTool depends on — decoupled from Map<string,string>. */
export interface AgentContextStore {
  get(manifestKey: string): string | undefined;
  set(manifestKey: string, contextId: string): void;
}

// ─── Tool name helpers ────────────────────────────────────────────────────────

/** Returns when the full task result is available */
export const doveAskToolName = (agent: AgentDef) => `ask_${agent.manifestKey}`;
/** Returns as soon as the task is accepted and a taskId is assigned */
export const doveStartToolName = (agent: AgentDef) => `start_${agent.manifestKey}`;
/** Returns when the referenced task completes */
export const doveAwaitToolName = (agent: AgentDef) => `await_${agent.manifestKey}`;
// ─── makeAskTool ──────────────────────────────────────────────────────────────

/**
 * Asks an agent and returns a taskId immediately — agent responds asynchronously.
 * Dove should tell the user what was asked, then call await_* to collect the response.
 */
export function makeAskTool(
  agent: AgentDef,
  signal?: AbortSignal,
  /** Per-Dove-session store of manifestKey → agentContextId. Auto-resumes sessions. */
  contextStore?: AgentContextStore,
  doveDisplayName?: string,
) {
  const orchestratorName = doveDisplayName ?? "Dove";
  return tool(
    doveAskToolName(agent),
    agent.description,
    {
      instruction: z
        .string()
        .describe(
          `Question or query to pose to the agent, synthesized from conversation context. Must open with a self-introduction of the orchestrator, e.g. 'I am ${orchestratorName}, your orchestrator. ' followed by the question or query.`,
        ),
    },
    async ({ instruction }) => {
      const port = resolveAgentPort(agent.manifestKey);
      if (!port) return noServersMessage();
      try {
        const client = await createAgentClient(port);
        const contextId = contextStore?.get(agent.manifestKey);
        const result = await client.sendMessage({
          message: {
            kind: "message",
            messageId: randomUUID(),
            role: "user",
            parts: [
              {
                kind: "text",
                text: withMemoryReminder(
                  instruction,
                  agentPersistentStateDir(agent.name),
                  doveStartToolName(agent),
                ),
              },
            ],
            ...(contextId ? { contextId } : {}),
            metadata: { senderAgentId: "dove", mode: AgentCallMode.Ask },
          },
          configuration: { blocking: false },
        });
        if (result.kind !== "task") {
          return {
            content: [
              { type: "text" as const, text: "Error: task ID not received from agent server." },
            ],
          };
        }
        contextStore?.set(agent.manifestKey, result.contextId);
        signal?.addEventListener(
          "abort",
          () => void client.cancelTask({ id: result.id }).catch(() => {}),
          { once: true },
        );
        const started: TaskStartedContent = { taskId: result.id, contextId: result.contextId };
        return {
          content: [{ type: "text" as const, text: `Task started (taskId: ${result.id})` }],
          structuredContent: started,
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (isConnectionError(msg)) return unreachableMessage(port);
        return { content: [{ type: "text" as const, text: `Error: ${msg}` }] };
      }
    },
  );
}

// ─── makeStartTool ────────────────────────────────────────────────────────────

/**
 * Fires a task on the A2A server and returns a taskId as soon as the task is accepted.
 * Pair with makeAwaitTool to retrieve the result later.
 * Use when an orchestrator needs to start multiple agents concurrently or inform the user right away.
 *
 * `senderAgentId` identifies the caller in A2A task metadata. Defaults to "dove" for Dove's
 * own orchestration. Pass the sub-agent's name when registering this tool for a sub-agent
 * orchestrator's linked agents.
 */
function buildStrategyInstruction(
  instruction: string,
  strategy: AgentLinkStrategy,
  callerName: string,
): string {
  if (strategy === "review") {
    return [
      `REVIEW REQUEST from @${callerName}`,
      `Your entire final response must be ONLY a JSON object — no text before or after it:`,
      `{"decision":"APPROVED"|"REJECTED","reason":"<comprehensive feedback: what is correct, what is missing or wrong, what must change for approval>"}`,
      `In the reason field, address the sender as @${callerName}.`,
      `\nWork for review:\n${instruction}`,
    ].join("\n");
  }
  if (strategy === "escalation") {
    return [
      `ESCALATION from @${callerName}`,
      `Open your response by addressing the sender as @${callerName}.`,
      `\nBlocker:\n${instruction}`,
      `\nPlease provide guidance or make the decision so I can continue.`,
    ].join("\n");
  }
  return instruction;
}

export function makeStartTool(
  agent: AgentDef,
  signal?: AbortSignal,
  backgroundTasks?: Promise<CollectedStream>[],
  registry?: PendingRegistry,
  orchestratorDisplayName?: string,
  stateMachine?: AgentTaskStateMachine,
  senderAgentId: string = "dove",
) {
  const orchestratorName = orchestratorDisplayName ?? "Dove";
  return tool(
    doveStartToolName(agent),
    `Start the ${agent.displayName} agent task and return a taskId immediately without waiting for completion`,
    {
      instruction: z
        .string()
        .describe(
          `Instruction to pass to the agent, synthesized from conversation context. Must open with a self-introduction of the orchestrator, e.g. 'I am ${orchestratorName}, your orchestrator. ' followed by the task instruction.`,
        ),
      strategy: z
        .enum(AGENT_LINK_STRATEGIES)
        .describe(
          `The link strategy for this call: "chat" for peer collaboration or task delegation, "review" for output sign-off (agent responds with JSON {decision, reason}), "escalation" for authority decision when blocked.`,
        ),
      justification: justificationField,
      groupContextId: z
        .string()
        .optional()
        .describe(
          "Provide when starting an additional member within a group task. Use the groupContextId returned by start_group_*. Publishes start/running status to the group context stream so the swimlane header shows the correct animation.",
        ),
    },
    async ({ instruction, strategy, groupContextId }) => {
      const wrappedInstruction = buildStrategyInstruction(instruction, strategy, orchestratorName);
      if (groupContextId) {
        publishSessionEvent(groupContextId, {
          type: "agent_status",
          agentKey: agent.manifestKey,
          id: agent.manifestKey,
          status: "start",
        });
      }
      const result = await new TaskPoller(
        agent.manifestKey,
        agent.displayName,
        signal,
        registry,
        doveAwaitToolName(agent),
        agent.name,
      ).start(withStartReminder(wrappedInstruction, agent.manifestKey), {
        backgroundTasks,
        senderAgentId,
        extraMetadata: { mode: AgentCallMode.Start },
      });
      if (result.structuredContent) {
        stateMachine?.transition(result.structuredContent.taskId, agent.manifestKey, "running");
        if (groupContextId) {
          publishSessionEvent(groupContextId, {
            type: "agent_status",
            agentKey: agent.manifestKey,
            id: result.structuredContent.taskId,
            status: "running",
          });
        }
      }
      return result;
    },
  );
}

// ─── makeAwaitTool ────────────────────────────────────────────────────────────

/**
 * Polls a previously started task for up to TaskPoller's timeout window.
 * Returns the result if the task completes within the window, or a
 * { status: "still_running", taskId } payload if it does not — so Dove
 * can call await_* again with the same taskId instead of starting a new task.
 */
export function makeAwaitTool(
  agent: AgentDef,
  signal?: AbortSignal,
  registry?: PendingRegistry,
  stateMachine?: AgentTaskStateMachine,
) {
  return tool(
    doveAwaitToolName(agent),
    `Await a previously started ${agent.displayName} task. Returns the final result when complete, or { status: "still_running", taskId } if still in progress.`,
    {
      taskId: z.string().describe("The taskId returned by the corresponding start_* or ask_* tool"),
      timeoutMs: z
        .number()
        .int()
        .min(10000)
        .describe(taskRuntime.buildDescription(agent.name, doveAwaitToolName(agent))),
      groupContextId: z
        .string()
        .optional()
        .describe(
          "Provide when this await collects a group member started by start_group_*. The last member completion fires the group `done` event and closes the group SSE session.",
        ),
    },
    async ({ taskId, timeoutMs, groupContextId }) => {
      const result = await new TaskPoller(
        agent.manifestKey,
        agent.displayName,
        signal,
        registry,
        doveAwaitToolName(agent),
        agent.name,
      ).poll(taskId, timeoutMs);
      if (stateMachine) {
        const sc = result.structuredContent;
        if (!sc) {
          stateMachine.transition(taskId, agent.manifestKey, "failed");
        } else if (sc.status === "still_running") {
          stateMachine.transition(taskId, agent.manifestKey, "running");
        } else {
          // "completed" | "canceled" | "failed" | "rejected" — use A2A status directly
          stateMachine.transition(taskId, agent.manifestKey, sc.status);
        }
      }

      // Group-mode cleanup: persist the member's output, publish the agent status
      // to the group context stream, and tick the completion counter registered by
      // start_group_*. When all dispatched members have resolved, publish `done`
      // so the group SSE stream closes.
      if (groupContextId) {
        const sc = result.structuredContent;
        const agentStatus = !sc
          ? "failed"
          : sc.status === "still_running"
            ? "running"
            : sc.status === "completed" || sc.status === "canceled" || sc.status === "rejected"
              ? sc.status
              : "failed";
        publishSessionEvent(groupContextId, {
          type: "agent_status",
          agentKey: agent.manifestKey,
          id: taskId,
          status: agentStatus,
        });
        if (sc && sc.status === "completed" && "result" in sc) {
          setGroupMessage(taskId, sc.result.output ?? "");
          const counter = groupMemberCounters.get(groupContextId);
          if (counter) {
            counter.completed += 1;
            if (counter.completed >= counter.started) {
              publishSessionEvent(groupContextId, { type: "done" });
              setSessionStatus(groupContextId, "done");
              groupMemberCounters.delete(groupContextId);
            }
          }
        }
      }
      return result;
    },
  );
}
