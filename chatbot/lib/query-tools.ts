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
import { TaskNotFoundError } from "@a2a-js/sdk/client";
import { randomUUID } from "node:crypto";
import type { AgentDef } from "@@/lib/agents";
import { z } from "zod";
import {
  resolveAgentPort,
  createAgentClient,
  startAgentStream,
  subscribeTaskStream,
  collectStreamResult,
  formatAgentStreamContext,
} from "@/lib/a2a-client";
import type { ProgressEntry, StreamedResult } from "@/lib/a2a-client";

// ─── Structured content types ─────────────────────────────────────────────────

/** Returned by ask_* and start_* tools when a task is successfully submitted. */
export type TaskStartedContent = {
  taskId: string;
  /** A2A context ID — pass this back on the next ask_* call to resume the same session. */
  contextId: string;
};

/** Returned by start_* tools (includes manifestKey for agent identification). */
export type TaskStartedWithKeyContent = TaskStartedContent & {
  manifestKey: string;
};

/**
 * Structured result collected from a completed A2A task stream.
 * Separates content by type so the UI can render each category appropriately.
 */
export type { ProgressEntry, StreamedResult } from "@/lib/a2a-client";

/** Returned by await_* when the agent task has reached a terminal state. */
export type TaskCompletedContent = {
  status: "completed" | "canceled" | "failed" | "rejected";
  taskId: string;
  result: StreamedResult;
};

/** Returned by await_* when the poll window expired before the task finished. */
export type TaskStillRunningContent = {
  status: "still_running";
  taskId: string;
};

/** Union of all possible await_* structured content payloads. */
export type AwaitToolContent = TaskCompletedContent | TaskStillRunningContent;

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

// ─── Pending task registry ────────────────────────────────────────────────────

export function markTaskPending(set: Set<string>, taskId: string): void {
  set.add(taskId);
}

export function markTaskResolved(set: Set<string>, taskId: string): void {
  set.delete(taskId);
}

export function hasPendingTasks(set: Set<string>): boolean {
  return set.size > 0;
}

export function getPendingTaskIds(set: Set<string>): string[] {
  return [...set];
}

// ─── Tool name helpers ────────────────────────────────────────────────────────

/** Returns when the full task result is available */
export const doveAskToolName = (agent: AgentDef) => `ask_${agent.manifestKey}`;
/** Returns as soon as the task is accepted and a taskId is assigned */
export const doveStartToolName = (agent: AgentDef) => `start_${agent.manifestKey}`;
/** Returns when the referenced task completes */
export const doveAwaitToolName = (agent: AgentDef) => `await_${agent.manifestKey}`;

// ─── Shared helpers ───────────────────────────────────────────────────────────

function noServersMessage() {
  return {
    content: [
      {
        type: "text" as const,
        text: "⚠️ A2A servers are not running. Start them with: **npm run chatbot:servers**",
      },
    ],
  };
}

function unreachableMessage(port: number | string) {
  return {
    content: [
      {
        type: "text" as const,
        text: `⚠️ Agent server on port ${port} is unreachable.\nRestart servers: **npm run chatbot:servers**`,
      },
    ],
  };
}

