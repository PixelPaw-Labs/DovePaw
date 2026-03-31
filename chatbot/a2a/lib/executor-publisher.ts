import { randomUUID } from "node:crypto";
import type { ExecutionEventBus } from "@a2a-js/sdk/server";

type TaskState = "working" | "completed" | "canceled" | "failed";

/**
 * Typed publish helpers for QueryAgentExecutor.
 *
 *   publishTask    → kind:"task"  state:"submitted"
 *     Must be the first event so ResultManager registers the task in the TaskStore.
 *
 *   publishStatus  → kind:"status-update"
 *     Default state is "working" (non-final). Pass a terminal state
 *     ("completed" | "canceled" | "failed") to emit a final status event.
 *     Pass artifact key/value pairs to emit accompanying artifact-update events.
 *
 *   publishArtifact → kind:"artifact-update"
 *     Use for content that should be surfaced as a named artifact (script progress
 *     messages, error text, final output fragments).
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

  publishStatus(
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
      this.publishArtifact(artifactText, name);
    }
  }

  private publishArtifact(text: string, name: string): void {
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
