"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { ChatSseEvent } from "@/lib/chat-sse";
import { useMessages } from "./use-messages";
import { useTextAnimation } from "./use-text-animation";
import type { ChatMessage } from "./use-messages";
import { mergeProgressEntries } from "./use-messages";
import type { ProgressEntry } from "@/lib/query-tools";
import { z } from "zod";
import { sessionMessageSchema } from "@/lib/message-types";
import {
  activeSessionUrl,
  sessionDetailUrl,
  agentChatUrl,
  agentSessionsUrl,
} from "@/lib/agent-api-urls";
import { parseSessions } from "./use-agent-sessions";

const activeSessionResponseSchema = z.object({ contextId: z.string().nullable() });
const sessionDetailResponseSchema = z.object({
  messages: z.array(sessionMessageSchema).default([]),
  progress: z
    .array(z.object({ message: z.string(), artifacts: z.record(z.string(), z.string()) }))
    .default([]),
});

export type { MessageRole, ChatMessage } from "./use-messages";

// ─── Hook ──────────────────────────────────────────────────────────────────────

export function useConversations() {
  // ─── Active agent ─────────────────────────────────────────────────────────────
  // "dove" is the SSR-safe default; API is read after mount to avoid hydration mismatch
  const [activeAgentId, setActiveAgentIdState] = useState<string>("dove");
  const activeAgentIdRef = useRef<string>("dove");

  // ─── Messages (for the currently-active conversation) ─────────────────────────
  const {
    messages,
    setMessages,
    patch,
    patchWhere,
    appendToProcess,
    setLastTextContent,
    appendToolCallSegment,
    setLiveProgress,
    append,
    clear,
  } = useMessages();

  // ─── Session-level workflow progress ─────────────────────────────────────────
  const [sessionProgress, setSessionProgress] = useState<ProgressEntry[]>([]);
  const [sessionCancelled, setSessionCancelled] = useState(false);

  // ─── Animation ────────────────────────────────────────────────────────────────
  const animation = useTextAnimation((id, content) => {
    setLastTextContent(id, content);
  });

  // ─── Loading / queue ──────────────────────────────────────────────────────────
  const [isLoading, setIsLoading] = useState(false);
  const [pendingQueue, setPendingQueue] = useState<string[]>([]);
  const pendingQueueRef = useRef<string[]>([]);

  // ─── Per-request refs ─────────────────────────────────────────────────────────
  const sessionIdRef = useRef<string | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const assistantIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pendingToolNameRef = useRef<string | null>(null);

  // ─── Hydrate from API on mount ────────────────────────────────────────────────
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    void (async () => {
      try {
        const { contextId } = activeSessionResponseSchema.parse(
          await (await fetch(activeSessionUrl("dove"))).json(),
        );
        if (!contextId) return;
        sessionIdRef.current = contextId;
        setCurrentSessionId(contextId);
        const { messages: msgs, progress } = sessionDetailResponseSchema.parse(
          await (await fetch(sessionDetailUrl("dove", contextId))).json(),
        );
        setMessages(
          msgs.map((m) => (m.role === "assistant" ? Object.assign({}, m, { agentId: "dove" }) : m)),
        );
        setSessionProgress(progress);
      } catch {
        // ignore — no prior session
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally run only once on mount
  }, []);

  // ─── Switch active agent ──────────────────────────────────────────────────────
  const setActiveAgentId = useCallback(
    (agentId: string) => {
      const currentId = activeAgentIdRef.current;
      if (currentId === agentId) return;

      // Abort in-flight request and stop animation for the current agent
      abortRef.current?.abort();
      animation.reset();

      setMessages([]);
      setSessionProgress([]);
      setSessionCancelled(false);
      sessionIdRef.current = null;
      setCurrentSessionId(null);
      pendingQueueRef.current = [];
      setPendingQueue([]);
      setIsLoading(false);
      activeAgentIdRef.current = agentId;
      setActiveAgentIdState(agentId);
      void (async () => {
        try {
          const { contextId } = activeSessionResponseSchema.parse(
            await (await fetch(activeSessionUrl(agentId))).json(),
          );
          // If no active session is pinned, fall back to the most recent session
          let resolvedContextId = contextId;
          if (!resolvedContextId && agentId !== "dove") {
            if (activeAgentIdRef.current !== agentId) return;
            const sessionsRes = await fetch(agentSessionsUrl(agentId));
            if (sessionsRes.ok) {
              const sessions = await parseSessions(sessionsRes);
              resolvedContextId = sessions[0]?.contextId ?? null;
            }
          }
          if (!resolvedContextId) return;
          const { messages: msgs, progress } = sessionDetailResponseSchema.parse(
            await (await fetch(sessionDetailUrl(agentId, resolvedContextId))).json(),
          );
          const stamped = msgs.map((m) =>
            m.role === "assistant" ? Object.assign({}, m, { agentId }) : m,
          );
          // Guard: user may have switched agents while the fetch was in flight
          if (activeAgentIdRef.current === agentId) {
            sessionIdRef.current = resolvedContextId;
            setCurrentSessionId(resolvedContextId);
            setMessages(stamped);
            setSessionProgress(progress);
          }
        } catch {
          // ignore — agent has no prior session
        }
      })();
    },
    [animation, setMessages],
  );

  // ─── Send message ─────────────────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed) return;

      if (isLoading) {
        const next = [...pendingQueueRef.current, trimmed];
        pendingQueueRef.current = next;
        setPendingQueue(next);
        return;
      }

      abortRef.current?.abort();
      animation.reset();
      setSessionCancelled(false);
      const abort = new AbortController();
      abortRef.current = abort;

      const assistantId = crypto.randomUUID();
      assistantIdRef.current = assistantId;
      append(
        { id: crypto.randomUUID(), role: "user", segments: [{ type: "text", content: trimmed }] },
        {
          id: assistantId,
          role: "assistant",
          segments: [{ type: "text", content: "" }],
          isLoading: true,
          agentId: activeAgentIdRef.current,
        },
      );
      setIsLoading(true);

      const agentId = activeAgentIdRef.current;
      const endpoint = agentChatUrl(agentId);

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: trimmed, sessionId: sessionIdRef.current }),
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

              if (event.type === "session") {
                sessionIdRef.current = event.sessionId;
                setCurrentSessionId(event.sessionId);
              } else if (event.type === "progress") {
                const lastToolCall = event.result.progress.at(-1)?.artifacts["tool-call"];
                if (lastToolCall) setLiveProgress(assistantId, lastToolCall);
                setSessionProgress((prev) => mergeProgressEntries(prev, event.result.progress));
              } else if (event.type === "thinking" && event.content) {
                appendToProcess(assistantId, event.content);
              } else if (event.type === "tool_call") {
                animation.cut(assistantId);
                pendingToolNameRef.current = event.name;
              } else if (event.type === "tool_input") {
                const toolName = pendingToolNameRef.current;
                pendingToolNameRef.current = null;
                if (toolName) {
                  try {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- JSON from trusted SSE stream
                    const input = JSON.parse(event.content) as Record<string, unknown>;
                    appendToolCallSegment(assistantId, { name: toolName, input });
                  } catch {
                    appendToolCallSegment(assistantId, {
                      name: toolName,
                      input: { raw: event.content },
                    });
                  }
                }
              } else if (event.type === "text" && event.content) {
                patch(assistantId, { isProcessStreaming: false });
                animation.enqueue(assistantId, event.content);
              } else if (event.type === "result" && event.content) {
                patchWhere(
                  assistantId,
                  (m) => !m.segments.some((s) => s.type === "text" && s.content.trim()),
                  (m) => {
                    const segments = [...m.segments];
                    let lastTextIdx = -1;
                    for (let i = segments.length - 1; i >= 0; i--) {
                      if (segments[i].type === "text") {
                        lastTextIdx = i;
                        break;
                      }
                    }
                    if (lastTextIdx >= 0) {
                      segments[lastTextIdx] = { type: "text", content: event.content };
                    }
                    return { segments, isLoading: false, isProcessStreaming: false };
                  },
                );
              } else if (event.type === "cancelled") {
                animation.flush(assistantId);
                setLiveProgress(assistantId, null);
                setSessionCancelled(true);
                patch(assistantId, {
                  isLoading: false,
                  isProcessStreaming: false,
                  isCancelled: true,
                });
              } else if (event.type === "error" && event.content) {
                animation.flush(assistantId);
                setLastTextContent(assistantId, `⚠️ ${event.content}`);
                patch(assistantId, { isLoading: false, isProcessStreaming: false });
              } else if (event.type === "done") {
                animation.flush(assistantId);
                setLiveProgress(assistantId, null);
                patchWhere(
                  assistantId,
                  (m) => !!m.isLoading,
                  (m) => {
                    const hasText = m.segments.some((s) => s.type === "text" && s.content.trim());
                    if (hasText) return { isLoading: false, isProcessStreaming: false };
                    const segments = m.segments.map((s, i, arr) => {
                      if (s.type !== "text") return s;
                      const isLast = arr.slice(i + 1).every((x) => x.type !== "text");
                      return isLast ? { type: "text" as const, content: "(no response)" } : s;
                    });
                    return { segments, isLoading: false, isProcessStreaming: false };
                  },
                );
              }
            } catch {
              // ignore malformed SSE lines
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        const msg = err instanceof Error ? err.message : String(err);
        animation.flush(assistantId);
        setLastTextContent(assistantId, `⚠️ Connection error: ${msg}`);
        patch(assistantId, { isLoading: false, isProcessStreaming: false });
      } finally {
        animation.flush(assistantId);
        setIsLoading(false);
      }
    },
    [
      isLoading,
      animation,
      append,
      patch,
      patchWhere,
      appendToProcess,
      setLastTextContent,
      appendToolCallSegment,
    ],
  );

  // ─── Auto-send next queued message after current finishes ─────────────────────
  useEffect(() => {
    if (isLoading || pendingQueueRef.current.length === 0) return;
    const [next, ...rest] = pendingQueueRef.current;
    pendingQueueRef.current = rest;
    setPendingQueue(rest);
    void sendMessage(next);
  }, [isLoading, sendMessage]);

  // ─── Cancel / clear / remove-from-queue ──────────────────────────────────────
  const removeFromQueue = useCallback((index: number) => {
    const next = pendingQueueRef.current.filter((_, i) => i !== index);
    pendingQueueRef.current = next;
    setPendingQueue(next);
  }, []);

  const cancelMessage = useCallback(() => {
    abortRef.current?.abort();
    animation.reset();
    if (assistantIdRef.current) {
      patch(assistantIdRef.current, { isLoading: false, isCancelled: true });
      setSessionCancelled(true);
      assistantIdRef.current = null;
    }
    setIsLoading(false);
  }, [animation, patch]);

  // Start a fresh conversation — current session stays alive on the server as history.
  const newSession = useCallback(async () => {
    abortRef.current?.abort();
    animation.reset();
    clear();
    setSessionProgress([]);
    setSessionCancelled(false);
    setIsLoading(false);
    const agentId = activeAgentIdRef.current;
    sessionIdRef.current = null;
    setCurrentSessionId(null);
    try {
      await fetch(activeSessionUrl(agentId), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contextId: null }),
      });
    } catch (err) {
      console.warn("[newSession] Failed to clear active session on server:", err);
    }
  }, [animation, clear]);

  // Abort + delete a session from the server and remove its local messages.
  // If it was the active session, also resets the UI.
  const deleteSession = useCallback(
    async (contextId: string) => {
      const agentId = activeAgentIdRef.current;
      try {
        await fetch(agentChatUrl(agentId), {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: contextId }),
        });
      } catch (err) {
        console.warn("[deleteSession] Failed to delete session on server:", err);
      }
      if (sessionIdRef.current === contextId) {
        abortRef.current?.abort();
        animation.reset();
        clear();
        setSessionProgress([]);
        setSessionCancelled(false);
        setIsLoading(false);
        sessionIdRef.current = null;
        setCurrentSessionId(null);
      }
    },
    [animation, clear],
  );

  return {
    activeAgentId,
    setActiveAgentId,
    messages,
    sessionProgress,
    sessionCancelled,
    currentSessionId,
    setSessionId: useCallback(
      async (id: string | null) => {
        sessionIdRef.current = id;
        setCurrentSessionId(id);
        setSessionCancelled(false);
        const agentId = activeAgentIdRef.current;
        try {
          await fetch(activeSessionUrl(agentId), {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contextId: id }),
          });
        } catch {
          // best effort
        }
        if (!id) {
          setMessages([]);
          setSessionProgress([]);
          return;
        }
        const res = await fetch(sessionDetailUrl(agentId, id));
        if (!res.ok) {
          // session not found on server — clear UI
          setMessages([]);
          setSessionProgress([]);
          return;
        }
        const { messages: msgs, progress } = sessionDetailResponseSchema.parse(await res.json());
        // Guard: user may have switched agents while the fetch was in flight
        if (activeAgentIdRef.current !== agentId) return;
        const stamped = msgs.map((m) =>
          m.role === "assistant" ? Object.assign({}, m, { agentId }) : m,
        );
        setMessages(stamped);
        setSessionProgress(progress);
      },
      [setMessages],
    ),
    isLoading,
    sendMessage,
    cancelMessage,
    newSession,
    deleteSession,
    pendingQueue,
    removeFromQueue,
  };
}