function isConnectionError(msg: string) {
  return msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND");
}

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
  backgroundTasks?: Promise<unknown>[],
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
      const port = resolveAgentPort(agent.manifestKey);
      if (!port) return noServersMessage();
      try {
        // Use startAgentStream so the EventQueue is created before execute() runs —
        // this captures workspace/setup events that fire synchronously during execute()
        // before any resubscribeTask connection could be opened.
        const handle = await startAgentStream(port, instruction, signal);
        if (!handle) {
          return {
            content: [
              { type: "text" as const, text: "Error: task ID not received from agent server." },
            ],
          };
        }
        const { taskId, contextId, stream } = handle;

        // Continue consuming the stream in the background, forwarding events via onProgress.
        if (onProgress) {
          const task = collectStreamResult(stream, onProgress).catch(() => {});
          backgroundTasks?.push(task);
        }

        const started: TaskStartedWithKeyContent = {
          taskId,
          contextId,
          manifestKey: agent.manifestKey,
        };
        return {
          content: [
            {
              type: "text" as const,
              text: `Task started (taskId: ${taskId}, contextId: ${contextId})`,
            },
          ],
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

// ─── makeAwaitTool ────────────────────────────────────────────────────────────

/** How long to wait for task completion before returning a still_running status. */
const AWAIT_POLL_TIMEOUT_MS = 30_000;

/**
 * Polls a previously started task for up to AWAIT_POLL_TIMEOUT_MS.
 * Returns the result if the task completes within the window, or a
 * { status: "still_running", taskId } payload if it does not — so Dove
 * can call await_* again with the same taskId instead of starting a new task.
 */
export function makeAwaitTool(
  agent: AgentDef,
  signal?: AbortSignal,
  onProgress?: (result: StreamedResult) => void,
  pendingTaskSet?: Set<string>,
) {
  return tool(
    doveAwaitToolName(agent),
    `Await a previously started ${agent.displayName} task. Returns the final result when complete, or { status: "still_running", taskId } if still in progress.`,
    {
      taskId: z.string().describe("The taskId returned by the corresponding start_* or ask_* tool"),
    },
    async ({ taskId }) => {
      const port = resolveAgentPort(agent.manifestKey);
      if (!port) return noServersMessage();
      try {
        const client = await createAgentClient(port);

        // Always collect via resubscribeTask — InMemoryTaskStore does not populate
        // task.artifacts from artifact-update events, so getTask returns empty
        // artifacts for fast tasks (e.g. resumed sessions). The stream replay log
        // always has the full output regardless of terminal state.
        // Collect output for up to AWAIT_POLL_TIMEOUT_MS,
        // then return still_running so Dove retries instead of spawning a new task.
        let latestSnapshot: StreamedResult | undefined;
        const timeoutAc = new AbortController();
        const timeoutResult = Symbol("timeout");
        const timer = setTimeout(() => timeoutAc.abort(), AWAIT_POLL_TIMEOUT_MS);
        const result = await Promise.race([
          subscribeTaskStream(client, taskId, signal, (snapshot) => {
            latestSnapshot = snapshot;
            onProgress?.(snapshot);
          }).finally(() => clearTimeout(timer)),
          new Promise<typeof timeoutResult>((resolve) =>
            timeoutAc.signal.addEventListener("abort", () => resolve(timeoutResult), {
              once: true,
            }),
          ),
        ]);

        if (result === timeoutResult) {
          if (pendingTaskSet) markTaskPending(pendingTaskSet, taskId);
          const progressLines: string[] = ["Agent is still working..."];
          const lastArtifacts = latestSnapshot?.progress.at(-1)?.artifacts ?? {};
          const lastToolCall = lastArtifacts["tool-call"];
          const streamBuffer = lastArtifacts["stream"] ?? "";
          if (lastToolCall) progressLines.push(`  Running: ${lastToolCall}`);
          if (streamBuffer) {
            const tail = streamBuffer.trim().slice(-200);
            progressLines.push(`  Latest output: …${tail}`);
          }
          const stillRunning: TaskStillRunningContent = { status: "still_running", taskId };
          return {
            content: [{ type: "text" as const, text: progressLines.join("\n") }],
            structuredContent: stillRunning,
          };
        }

        if (pendingTaskSet) markTaskResolved(pendingTaskSet, taskId);
        const completed: TaskCompletedContent = {
          status: "completed",
          taskId: result.taskId ?? taskId,
          result: result.result,
        };
        const formatted = formatAgentStreamContext(
          {
            state: "completed",
            contextId: result.taskId ?? taskId,
            response: result.result.output,
            thinking: result.result.thinking ?? "",
            toolCalls: result.result.toolCalls ?? [],
          },
          agent.displayName,
        );
        return {
          content: [{ type: "text" as const, text: formatted }],
          structuredContent: completed,
        };
      } catch (err: unknown) {
        if (err instanceof TaskNotFoundError) {
          return {
            content: [
              {
                type: "text" as const,
                text: `⚠️ Task \`${taskId}\` not found — it may have expired or the server restarted.`,
              },
            ],
          };
        }
        const msg = err instanceof Error ? err.message : String(err);
        if (isConnectionError(msg)) return unreachableMessage(port);
        return { content: [{ type: "text" as const, text: `Error: ${msg}` }] };
      }
    },
  );
}
