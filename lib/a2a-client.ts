/**
 * Low-level A2A streaming client helpers — no chatbot dependencies.
 * Shared by lib/a2a-trigger.ts and chatbot/lib/a2a-client.ts.
 *
 *   createAgentClient  — create A2A Client for a port
 *   startAgentStream   — open sendMessageStream, extract taskId, wire abort
 */

import { Agent, setGlobalDispatcher } from "undici";
import { ClientFactory } from "@a2a-js/sdk/client";
import type { Client } from "@a2a-js/sdk/client";
import { randomUUID } from "node:crypto";
import { CancelTaskRequest, SendMessageRequest } from "@a2a-js/sdk";
import type { StreamResponse } from "@a2a-js/sdk";

/**
 * undici's default headersTimeout/bodyTimeout is 5 min. Both A2A SSE streams
 * and Anthropic API streaming responses can be silent for far longer while a
 * blocking MCP tool runs (e.g. await_script_* with a multi-minute timeoutMs),
 * which would otherwise trip `SocketError: terminated` mid-stream. Disable
 * both timeouts process-wide so any long-idle fetch survives.
 */
setGlobalDispatcher(new Agent({ bodyTimeout: 0, headersTimeout: 0 }));

/**
 * A single event from an A2A stream. Since SDK v1.0 this is the protobuf
 * `StreamResponse` wrapper — the concrete event sits under `payload.$case`.
 */
export type A2AStreamEvent = StreamResponse;

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
    SendMessageRequest.fromJSON({
      message: {
        messageId: randomUUID(),
        role: "ROLE_USER",
        parts: [{ text: message }],
        ...(contextId ? { contextId } : {}),
        ...(metadata ? { metadata } : {}),
      },
    }),
    { signal: ac.signal },
  );

  const firstEvent = await stream[Symbol.asyncIterator]().next();
  if (firstEvent.done || firstEvent.value.payload?.$case !== "task") {
    return null;
  }
  const task = firstEvent.value.payload.value;
  const taskId = task.id;
  const resolvedContextId = task.contextId || taskId;

  signal?.addEventListener(
    "abort",
    () => void client.cancelTask(CancelTaskRequest.fromJSON({ id: taskId })).catch(() => {}),
    { once: true },
  );

  return { client, taskId, contextId: resolvedContextId, stream };
}
