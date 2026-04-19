/**
 * Low-level A2A streaming client helpers — no chatbot dependencies.
 * Shared by lib/a2a-trigger.ts and chatbot/lib/a2a-client.ts.
 *
 *   createAgentClient  — create A2A Client for a port
 *   startAgentStream   — open sendMessageStream, extract taskId, wire abort
 */

import { randomUUID } from "node:crypto";
import { ClientFactory } from "@a2a-js/sdk/client";
import type { Client } from "@a2a-js/sdk/client";
import type { Task, Message, TaskStatusUpdateEvent, TaskArtifactUpdateEvent } from "@a2a-js/sdk";

export type A2AStreamEvent = Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent;

export type AgentStreamHandle = {
  client: Client;
  taskId: string;
  contextId: string;
  stream: AsyncGenerator<A2AStreamEvent, void, undefined>;
};

/** Create A2A client for the given port. Throws on connection failure. */
export async function createAgentClient(port: number): Promise<Client> {
  return new ClientFactory().createFromUrl(`http://localhost:${port}`);
}

/**
 * Opens a sendMessageStream, reads the first event to extract the taskId,
 * and wires signal → stream abort + task cancellation.
 * Returns null if the server did not return a task event as the first event.
 */
export async function startAgentStream(
  port: number,
  message: string,
  signal?: AbortSignal,
  contextId?: string,
  senderAgentId?: string,
  extraMetadata?: Record<string, unknown>,
): Promise<AgentStreamHandle | null> {
  const client = await createAgentClient(port);
  const ac = new AbortController();
  signal?.addEventListener("abort", () => ac.abort(), { once: true });

  const metadata =
    senderAgentId || extraMetadata
      ? { ...(senderAgentId ? { senderAgentId } : {}), ...extraMetadata }
      : undefined;

  const stream = client.sendMessageStream(
    {
      message: {
        kind: "message",
        messageId: randomUUID(),
        role: "user",
        parts: [{ kind: "text", text: message }],
        ...(contextId ? { contextId } : {}),
        ...(metadata ? { metadata } : {}),
      },
    },
    { signal: ac.signal },
  ) as AsyncGenerator<A2AStreamEvent, void, undefined>;

  const firstEvent = await stream[Symbol.asyncIterator]().next();
  if (firstEvent.done || firstEvent.value.kind !== "task") {
    return null;
  }
  const taskId = firstEvent.value.id;
  const resolvedContextId = firstEvent.value.contextId ?? taskId;

  signal?.addEventListener("abort", () => void client.cancelTask({ id: taskId }).catch(() => {}), {
    once: true,
  });

  return { client, taskId, contextId: resolvedContextId, stream };
}
