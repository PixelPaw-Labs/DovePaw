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

import consola from "consola";
import { readAgentsConfig } from "@@/lib/agents-config";
import { readPortsManifest } from "@/a2a/lib/ports-manifest";
import { makeProgressSender, buildStreamSender } from "@/lib/chat-sse";
import { createSseResponse } from "@/lib/sse-response";
import { startAgentStream, streamCollect, resolveAgentPort } from "@/lib/a2a-client";
import { SseQueryDispatcher } from "@/lib/query-dispatcher";
import { subscribeSession } from "@/lib/session-events";
import { deleteSession, setSessionStatus, getSessionWorkspacePath } from "@/lib/db";
import { restoreAgentWorkspace } from "@/a2a/lib/workspace";
import { z } from "zod";

const chatRequestSchema = z.object({
  message: z.string(),
  sessionId: z.string().nullable(), // contextId from a previous response; null on first message
  senderAgentId: z.string().optional(),
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

  const { message, sessionId, senderAgentId } = chatRequestSchema.parse(await request.json());

  const subprocessController = new AbortController();
  return createSseResponse(
    request,
    subprocessController,
    async (controller, _connectionController) => {
      // Subprocess lifetime is decoupled from the browser connection — same pattern as the
      // Dove route. Client disconnect (new session, page switch) only closes the SSE stream;
      // the A2A task keeps running and buffers events for reconnect.
      // Explicit cancellation goes through DELETE with { method: "stop" }.

      // Dual-publish: send every event to the browser SSE stream AND to the in-memory
      // session event bus so /api/chat/stream/[sessionId] can serve reconnecting clients.
      const send = buildStreamSender("high", controller);
      const dispatcher = new SseQueryDispatcher(send);
      const onSnapshot = makeProgressSender(dispatcher.publish);
      const onArtifact = (artifactName: string, text: string) =>
        dispatcher.onArtifact(artifactName, text);

      let handle: Awaited<ReturnType<typeof startAgentStream>> = null;
      try {
        handle = await startAgentStream(
          portValue,
          message,
          subprocessController.signal,
          sessionId ?? undefined,
          undefined,
          { directUserChat: true },
        );
        if (!handle) {
          send({ type: "error", content: "Failed to start agent task" });
          send({ type: "done" });
          return;
        }
        const { stream, contextId: resolvedContextId } = handle;

        activeControllers.set(resolvedContextId, subprocessController);
        dispatcher.onSession(resolvedContextId);

        // Forward permission events from the session bus to the live browser SSE connection.
        // These arrive via POST /api/internal/subagent-permission from the A2A process.
        subscribeSession(
          resolvedContextId,
          (event) => {
            if (event.type === "permission") {
              try {
                send(event);
              } catch {
                /* stream already closed */
              }
            }
          },
          subprocessController.signal,
        );

        dispatcher.enableIncrementalSave({
          sessionId: resolvedContextId,
          agentId: name,
          label: message.slice(0, 60) || "Session",
          userMsgId: crypto.randomUUID(),
          userText: message,
          senderAgentId,
        });

        for await (const event of streamCollect(stream)) {
          if (event.kind === "snapshot") onSnapshot(event.result);
          else if (event.kind === "chunk") onArtifact(event.name, event.text);
        }

        if (subprocessController.signal.aborted) {
          setSessionStatus(resolvedContextId, "cancelled");
          dispatcher.publish({ type: "cancelled" });
        } else {
          setSessionStatus(resolvedContextId, "done");
          const finalContent = dispatcher.buildFinalContent();
          dispatcher.publish(
            finalContent ? { type: "done", content: finalContent } : { type: "done" },
          );
        }
      } catch (err) {
        if (subprocessController.signal.aborted) {
          if (handle) setSessionStatus(handle.contextId, "cancelled");
          try {
            dispatcher.publish({ type: "cancelled" });
          } catch {
            /* stream closed */
          }
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        consola.error("Error in agent chat stream:", msg);
        if (handle) setSessionStatus(handle.contextId, "done");
        try {
          dispatcher.publish({ type: "error", content: msg });
          dispatcher.publish({ type: "done" });
        } catch {
          /* stream already closed */
        }
      } finally {
        if (handle) activeControllers.delete(handle.contextId);
      }
    },
  );
}

export async function DELETE(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const { sessionId, method } = z
    .object({ sessionId: z.string(), method: z.enum(["stop", "delete"]).default("delete") })
    .parse(await request.json());

  // Abort in-flight session subprocess (if currently running)
  activeControllers.get(sessionId)?.abort();

  if (method === "stop") {
    // User-initiated cancel: keep session in history, mark as cancelled
    setSessionStatus(sessionId, "cancelled");
    return Response.json({ ok: true });
  }

  // "delete" mode: remove from A2A executor state, DB, and workspace directory
  const workspacePath = getSessionWorkspacePath(sessionId);

  const agent = (await readAgentsConfig()).find((a) => a.name === name);
  if (agent) {
    const portValue = resolveAgentPort(agent.manifestKey);
    if (portValue !== null) {
      await fetch(`http://localhost:${portValue}/session/clear`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contextId: sessionId }),
      }).catch(() => {});
    }
  }
  await deleteSession(sessionId);
  if (workspacePath) await restoreAgentWorkspace(workspacePath).cleanup();

  return Response.json({ ok: true });
}
