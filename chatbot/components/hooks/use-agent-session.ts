"use client";

import { useCallback, useRef } from "react";
import type { ChatSseEvent } from "@/lib/chat-sse";
import { mergeProgressEntries } from "./use-messages";
import {
  agentChatUrl,
  sessionStreamUrl,
  activeSessionUrl,
  sessionDetailUrl,
  agentSessionsUrl,
  type AgentId,
} from "@/lib/agent-api-urls";
import { parseSessions } from "./use-agent-sessions";
import {
  activeSessionResponseSchema,
  fetchSessionDetail,
  type SharedSessionContext,
} from "./shared-session-context";
import { processActiveStreamEvent } from "./process-stream-event";

export function useAgentSession(sharedCtx: SharedSessionContext) {
  // ─── Single-session state ─────────────────────────────────────────────────────
  const singleAbortRef = useRef<AbortController | null>(null);
  const singleSessionIdRef = useRef<string | null>(null);
  const singleLastSeqRef = useRef<number>(0);

  // ─── connectSingleSessionStream ───────────────────────────────────────────────
  const connectSingleSessionStream = useCallback(
    (
      sessionId: string,
      agentId: string,
      warmReconnect: boolean,
      resumeHint?: { assistantId: string; text: string; seq: number },
    ) => {
      singleAbortRef.current?.abort();
      const abort = new AbortController();
      singleAbortRef.current = abort;

      let resumeAssistantId: string;
      if (warmReconnect) {
        const lastAssistant = sharedCtx.stream.messagesRef.current
          .toReversed()
          .find((m) => m.role === "assistant");
        resumeAssistantId = lastAssistant?.id ?? crypto.randomUUID();
      } else {
        if (resumeHint) {
          resumeAssistantId = resumeHint.assistantId;
          singleLastSeqRef.current = resumeHint.seq;
          sharedCtx.stream.animation.seed(resumeAssistantId, resumeHint.text);
        } else {
          resumeAssistantId = crypto.randomUUID();
          singleLastSeqRef.current = 0;
          sharedCtx.session.setMessages((prev) => [
            ...prev,
            {
              id: resumeAssistantId,
              role: "assistant" as const,
              segments: [{ type: "text" as const, content: "" }],
              isLoading: true,
              agentId,
            },
          ]);
        }
      }
      sharedCtx.stream.assistantIdRef.current = resumeAssistantId;

      const after = singleLastSeqRef.current;
      const url = `${sessionStreamUrl(sessionId)}?after=${after}`;

      void (async () => {
        try {
          const response = await fetch(url, { signal: abort.signal });
          if (!response.ok || !response.body) return;

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          // eslint-disable-next-line no-await-in-loop -- streaming reader pattern requires sequential awaits
          while (true) {
            // eslint-disable-next-line no-await-in-loop -- streaming reader pattern requires sequential awaits
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split("\n\n");
            buffer = parts.pop() ?? "";
            for (const part of parts) {
              const line = part.trim();
              if (!line.startsWith("data: ")) continue;
              try {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- JSON from trusted SSE stream
                const event = JSON.parse(line.slice(6)) as ChatSseEvent;

                const seq = (event as Record<string, unknown>)._seq;
                if (typeof seq === "number") singleLastSeqRef.current = seq;

                // session and progress are handled per-hook (different state models).
                if (event.type === "session") {
                  singleSessionIdRef.current = event.sessionId;
                  sharedCtx.session.setCurrentSessionId(event.sessionId);
                } else if (event.type === "progress") {
                  sharedCtx.session.setSessionProgress((prev) =>
                    mergeProgressEntries(prev, event.result.progress),
                  );
                } else {
                  // Reconnect stream: result always replaces (no skipResultIfHasText).
                  processActiveStreamEvent(event, resumeAssistantId, sharedCtx);
                }
              } catch {
                // ignore malformed SSE lines
              }
            }
          }
        } catch (err: unknown) {
          if (err instanceof Error && err.name === "AbortError") return;
          sharedCtx.stream.animation.flush(resumeAssistantId);
        } finally {
          sharedCtx.session.setIsLoading(false);
          if (singleAbortRef.current === abort) singleAbortRef.current = null;
        }
      })();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sharedCtx is stable
    [sharedCtx.stream, sharedCtx.session],
  );

  // ─── sendMessage (non-Dove branch) ───────────────────────────────────────────
  const sendMessage = useCallback(
    async (content: string, agentId: AgentId) => {
      const trimmed = content.trim();
      if (!trimmed) return;

      if (sharedCtx.session.isLoadingRef.current) return;
      singleAbortRef.current?.abort();
      sharedCtx.stream.animation.reset();
      sharedCtx.session.setSessionCancelled(false);
      const abort = new AbortController();
      singleAbortRef.current = abort;

      const assistantId = crypto.randomUUID();
      sharedCtx.stream.assistantIdRef.current = assistantId;

      sharedCtx.session.setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "user" as const,
          segments: [{ type: "text" as const, content: trimmed }],
        },
        {
          id: assistantId,
          role: "assistant" as const,
          segments: [{ type: "text" as const, content: "" }],
          isLoading: true,
          agentId,
        },
      ]);
      sharedCtx.session.setIsLoading(true);
      sharedCtx.session.setPendingPermissions([]);

      const endpoint = agentChatUrl(agentId);

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: trimmed, sessionId: singleSessionIdRef.current }),
          signal: abort.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        // eslint-disable-next-line no-await-in-loop -- streaming reader pattern requires sequential awaits
        while (true) {
          // eslint-disable-next-line no-await-in-loop -- streaming reader pattern requires sequential awaits
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";
          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith("data: ")) continue;
            try {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- JSON from trusted SSE stream
              const event = JSON.parse(line.slice(6)) as ChatSseEvent;

              const seq = (event as Record<string, unknown>)._seq;
              if (typeof seq === "number") singleLastSeqRef.current = seq;

              // session and progress are handled per-hook (different state models).
              if (event.type === "session") {
                singleSessionIdRef.current = event.sessionId;
                sharedCtx.session.setCurrentSessionId(event.sessionId);
              } else if (event.type === "progress") {
                sharedCtx.session.setSessionProgress((prev) =>
                  mergeProgressEntries(prev, event.result.progress),
                );
              } else {
                processActiveStreamEvent(event, assistantId, sharedCtx, {
                  skipResultIfHasText: true,
                });
              }
            } catch {
              // ignore malformed SSE lines
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        const msg = err instanceof Error ? err.message : String(err);
        sharedCtx.stream.animation.flush(assistantId);
        sharedCtx.session.setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== assistantId) return m;
            const segs = [...m.segments];
            let lastTextIdx = -1;
            for (let i = segs.length - 1; i >= 0; i--) {
              if (segs[i].type === "text") {
                lastTextIdx = i;
                break;
              }
            }
            if (lastTextIdx >= 0)
              segs[lastTextIdx] = {
                type: "text" as const,
                content: `⚠️ Connection error: ${msg}`,
              };
            return Object.assign({}, m, {
              segments: segs,
              isLoading: false,
              isProcessStreaming: false,
            });
          }),
        );
      } finally {
        sharedCtx.stream.animation.flush(assistantId);
        sharedCtx.session.setIsLoading(false);
        if (singleAbortRef.current === abort) singleAbortRef.current = null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sharedCtx is stable
    [sharedCtx.stream, sharedCtx.session],
  );

  // ─── cancelMessage (non-Dove branch) ─────────────────────────────────────────
  const cancelMessage = useCallback(() => {
    const agentId = sharedCtx.session.activeAgentIdRef.current;
    const sessionId = singleSessionIdRef.current;
    singleAbortRef.current?.abort();
    singleAbortRef.current = null;
    sharedCtx.stream.animation.flush(sharedCtx.stream.assistantIdRef.current ?? "");
    sharedCtx.session.setMessages((prev) =>
      prev.map((m) =>
        m.id === sharedCtx.stream.assistantIdRef.current
          ? Object.assign({}, m, { isLoading: false, isCancelled: true })
          : m,
      ),
    );
    sharedCtx.session.setSessionCancelled(true);
    sharedCtx.session.setIsLoading(false);
    if (sessionId) {
      void fetch(`/api/agent/${agentId}/chat`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, method: "stop" }),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sharedCtx is stable
  }, [sharedCtx.stream, sharedCtx.session]);

  // ─── newSession (non-Dove branch) ────────────────────────────────────────────
  const newSession = useCallback(() => {
    singleAbortRef.current?.abort();
    singleAbortRef.current = null;
    singleSessionIdRef.current = null;
    sharedCtx.session.pendingQueueRef.current = [];
    sharedCtx.session.setPendingQueue([]);
    sharedCtx.session.setMessages([]);
    sharedCtx.session.setSessionProgress([]);
    sharedCtx.session.setSessionCancelled(false);
    sharedCtx.session.setIsLoading(false);
    sharedCtx.session.setCurrentSessionId(null);
    void fetch(activeSessionUrl(sharedCtx.session.activeAgentIdRef.current), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: null }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sharedCtx is stable
  }, [sharedCtx.session]);

  // ─── deleteSession (non-Dove branch) ─────────────────────────────────────────
  const deleteSession = useCallback(
    async (contextId: string) => {
      const agentId = sharedCtx.session.activeAgentIdRef.current;
      try {
        await fetch(agentChatUrl(agentId), {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: contextId }),
        });
      } catch (err) {
        console.warn("[deleteSession] Failed to delete session on server:", err);
      }
      if (singleSessionIdRef.current === contextId) {
        singleAbortRef.current?.abort();
        singleAbortRef.current = null;
        singleSessionIdRef.current = null;
        sharedCtx.session.setMessages([]);
        sharedCtx.session.setSessionProgress([]);
        sharedCtx.session.setSessionCancelled(false);
        sharedCtx.session.setIsLoading(false);
        sharedCtx.session.setCurrentSessionId(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sharedCtx is stable
    [sharedCtx.session],
  );

  // ─── setSessionId (non-Dove branch) ──────────────────────────────────────────
  const setSessionId = useCallback(
    async (id: string | null) => {
      if (!id) return;
      const agentId = sharedCtx.session.activeAgentIdRef.current;
      singleAbortRef.current?.abort();
      singleAbortRef.current = null;
      singleLastSeqRef.current = 0;
      sharedCtx.stream.animation.reset();
      sharedCtx.session.setMessages([]);
      sharedCtx.session.setSessionProgress([]);
      sharedCtx.session.setIsLoading(false);
      sharedCtx.session.setSessionCancelled(false);
      sharedCtx.session.setPendingPermissions([]);
      void (async () => {
        try {
          const {
            messages: stamped,
            progress,
            resumeSeq,
            status,
          } = await fetchSessionDetail(sessionDetailUrl(agentId, id), agentId);
          if (sharedCtx.session.activeAgentIdRef.current !== agentId) return;
          singleSessionIdRef.current = id;
          sharedCtx.session.setCurrentSessionId(id);
          sharedCtx.session.setSessionProgress(progress);
          sharedCtx.session.setSessionCancelled(status === "cancelled");
          if (status === "running") {
            const lastAssistant = stamped.toReversed().find((m) => m.role === "assistant");
            const resumeText =
              lastAssistant?.segments
                .filter((s): s is { type: "text"; content: string } => s.type === "text")
                .map((s) => s.content)
                .join("") ?? "";
            const resumeHint =
              resumeSeq > 0 && lastAssistant && resumeText
                ? { assistantId: lastAssistant.id, text: resumeText, seq: resumeSeq }
                : undefined;
            if (!resumeHint) {
              const lastMsg = stamped[stamped.length - 1];
              sharedCtx.session.setMessages(
                lastMsg?.role === "assistant" ? stamped.slice(0, -1) : stamped,
              );
            } else {
              sharedCtx.session.setMessages(stamped);
            }
            sharedCtx.session.setIsLoading(true);
            connectSingleSessionStream(id, agentId, false, resumeHint);
          } else {
            sharedCtx.session.setMessages(stamped);
          }
        } catch {
          singleSessionIdRef.current = id;
          sharedCtx.session.setCurrentSessionId(id);
        }
      })();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sharedCtx is stable
    [connectSingleSessionStream, sharedCtx.stream, sharedCtx.session],
  );

  // ─── load (called when switching TO a non-Dove agent) ────────────────────────
  const load = useCallback(
    (agentId: AgentId) => {
      void (async () => {
        try {
          const { id } = activeSessionResponseSchema.parse(
            await (await fetch(activeSessionUrl(agentId))).json(),
          );
          let resolvedContextId = id;
          if (!resolvedContextId && agentId !== "dove") {
            if (sharedCtx.session.activeAgentIdRef.current !== agentId) return;
            const sessionsRes = await fetch(agentSessionsUrl(agentId));
            if (sessionsRes.ok) {
              const fetchedSessions = await parseSessions(sessionsRes);
              resolvedContextId = fetchedSessions[0]?.id ?? null;
            }
          }
          if (!resolvedContextId) return;
          const {
            messages: stamped,
            progress,
            status,
            resumeSeq,
          } = await fetchSessionDetail(sessionDetailUrl(agentId, resolvedContextId), agentId);
          if (sharedCtx.session.activeAgentIdRef.current !== agentId) return;
          singleSessionIdRef.current = resolvedContextId;
          sharedCtx.session.setCurrentSessionId(resolvedContextId);

          const isCold = singleLastSeqRef.current === 0;
          if (status === "running" && isCold) {
            const lastMsg = stamped[stamped.length - 1];
            const msgsWithoutInProgress =
              lastMsg?.role === "assistant" ? stamped.slice(0, -1) : stamped;
            sharedCtx.session.setMessages(msgsWithoutInProgress);
          } else {
            sharedCtx.session.setMessages(stamped);
          }
          sharedCtx.session.setSessionProgress(progress);
          if (status === "running") {
            sharedCtx.session.setIsLoading(true);
            const lastAssistant = stamped.toReversed().find((m) => m.role === "assistant");
            const resumeText =
              lastAssistant?.segments
                .filter((s): s is { type: "text"; content: string } => s.type === "text")
                .map((s) => s.content)
                .join("") ?? "";
            const resumeHint =
              resumeSeq > 0 && lastAssistant && resumeText
                ? { assistantId: lastAssistant.id, text: resumeText, seq: resumeSeq }
                : undefined;
            if (!resumeHint) {
              const lastMsg = stamped[stamped.length - 1];
              sharedCtx.session.setMessages(
                lastMsg?.role === "assistant" ? stamped.slice(0, -1) : stamped,
              );
            } else {
              sharedCtx.session.setMessages(stamped);
            }
            connectSingleSessionStream(resolvedContextId, agentId, !isCold, resumeHint);
          }
        } catch {
          // no prior session
        }
      })();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sharedCtx is stable
    [connectSingleSessionStream, sharedCtx.session],
  );

  // ─── Orchestrator coordination methods ────────────────────────────────────────

  /** Called by orchestrator when switching away from this agent */
  const disconnect = useCallback(() => {
    singleAbortRef.current?.abort();
    singleAbortRef.current = null;
    singleLastSeqRef.current = 0;
    singleSessionIdRef.current = null;
  }, []);

  return {
    sendMessage,
    cancelMessage,
    newSession,
    deleteSession,
    setSessionId,
    disconnect,
    load,
  };
}
