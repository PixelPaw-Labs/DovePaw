import { randomUUID } from "node:crypto";
import type { ExecutionEventBus } from "@a2a-js/sdk/server";

/**
 * Typed publish helpers for QueryAgentExecutor.
 *
 *   publishStatus  → kind:"status-update"  state:"working"
 *     Use for transient infrastructure progress (workspace creation, repo cloning).
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

  publishStatus(text: string): void {
    this.eventBus.publish({
      kind: "status-update",
      taskId: this.taskId,
      contextId: this.contextId,
      status: {
        state: "working",
        timestamp: new Date().toISOString(),
        message: {
          kind: "message",
          messageId: randomUUID(),
          role: "agent",
          parts: [{ kind: "text", text }],
        },
      },
      final: false,
    });
  }

  publishArtifact(text: string, name: string): void {
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
