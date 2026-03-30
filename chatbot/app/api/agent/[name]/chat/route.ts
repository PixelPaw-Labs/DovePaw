/**
 * Direct subagent chat route — POST → SSE
 *
 * Resolves the agent's dynamic port from ~/.dovepaw/.ports.json,
 * creates a task on the A2A server, and streams artifact-update events
 * back to the client using the same ChatSseEvent schema as /api/chat.
 *
 * Artifact name → SSE event type mapping (mirrors A2AQueryDispatcher):
 *   "stream"       → { type: "text",      content }
 *   "thinking"     → { type: "thinking",  content }
 *   "tool-call"    → { type: "tool_call", name }
 *   "tool-input"   → { type: "tool_input", content }
 *   "final-output" → { type: "result",    content }
 */

import { randomUUID } from "node:crypto";
import { ClientFactory } from "@a2a-js/sdk/client";
import type { TaskArtifactUpdateEvent, TaskStatusUpdateEvent, Task, Message } from "@a2a-js/sdk";
import type { TextPart } from "@a2a-js/sdk";
import { AGENTS } from "@@/lib/agents";
import { readPortsManifest } from "@/a2a/lib/base-server";
import type { ChatSseEvent } from "@/lib/chat-sse";
import { z } from "zod";

type A2AStreamEvent = Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent;

const TERMINAL_STATES = new Set(["completed", "canceled", "failed", "rejected"]);

const chatRequestSchema = z.object({
  message: z.string(),
  sessionId: z.string().nullable(),
});

export const maxDuration = 86400;

export async function POST(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;

  const agent = AGENTS.find((a) => a.name === name);
  if (!agent) {
    return Response.json({ error: `Agent '${name}' not found` }, { status: 404 });
  }

  const manifest = readPortsManifest();
  if (!manifest) {
    return Response.json(
      { error: "A2A servers not running — start them with: npm run servers" },
      { status: 503 },
    );
  }

  const portValue = (manifest as Record<string, unknown>)[agent.manifestKey];
  if (typeof portValue !== "number") {
    return Response.json(
      { error: `No port found for agent '${name}' — restart servers` },
      { status: 503 },
    );
  }

  const { message } = chatRequestSchema.parse(await request.json());

  const encoder = new TextEncoder();
  const abortController = new AbortController();
  request.signal.addEventListener("abort", () => abortController.abort());

  const readable = new ReadableStream({
    cancel() {
      abortController.abort();
    },
    async start(controller) {
      const send = (payload: ChatSseEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      try {
        const factory = new ClientFactory();
        const client = await factory.createFromUrl(`http://localhost:${portValue}`);

        // Start a new task on the A2A server (non-blocking — we stream separately)
        const result = await client.sendMessage({
          message: {
            kind: "message",
            messageId: randomUUID(),
            role: "user",
            parts: [{ kind: "text", text: message }],
          },
          configuration: { blocking: false },
        });

        if (result.kind !== "task") {
          send({ type: "error", content: "Failed to start agent task" });
          send({ type: "done" });
          return;
        }

        // Emit task ID as the session ID so the client can track it
        send({ type: "session", sessionId: result.id });

        // Stream artifact-update events from the task
        const stream = client.resubscribeTask(
          { id: result.id },
          { signal: abortController.signal },
        ) as AsyncIterable<A2AStreamEvent>;

        for await (const event of stream) {
          if (event.kind === "artifact-update") {
            const texts = event.artifact.parts
              .filter((p): p is TextPart => p.kind === "text")
              .map((p) => p.text);
            const artifactName = event.artifact.name ?? "";

            for (const text of texts) {
              if (artifactName === "stream") {
                send({ type: "text", content: text });
              } else if (artifactName === "thinking") {
                send({ type: "thinking", content: text });
              } else if (artifactName === "tool-call") {
                send({ type: "tool_call", name: text });
              } else if (artifactName === "tool-input") {
                send({ type: "tool_input", content: text });
              } else if (artifactName === "final-output") {
                send({ type: "result", content: text });
              }
            }
          } else if (event.kind === "status-update") {
            if (TERMINAL_STATES.has(event.status.state)) break;
          }
        }

        send({ type: "done" });
      } catch (err: unknown) {
        if (abortController.signal.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        try {
          send({ type: "error", content: msg });
          send({ type: "done" });
        } catch {
          // Stream already closed
        }
      } finally {
        abortController.abort();
        try {
          controller.close();
        } catch {
          // Already closed
        }
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
