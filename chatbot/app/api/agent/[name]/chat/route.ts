/**
 * Direct subagent chat route — POST → SSE
 *
 * Uses sendMessageStream + collectStreamResult (same as makeStartTool / main route)
 * so workspace/setup events are captured from the very start.
 *
 * collectStreamResult handles:
 *   onSnapshot  → workflow progress SSE (delta tracking)
 *   onArtifact  → chat SSE (text/thinking/tool_call/result)
 */

import { AGENTS } from "@@/lib/agents";
import { readPortsManifest } from "@/a2a/lib/base-server";
import { makeProgressSender } from "@/lib/chat-sse";
import type { ChatSseEvent } from "@/lib/chat-sse";
import { startAgentStream, collectStreamResult } from "@/lib/a2a-client";
import { SseQueryDispatcher } from "@/lib/query-dispatcher";
import { z } from "zod";

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

      const onSnapshot = makeProgressSender(send);

      const dispatcher = new SseQueryDispatcher(send);
      const onArtifact = (artifactName: string, text: string) =>
        dispatcher.onArtifact(artifactName, text);

      try {
        const handle = await startAgentStream(portValue, message, abortController.signal);
        if (!handle) {
          send({ type: "error", content: "Failed to start agent task" });
          send({ type: "done" });
          return;
        }
        const { taskId, stream } = handle;

        send({ type: "session", sessionId: taskId });

        await collectStreamResult(stream, onSnapshot, onArtifact);

        if (abortController.signal.aborted) {
          send({ type: "cancelled" });
        } else {
          send({ type: "done" });
        }
      } catch (err: unknown) {
        if (abortController.signal.aborted) {
          try {
            send({ type: "cancelled" });
          } catch {
            /* stream closed */
          }
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        try {
          send({ type: "error", content: msg });
          send({ type: "done" });
        } catch {
          /* stream already closed */
        }
      } finally {
        abortController.abort();
        try {
          controller.close();
        } catch {
          /* already closed */
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
