/**
 * TaskPoller — shared A2A start/poll logic for MCP await tools.
 *
 * Owns port resolution, error handling, the start → stream-drain cycle, and
 * the poll → timeout race. Used by both Dove (makeStartTool / makeAwaitTool)
 * and subagents (makeStartChatToTool / makeAwaitChatToTool).
 *
 * Callers pass registry + awaitTool; TaskPoller handles all registration and
 * resolution internally so pending-state logic is never duplicated.
 */

import { TaskNotFoundError } from "@a2a-js/sdk/client";
import {
  resolveAgentPort,
  createAgentClient,
  startAgentStream,
  subscribeTaskStream,
  streamCollect,
  formatAgentStreamContext,
  noAgentOutput,
} from "@/lib/a2a-client";
import type { CollectedStream, StreamedResult } from "@/lib/a2a-client";
import type { PendingRegistry } from "@/lib/pending-registry";
import { taskRuntime } from "@/lib/task-runtime";

// ─── Content types ────────────────────────────────────────────────────────────

/** Returned by start_* tools when a task is successfully submitted. */
export type TaskStartedWithKeyContent = {
  taskId: string;
  contextId: string;
  manifestKey: string;
};

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

/** Return shape of TaskPoller.start — structuredContent is present only on success. */
export type StartToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: TaskStartedWithKeyContent;
};

/** Return shape of TaskPoller.poll — structuredContent is present only on completion or still-running. */
export type PollToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: AwaitToolContent;
};

// ─── Error response helpers (shared with makeAskTool etc.) ───────────────────

export function noServersMessage() {
  return {
    content: [
      {
        type: "text" as const,
        text: "⚠️ A2A servers are not running. Start them with: **npm run chatbot:servers**",
      },
    ],
  };
}

export function unreachableMessage(port: number | string) {
  return {
    content: [
      {
        type: "text" as const,
        text: `⚠️ Agent server on port ${port} is unreachable.\nRestart servers: **npm run chatbot:servers**`,
      },
    ],
  };
}

export function isConnectionError(msg: string) {
  return msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND");
}

// ─── TaskPoller ───────────────────────────────────────────────────────────────

export class TaskPoller {
  constructor(
    private readonly manifestKey: string,
    private readonly displayName: string,
    private readonly signal?: AbortSignal,
    private readonly registry?: PendingRegistry,
    private readonly awaitTool?: string,
    private readonly agentName?: string,
  ) {}

  /**
   * Starts an A2A task and returns a taskId immediately.
   * Drains (and optionally forwards) the initial stream in the background.
   * When registry + awaitTool are provided, registers the task as pending immediately.
   */
  async start(
    instruction: string,
    {
      contextId,
      backgroundTasks,
      senderAgentId,
      extraMetadata,
    }: {
      contextId?: string;
      backgroundTasks?: Promise<CollectedStream>[];
      senderAgentId?: string;
      extraMetadata?: Record<string, unknown>;
    } = {},
  ): Promise<StartToolResult> {
    const port = resolveAgentPort(this.manifestKey);
    if (!port) return noServersMessage();
    try {
      // Use startAgentStream so the EventQueue is created before execute() runs —
      // this captures workspace/setup events that fire synchronously during execute()
      // before any resubscribeTask connection could be opened.
      const handle = await startAgentStream(
        port,
        instruction,
        this.signal,
        contextId,
        senderAgentId,
        extraMetadata,
      );
      if (!handle) {
        return {
          content: [
            { type: "text" as const, text: "Error: task ID not received from agent server." },
          ],
        };
      }
      const { taskId, contextId: sessionContextId, stream } = handle;
      taskRuntime.start(taskId);
      const { registry, awaitTool } = this;
      if (registry && awaitTool) registry.register({ awaitTool, idKey: "taskId", id: taskId });

      // Always drain to avoid stalling the EventQueue.
      // Returns CollectedStream so callers that track backgroundTasks can read the final output.
      const drainTask = (async (): Promise<CollectedStream> => {
        let out: CollectedStream = {
          result: { output: noAgentOutput(this.agentName), progress: [] },
        };
        for await (const event of streamCollect(stream)) {
          if (event.kind === "snapshot") {
            out = { taskId: event.taskId, result: event.result };
          }
        }
        return out;
      })();
      if (backgroundTasks) {
        backgroundTasks.push(drainTask); // Promise.allSettled at call site absorbs rejections
      } else {
        void drainTask.catch(() => {}); // suppress unhandled rejection when not tracked
      }

      const started: TaskStartedWithKeyContent = {
        taskId,
        contextId: sessionContextId,
        manifestKey: this.manifestKey,
      };
      return {
        content: [
          {
            type: "text" as const,
            text: `${this.displayName} started (taskId: ${taskId}, contextId: ${sessionContextId})`,
          },
        ],
        structuredContent: started,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isConnectionError(msg)) return unreachableMessage(port);
      return { content: [{ type: "text" as const, text: `Error: ${msg}` }] };
    }
  }

