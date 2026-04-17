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
import type { AgentGroup } from "@@/lib/agent-links-schemas";
import { z } from "zod";
import { resolveAgentPort, createAgentClient } from "@/lib/a2a-client";
import type { CollectedStream, ProgressEntry, StreamedResult } from "@/lib/a2a-client";
import {
  TaskPoller,
  noServersMessage,
  unreachableMessage,
  isConnectionError,
} from "@/lib/task-poller";
import type { PendingRegistry } from "@/lib/pending-registry";
import { publishSessionStarted } from "@/lib/group-session-events";
import { startRunScriptToolName } from "@/lib/agent-tools";

// ─── Structured content types ─────────────────────────────────────────────────

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
export type { CollectedStream, ProgressEntry, StreamedResult } from "@/lib/a2a-client";

export type {
  TaskCompletedContent,
  TaskStillRunningContent,
  AwaitToolContent,
} from "@/lib/task-poller";

/** Shape of an MCP CallToolResult as returned in PostToolUseHookInput.tool_response. */
export type ToolResponse<T = Record<string, unknown>> = {
  content?: { type: string; text: string }[];
  structuredContent?: T;
  isError?: boolean;
};

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
/** Slugified group name used as the dynamic `ask_group_*` MCP tool name. */
export const doveAskGroupToolName = (groupName: string) =>
  `ask_group_${groupName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")}`;

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
) {
  return tool(
    doveAskToolName(agent),
    agent.description,
    {
      instruction: z
        .string()
        .describe(
          "Instruction to pass to the agent, synthesized from conversation context. Must open with a self-introduction of the orchestrator, e.g. 'I am Dove, your orchestrator. ' followed by the task instruction.",
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
            parts: [{ kind: "text", text: instruction }],
            ...(contextId ? { contextId } : {}),
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
 * Use when Dove needs to start multiple agents concurrently or inform the user right away.
 */
export function makeStartTool(
  agent: AgentDef,
  signal?: AbortSignal,
  onProgress?: (result: StreamedResult) => void,
  backgroundTasks?: Promise<CollectedStream>[],
  registry?: PendingRegistry,
) {
  return tool(
    doveStartToolName(agent),
    `Start the ${agent.displayName} agent task and return a taskId immediately without waiting for completion`,
    {
      instruction: z
        .string()
        .describe(
          "Instruction to pass to the agent, synthesized from conversation context. Must open with a self-introduction of the orchestrator, e.g. 'I am Dove, your orchestrator. ' followed by the task instruction.",
        ),
    },
    async ({ instruction }) => {
      return await new TaskPoller(
        agent.manifestKey,
        agent.displayName,
        signal,
        registry,
        doveAwaitToolName(agent),
        undefined,
        agent.name,
      ).start(
        `${instruction}\n<reminder>Must call "${startRunScriptToolName(agent.manifestKey)}" tool</reminder>`,
        { onProgress, backgroundTasks },
      );
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
  onProgress?: (result: StreamedResult) => void,
  registry?: PendingRegistry,
) {
  return tool(
    doveAwaitToolName(agent),
    `Await a previously started ${agent.displayName} task. Returns the final result when complete, or { status: "still_running", taskId } if still in progress.`,
    {
      taskId: z.string().describe("The taskId returned by the corresponding start_* or ask_* tool"),
    },
    async ({ taskId }) => {
      return await new TaskPoller(
        agent.manifestKey,
        agent.displayName,
        signal,
        registry,
        doveAwaitToolName(agent),
        undefined,
        agent.name,
      ).poll(taskId, { onProgress });
    },
  );
}

// ─── makeAskGroupTool ─────────────────────────────────────────────────────────

/**
 * Fires the same instruction at multiple members of a group in parallel
 * (fire-and-forget). Returns the started taskIds immediately without polling —
 * members surface their progress through the Group Chat view.
 */
export function makeAskGroupTool(
  group: AgentGroup,
  allAgents: readonly AgentDef[],
  signal?: AbortSignal,
) {
  const memberDefs = group.members
    .map((name) => allAgents.find((a) => a.name === name))
    .filter((a): a is AgentDef => Boolean(a));

  const memberLines = memberDefs.map((a) => `- ${a.name}: ${a.description}`).join("\n");
  const description = [
    `Broadcast a task to selected members of the "${group.name}" group. Fire-and-forget — returns taskIds immediately; do not await.`,
    group.description && `<group-focus>\n${group.description}\n</group-focus>`,
    memberLines && `<members>\n${memberLines}\n</members>`,
    `Pick up to 3 memberIds that best match the user's intent.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return tool(
    doveAskGroupToolName(group.name),
    description,
    {
      memberIds: z
        .array(z.string())
        .min(1)
        .describe("Member agent names to trigger (recommended max 3)"),
      message: z.string().describe("Instruction broadcast to every selected member"),
    },
    async ({ memberIds, message }) => {
      const unknown = memberIds.filter((id) => !group.members.includes(id));
      if (unknown.length > 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: member(s) not in group "${group.name}": ${unknown.join(", ")}`,
            },
          ],
        };
      }

      const results = await Promise.all(
        memberIds.map(async (agentId) => {
          const agent = allAgents.find((a) => a.name === agentId);
          if (!agent) return { agentId, error: "unknown agent" as const };
          const response = await new TaskPoller(agent.manifestKey, agent.displayName, signal).start(
            message,
          );
          if (!response.structuredContent) return { agentId, error: "no taskId" as const };
          publishSessionStarted({ agentId, sessionId: response.structuredContent.contextId });
          return { agentId, taskId: response.structuredContent.taskId };
        }),
      );

      const triggered = results.flatMap((r) => ("taskId" in r ? [r] : []));
      const errors = results.flatMap((r) => ("error" in r ? [r] : []));

      return {
        content: [
          {
            type: "text" as const,
            text: `Triggered ${triggered.length} member(s) in group "${group.name}": ${triggered.map((t) => t.agentId).join(", ")}`,
          },
        ],
        structuredContent: { group: group.name, triggered, errors },
      };
    },
  );
}
