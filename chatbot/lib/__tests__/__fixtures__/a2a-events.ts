/**
 * Shared @a2a-js/sdk v1.0 event fixtures for tests.
 *
 * v1.0 wraps every streamed event in a `StreamResponse` whose concrete payload
 * sits under a `$case` discriminant, and parts carry a `content` oneof. Building
 * those literals by hand in each test is noisy and easy to get subtly wrong, so
 * every A2A test builds its events here.
 */

import {
  Artifact,
  Message,
  Role,
  Task,
  TaskArtifactUpdateEvent,
  TaskState,
  TaskStatusUpdateEvent,
  roleToJSON,
  taskStateToJSON,
} from "@a2a-js/sdk";
import type { A2AStreamEvent } from "@@/lib/a2a-client";

/** An artifact carrying a single text part. */
export function artifact(name: string, text: string): Artifact {
  return Artifact.fromJSON({ artifactId: `artifact-${name}`, name, parts: [{ text }] });
}

/**
 * A bare Task, as returned by sendMessage/getTask. v1.0's SendMessageResult is
 * `Message | Task` with no `kind` discriminant — a Task is identified by `id`.
 */
export function taskResult(
  id: string,
  opts: { state?: TaskState; contextId?: string; artifacts?: Artifact[] } = {},
): Task {
  return {
    ...Task.fromJSON({
      id,
      contextId: opts.contextId ?? "",
      ...(opts.state === undefined ? {} : { status: { state: taskStateToJSON(opts.state) } }),
    }),
    artifacts: opts.artifacts ?? [],
  };
}

/** StreamResponse carrying a Task snapshot. */
export function taskEvent(
  id: string,
  opts: { state?: TaskState; contextId?: string; artifacts?: Artifact[] } = {},
): A2AStreamEvent {
  return { payload: { $case: "task", value: taskResult(id, opts) } };
}

/** StreamResponse carrying a status update. Pass `text` to attach an agent message. */
export function statusEvent(state: TaskState, text?: string): A2AStreamEvent {
  return {
    payload: {
      $case: "statusUpdate",
      value: TaskStatusUpdateEvent.fromJSON({
        taskId: "task-1",
        status: {
          state: taskStateToJSON(state),
          ...(text === undefined
            ? {}
            : { message: { role: roleToJSON(Role.ROLE_AGENT), parts: [{ text }] } }),
        },
      }),
    },
  };
}

/** StreamResponse carrying an artifact update. */
export function artifactEvent(name: string, text: string): A2AStreamEvent {
  return {
    payload: {
      $case: "artifactUpdate",
      value: TaskArtifactUpdateEvent.fromJSON({
        taskId: "task-1",
        artifact: { artifactId: `artifact-${name}`, name, parts: [{ text }] },
      }),
    },
  };
}

/** StreamResponse carrying a bare agent message (never a Task). */
export function messageEvent(text = "hello"): A2AStreamEvent {
  return { payload: { $case: "message", value: messageResult(text) } };
}

/** A bare Message, as returned by sendMessage when the agent replies without a task. */
export function messageResult(text = "hello"): Message {
  return Message.fromJSON({ role: roleToJSON(Role.ROLE_AGENT), parts: [{ text }] });
}

/** Async generator over StreamResponse events, matching the SDK's stream signature. */
export async function* a2aEvents(
  ...events: A2AStreamEvent[]
): AsyncGenerator<A2AStreamEvent, void, undefined> {
  for (const e of events) yield e;
}
