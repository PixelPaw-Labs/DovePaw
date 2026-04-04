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

import { readAgentsConfig } from "@@/lib/agents-config";
import { readPortsManifest } from "@/a2a/lib/base-server";
import { makeProgressSender } from "@/lib/chat-sse";
import type { ChatSseEvent } from "@/lib/chat-sse";
import { startAgentStream, collectStreamResult } from "@/lib/a2a-client";
import { SseQueryDispatcher } from "@/lib/query-dispatcher";
import { upsertSession, setActiveSession, deleteSession } from "@/lib/db";
import type { SessionMessage } from "@/lib/message-types";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const chatRequestSchema = z.object({
  message: z.string(),
  sessionId: z.string().nullable(), // contextId from a previous response; null on first message
});

export const maxDuration = 86400;

const activeControllers = new Map<string, AbortController>();

export async function POST(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;

  const agent = (await readAgentsConfig()).find((a) => a.name === name);
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

  const { message, sessionId } = chatRequestSchema.parse(await request.json());

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

      let handle: Awaited<ReturnType<typeof startAgentStream>> = null;
      try {
        handle = await startAgentStream(
          portValue,
          message,
          abortController.signal,
          sessionId ?? undefined,
        );
        if (!handle) {
          send({ type: "error", content: "Failed to start agent task" });
          send({ type: "done" });
          return;
        }
        const { stream, contextId: resolvedContextId } = handle;

        activeControllers.set(resolvedContextId, abortController);
        setActiveSession(agent.name, resolvedContextId);
        send({ type: "session", sessionId: resolvedContextId });

        await collectStreamResult(stream, onSnapshot, onArtifact, (finalResult) => {
          if (abortController.signal.aborted) return;
          const msgs: SessionMessage[] = [
            {
              id: randomUUID(),
              role: "user",
              segments: [{ type: "text", content: message }],
            },
            {
              id: randomUUID(),
              role: "assistant",
              segments: [{ type: "text", content: finalResult.output }],
            },
          ];
          upsertSession({
            contextId: resolvedContextId,
            agentId: agent.name,
            startedAt: new Date().toISOString(),
            label: message.slice(0, 60) || "Session",
            messages: msgs,
            progress: finalResult.progress,
          });
        });

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
        if (handle) activeControllers.delete(handle.contextId);
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

export async function DELETE(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const { sessionId } = z.object({ sessionId: z.string() }).parse(await request.json());

  // Abort in-flight session (if currently streaming)
  activeControllers.get(sessionId)?.abort();

  // Explicitly clear completed session from executor state
  const agent = (await readAgentsConfig()).find((a) => a.name === name);
  const manifest = agent ? readPortsManifest() : null;
  const portValue = manifest ? (manifest as Record<string, unknown>)[agent!.manifestKey] : null;
  if (typeof portValue === "number") {
    await fetch(`http://localhost:${portValue}/session/clear`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contextId: sessionId }),
    }).catch(() => {});
  }
  deleteSession(sessionId);

  return Response.json({ ok: true });
}
