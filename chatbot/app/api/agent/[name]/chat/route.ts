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

import { randomUUID } from "node:crypto";
import { AGENTS } from "@@/lib/agents";
import { readPortsManifest } from "@/a2a/lib/base-server";
import type { ChatSseEvent } from "@/lib/chat-sse";
import { createAgentClient, collectStreamResult, type StreamedResult } from "@/lib/a2a-client";
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

      // Delta tracker — same pattern as makeProgressSender in route.ts
      let lastSentCount = 0;
      let lastSentArtifactCount = 0;
      const onSnapshot = (result: StreamedResult) => {
        const newEntries = result.progress.slice(lastSentCount);
        const lastEntry = result.progress.at(-1);
        const artifactCount = lastEntry ? Object.keys(lastEntry.artifacts).length : 0;
        if (newEntries.length > 0) {
          lastSentCount = result.progress.length;
          lastSentArtifactCount = artifactCount;
          send({ type: "progress", result: { output: result.output, progress: newEntries } });
        } else if (lastEntry && artifactCount > lastSentArtifactCount) {
          lastSentArtifactCount = artifactCount;
          send({ type: "progress", result: { output: result.output, progress: [lastEntry] } });
        }
      };

      const dispatcher = new SseQueryDispatcher(send);
      const onArtifact = (artifactName: string, text: string) =>
        dispatcher.onArtifact(artifactName, text);

      try {
        const client = await createAgentClient(portValue);

        const stream = client.sendMessageStream(
          {
            message: {
              kind: "message",
              messageId: randomUUID(),
              role: "user",
              parts: [{ kind: "text", text: message }],
            },
          },
          { signal: abortController.signal },
        );

        const firstEvent = await stream[Symbol.asyncIterator]().next();
        if (firstEvent.done || firstEvent.value.kind !== "task") {
          send({ type: "error", content: "Failed to start agent task" });
          send({ type: "done" });
          return;
        }
        const taskId = firstEvent.value.id;

        abortController.signal.addEventListener(
          "abort",
          () => void client.cancelTask({ id: taskId }).catch(() => {}),
          { once: true },
        );

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