  /**
   * Polls a previously started task for up to timeoutMs.
   * Returns the result when complete, or { status: "still_running" } on timeout
   * so the caller can retry with the same taskId.
   * When registry + awaitTool are provided, re-registers on still_running and
   * resolves on completion (or TaskNotFoundError).
   */
  async poll(taskId: string, timeoutMs: number): Promise<PollToolResult> {
    const { registry, awaitTool } = this;
    const port = resolveAgentPort(this.manifestKey);
    if (!port) {
      registry?.resolve(taskId);
      return noServersMessage();
    }
    try {
      const client = await createAgentClient(port);

      // Always collect via resubscribeTask. For a still-running task this streams
      // live events; for an already-completed task the A2A SDK yields only the Task
      // snapshot — streamCollect extracts the output from task.artifacts, which
      // ResultManager populated during execution.
      let out: CollectedStream = {
        result: { output: noAgentOutput(this.agentName), progress: [] },
      };

      const subscribeGen = subscribeTaskStream(client, taskId, this.signal, this.agentName);
      const timeoutAc = new AbortController();
      const timeoutResult = Symbol("timeout");
      const timer = setTimeout(() => timeoutAc.abort(), timeoutMs);

      const streamDone = (async () => {
        for await (const event of subscribeGen) {
          if (event.kind === "snapshot") {
            out = { taskId: event.taskId, result: event.result };
          }
        }
        return out;
      })().finally(() => clearTimeout(timer));

      const result: CollectedStream | typeof timeoutResult = await Promise.race([
        streamDone,
        new Promise<typeof timeoutResult>((resolve) =>
          timeoutAc.signal.addEventListener("abort", () => resolve(timeoutResult), { once: true }),
        ),
      ]);

      if (result === timeoutResult) {
        void subscribeGen.return(undefined); // stop generator and clean up
        // Re-affirm task is still in-flight — idempotent Map.set, semantically explicit.
        if (registry && awaitTool) registry.register({ awaitTool, idKey: "taskId", id: taskId });
        const stillRunning: TaskStillRunningContent = { status: "still_running", taskId };
        return {
          content: [{ type: "text" as const, text: "still_running" }],
          structuredContent: stillRunning,
        };
      }

      const resolvedTaskId = result.taskId ?? taskId;
      registry?.resolve(taskId);
      const completed: TaskCompletedContent = {
        status: result.result.finalState ?? (this.signal?.aborted ? "canceled" : "failed"),
        taskId: resolvedTaskId,
        result: result.result,
      };
      if (this.agentName && this.awaitTool && completed.status === "completed") {
        taskRuntime.record(taskId, this.agentName, this.awaitTool);
      }
      return {
        content: [
          {
            type: "text" as const,
            text: formatAgentStreamContext(result.result, resolvedTaskId, this.displayName),
          },
        ],
        structuredContent: completed,
      };
    } catch (err: unknown) {
      if (err instanceof TaskNotFoundError) {
        // Task is gone and can never resolve — clear the registry entry so the
        // Stop hook doesn't keep blocking on an ID that will never complete.
        registry?.resolve(taskId);
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
      registry?.resolve(taskId);
      if (isConnectionError(msg)) return unreachableMessage(port);
      return { content: [{ type: "text" as const, text: `Error: ${msg}` }] };
    }
  }
}
