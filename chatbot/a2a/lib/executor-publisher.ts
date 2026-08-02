import { randomUUID } from "node:crypto";
import { AgentEvent } from "@a2a-js/sdk/server";
import type { ExecutionEventBus } from "@a2a-js/sdk/server";
import {
  Role,
  Task,
  TaskArtifactUpdateEvent,
  TaskState,
  TaskStatusUpdateEvent,
  roleToJSON,
  taskStateToJSON,
} from "@a2a-js/sdk";

/** Publishable lifecycle states, in DovePaw's internal vocabulary. */
type PublishState = "working" | "completed" | "canceled" | "failed";

const PUBLISH_STATES: Record<PublishState, TaskState> = {
  working: TaskState.TASK_STATE_WORKING,
  completed: TaskState.TASK_STATE_COMPLETED,
  canceled: TaskState.TASK_STATE_CANCELED,
  failed: TaskState.TASK_STATE_FAILED,
};

/**
 * Typed publish helpers for QueryAgentExecutor.
 *
 *   publishTask     → AgentEvent.task  state:submitted
 *     Must be the first event so ResultManager registers the task in the TaskStore.
 *
 *   publishStatusToUI   → AgentEvent.statusUpdate  (optionally + artifactUpdate events)
 *     Creates a workflow ProgressEntry node visible in the UI's workflow view.
 *     Use for structural milestones: tool calls, completion, errors.
 *     Default state is "working"; pass a terminal state to close the task.
 *     Optional artifacts map emits accompanying artifactUpdate events.
 *
 *   send            → AgentEvent.artifactUpdate  (no statusUpdate)
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
    this.eventBus.publish(
      AgentEvent.task(
        Task.fromJSON({
          id: this.taskId,
          contextId: this.contextId,
          status: {
            state: taskStateToJSON(TaskState.TASK_STATE_SUBMITTED),
            timestamp: new Date().toISOString(),
          },
        }),
      ),
    );
  }

  publishStatusToUI(
    text: string,
    artifacts?: Record<string, string>,
    state: PublishState = "working",
  ): void {
    const isFinal = state !== "working";
    this.eventBus.publish(
      AgentEvent.statusUpdate(
        TaskStatusUpdateEvent.fromJSON({
          taskId: this.taskId,
          contextId: this.contextId,
          status: {
            state: taskStateToJSON(PUBLISH_STATES[state]),
            timestamp: new Date().toISOString(),
            // A terminal update closes the task and carries no progress text.
            ...(isFinal
              ? {}
              : {
                  message: {
                    messageId: randomUUID(),
                    contextId: this.contextId,
                    role: roleToJSON(Role.ROLE_AGENT),
                    parts: [{ text }],
                  },
                }),
          },
        }),
      ),
    );
    for (const [name, artifactText] of Object.entries(artifacts ?? {})) {
      this.send(artifactText, name);
    }
  }

  send(text: string, name: string): void {
    this.eventBus.publish(
      AgentEvent.artifactUpdate(
        TaskArtifactUpdateEvent.fromJSON({
          taskId: this.taskId,
          contextId: this.contextId,
          artifact: { artifactId: randomUUID(), name, parts: [{ text }] },
        }),
      ),
    );
  }
}
