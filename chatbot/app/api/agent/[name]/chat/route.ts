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
import { readPortsManifest } from "@/a2a/lib/ports-manifest";
import { makeProgressSender } from "@/lib/chat-sse";
import { createSseResponse } from "@/lib/sse-response";
import { startAgentStream, collectStreamResult, resolveAgentPort } from "@/lib/a2a-client";
import { SseQueryDispatcher } from "@/lib/query-dispatcher";
import { deleteSession, setSessionStatus, getSessionWorkspacePath } from "@/lib/db";
import { restoreAgentWorkspace } from "@/a2a/lib/workspace";
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

  const subprocessController = new AbortController();
  return createSseResponse(request, subprocessController, async (send, _connectionController) => {
    // Subprocess lifetime is decoupled from the browser connection — same pattern as the
    // Dove route. Client disconnect (new session, page switch) only closes the SSE stream;
    // the A2A task keeps running and buffers events for reconnect.
    // Explicit cancellation goes through DELETE with { method: "stop" }.

    // Dual-publish: send every event to the browser SSE stream AND to the in-memory
    // session event bus so /api/chat/stream/[sessionId] can serve reconnecting clients.
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
      );
      if (!handle) {
        send({ type: "error", content: "Failed to start agent task" });
        send({ type: "done" });
        return;
      }
      const { stream, contextId: resolvedContextId } = handle;

      activeControllers.set(resolvedContextId, subprocessController);
      dispatcher.onSession(resolvedContextId);

      dispatcher.enableIncrementalSave({
        sessionId: resolvedContextId,
        agentId: name,
        label: message.slice(0, 60) || "Session",
        userMsgId: crypto.randomUUID(),
        userText: message,
      });

      await collectStreamResult(stream, onSnapshot, onArtifact);

      if (subprocessController.signal.aborted) {
        setSessionStatus(resolvedContextId, "cancelled");
        dispatcher.publish({ type: "cancelled" });
      } else {
        setSessionStatus(resolvedContextId, "done");
        dispatcher.publish({ type: "done" });
      }
    } catch (err: unknown) {
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
  });
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
  deleteSession(sessionId);
  if (workspacePath) restoreAgentWorkspace(workspacePath).cleanup();

  return Response.json({ ok: true });
}
