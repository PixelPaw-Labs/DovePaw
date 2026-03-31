import { randomUUID } from "node:crypto";
import type { ExecutionEventBus } from "@a2a-js/sdk/server";

type TaskState = "working" | "completed" | "canceled" | "failed";

/**
 * Typed publish helpers for QueryAgentExecutor.
 *
 *   publishTask     → kind:"task"  state:"submitted"
 *     Must be the first event so ResultManager registers the task in the TaskStore.
 *
 *   publishStatusToUI   → kind:"status-update"  (optionally + artifact-update events)
 *     Creates a workflow ProgressEntry node visible in the UI's workflow view.
 *     Use for structural milestones: tool calls, completion, errors.
 *     Default state is "working"; pass a terminal state to close the task.
 *     Optional artifacts map emits accompanying artifact-update events.
 *
 *   send            → kind:"artifact-update"  (no status-update)
 *     Does NOT create a workflow node — use for transient streaming content
 *     (text deltas, thinking, tool input) that should only appear in the chat
 *     bubble, not as a step in the workflow view.
 */
export class ExecutorPublisher {
  constructor(
    private readonly eventBus: ExecutionEventBus,
    private readonly taskId: string,
    private readonly contextId: string,
  ) {}

  publishTask(): void {
    this.eventBus.publish({
      kind: "task",
      id: this.taskId,
      contextId: this.contextId,
      status: { state: "submitted", timestamp: new Date().toISOString() },
      history: [],
    });
  }

  publishStatusToUI(
    text: string,
    artifacts?: Record<string, string>,
    state: TaskState = "working",
  ): void {
    const isFinal = state !== "working";
    this.eventBus.publish({
      kind: "status-update",
      taskId: this.taskId,
      contextId: this.contextId,
      status: isFinal
        ? { state, timestamp: new Date().toISOString() }
        : {
            state,
            timestamp: new Date().toISOString(),
            message: {
              kind: "message",
              messageId: randomUUID(),
              role: "agent",
              parts: [{ kind: "text", text }],
            },
          },
      final: isFinal,
    });
    for (const [name, artifactText] of Object.entries(artifacts ?? {})) {
      this.send(artifactText, name);
    }
  }

  send(text: string, name: string): void {
    this.eventBus.publish({
      kind: "artifact-update",
      taskId: this.taskId,
      contextId: this.contextId,
      artifact: {
        artifactId: randomUUID(),
        name,
        parts: [{ kind: "text", text }],
      },
    });
  }
}
