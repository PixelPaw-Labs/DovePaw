"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { ChatSsePermission, ChatSseQuestion } from "@/lib/chat-sse";
import type { ChatMessage } from "./use-messages";
import {
  agentChatUrl,
  sessionStreamUrl,
  activeSessionUrl,
  sessionDetailUrl,
  agentSessionsUrl,
  type AgentId,
} from "@/lib/agent-api-urls";
import { useTextAnimation } from "./use-text-animation";
import { processActiveStreamEvent } from "./process-stream-event";
import { parseSessions } from "./use-agent-sessions";
import { readSseStream } from "./read-sse-stream";
import { startPolling } from "./poll-session";
import {
  activeSessionResponseSchema,
  fetchSessionDetail,
  type SessionStatus,
} from "./session-api-client";

export type { SessionStatus };

// ─── useChatSession ───────────────────────────────────────────────────────────

/**
 * Unified session hook replacing useSessionRegistry + useDoveSession + useAgentSession.
 * Manages a single session for the given agentId (Dove or non-Dove).
 */
export function useChatSession(agentId: AgentId) {
  // ─── State ────────────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [pendingPermissions, setPendingPermissions] = useState<ChatSsePermission[]>([]);
  const [pendingQuestions, setPendingQuestions] = useState<ChatSseQuestion[]>([]);
  const [pendingQueue, setPendingQueue] = useState<string[]>([]);

  // ─── Refs ─────────────────────────────────────────────────────────────────────
  const abortRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const lastSeqRef = useRef(0);
  const isLoadingRef = useRef(false);
  const assistantIdRef = useRef<string | null>(null);
  const pendingToolNameRef = useRef<string | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const pendingQueueRef = useRef<string[]>([]);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks the last-animated assistant text and its ID across poll ticks.
  const pollPrevTextRef = useRef("");
  const pollAssistantIdRef = useRef<string | null>(null);

  // Keep refs in sync with state
  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // ─── updateActiveMessages (stable callback referencing setMessages) ────────────
  const updateActiveMessages = useCallback((updater: (prev: ChatMessage[]) => ChatMessage[]) => {
    setMessages((prev) => updater(prev));
  }, []);

  // ─── Animation ────────────────────────────────────────────────────────────────
  const animation = useTextAnimation((id, content) => {
    updateActiveMessages((prev) =>
      prev.map((m) => {
        if (m.id !== id) return m;
        const segs = [...m.segments];
        let lastTextIdx = -1;
        for (let i = segs.length - 1; i >= 0; i--) {
          if (segs[i].type === "text") {
            lastTextIdx = i;
            break;
          }
        }
        if (lastTextIdx === -1)
          return Object.assign({}, m, { segments: [...segs, { type: "text" as const, content }] });
        const updated = [...segs];
        updated[lastTextIdx] = { type: "text" as const, content };
        return Object.assign({}, m, { segments: updated });
      }),
    );
  });

  // ─── Stream event context (matches StreamEventContext interface) ───────────────
  const streamCtx = {
    updateActiveMessages,
    animation,
    pendingToolNameRef,
    setPendingPermissions,
    setPendingQuestions,
  };

  // ─── connectStream ────────────────────────────────────────────────────────────
  /**
   * Connect to an existing session's SSE stream for reconnect/setSessionId.
   * warmReconnect=true: reuse the last assistant message ID from messagesRef.
   * warmReconnect=false: create a new assistant message (or use resumeHint).
   */
  const connectStream = useCallback(
    (
      sessionId: string,
      warmReconnect: boolean,
      resumeHint?: { assistantId: string; text: string; seq: number },
    ) => {
      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;

      let resumeAssistantId: string;
      // For cold reconnect with no resumeHint, we delay creating the assistant message
      // until the first text/result event arrives. This prevents "(no response)" when
      // reconnecting to a session that has no buffered SSE events (e.g. Dove-triggered
      // A2A sessions whose events are not served by /api/chat/stream/).
      let messageReady = true;
      if (warmReconnect) {
        const lastAssistant = messagesRef.current.toReversed().find((m) => m.role === "assistant");
        resumeAssistantId = lastAssistant?.id ?? crypto.randomUUID();
      } else {
        if (resumeHint) {
          resumeAssistantId = resumeHint.assistantId;
          lastSeqRef.current = resumeHint.seq;
          animation.seed(resumeAssistantId, resumeHint.text);
        } else {
          resumeAssistantId = crypto.randomUUID();
          lastSeqRef.current = 0;
          messageReady = false; // add lazily on first text/result
        }
      }
      assistantIdRef.current = resumeAssistantId;

      const after = lastSeqRef.current;
      const url = `${sessionStreamUrl(sessionId)}?after=${after}`;

      void (async () => {
        try {
          const response = await fetch(url, { signal: abort.signal });
          if (!response.ok || !response.body) return;
          await readSseStream(response.body, (event) => {
            if (abort.signal.aborted) return;
            const seq = (event as Record<string, unknown>)._seq;
            if (typeof seq === "number") lastSeqRef.current = seq;

            if (event.type === "session") {
              sessionIdRef.current = event.sessionId;
              setCurrentSessionId(event.sessionId);
            } else {
              // Lazily create the assistant message on first text/result content.
              if (!messageReady && (event.type === "text" || event.type === "result")) {
                messageReady = true;
                setMessages((prev) => [
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
              if (messageReady) {
                processActiveStreamEvent(event, resumeAssistantId, streamCtx, {
                  onDone: () => setIsLoading(false),
                  onCancelled: () => setIsLoading(false),
                });
              }
            }
          });
        } catch (err: unknown) {
          if (err instanceof Error && err.name === "AbortError") return;
          animation.flush(resumeAssistantId);
        } finally {
          // Only clear loading if this stream is still the active one.
          // If the session was switched externally, abortRef was already nulled
          // and the new session owns isLoading.
          if (abortRef.current === abort) {
            setIsLoading(false);
            abortRef.current = null;
          }
        }
      })();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- animation and streamCtx are stable
    [agentId, animation],
  );

  // ─── sendMessage ──────────────────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed) return;

      if (isLoadingRef.current) {
        const next = [...pendingQueueRef.current, trimmed];
        pendingQueueRef.current = next;
        setPendingQueue(next);
        return;
      }

      abortRef.current?.abort();
      animation.reset();
      setPendingPermissions([]);
      setPendingQuestions([]);

      const abort = new AbortController();
      abortRef.current = abort;

      const assistantId = crypto.randomUUID();
      assistantIdRef.current = assistantId;

      setMessages((prev) => [
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
      setIsLoading(true);

      const endpoint = agentChatUrl(agentId);

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: trimmed, sessionId: sessionIdRef.current }),
          signal: abort.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        await readSseStream(response.body!, (event) => {
          if (abort.signal.aborted) return;
          const seq = (event as Record<string, unknown>)._seq;
          if (typeof seq === "number") lastSeqRef.current = seq;

          if (event.type === "session") {
            sessionIdRef.current = event.sessionId;
            setCurrentSessionId(event.sessionId);
          } else {
            processActiveStreamEvent(event, assistantId, streamCtx, {
              skipResultIfHasText: true,
              onDone: () => setIsLoading(false),
              onCancelled: () => setIsLoading(false),
            });
          }
        });
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        const msg = err instanceof Error ? err.message : String(err);
        animation.flush(assistantId);
        setMessages((prev) =>
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
        animation.flush(assistantId);
        if (abortRef.current === abort) {
          setIsLoading(false);
          abortRef.current = null;
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- animation and streamCtx are stable
    [agentId, animation],
  );

  // ─── cancelMessage ────────────────────────────────────────────────────────────
  const cancelMessage = useCallback(() => {
    const sessionId = sessionIdRef.current;
    abortRef.current?.abort();
    abortRef.current = null;
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
    animation.flush(assistantIdRef.current ?? "");
    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantIdRef.current
          ? Object.assign({}, m, { isLoading: false, isCancelled: true })
          : m,
      ),
    );
    setIsLoading(false);
    if (sessionId) {
      void fetch(agentChatUrl(agentId), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, method: "stop" }),
      });
    }
  }, [agentId, animation]);

  // ─── newSession ───────────────────────────────────────────────────────────────
  const newSession = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    sessionIdRef.current = null;
    lastSeqRef.current = 0;
    pendingQueueRef.current = [];
    setPendingQueue([]);
    setMessages([]);
    setIsLoading(false);
    setCurrentSessionId(null);
    setPendingPermissions([]);
    setPendingQuestions([]);
    void fetch(activeSessionUrl(agentId), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: null }),
    });
  }, [agentId]);

  // ─── deleteSession ────────────────────────────────────────────────────────────
  const deleteSession = useCallback(
    async (id: string) => {
      try {
        await fetch(agentChatUrl(agentId), {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: id }),
        });
      } catch (err) {
        console.warn("[deleteSession] Failed to delete session on server:", err);
      }
      if (sessionIdRef.current === id) {
        abortRef.current?.abort();
        abortRef.current = null;
        sessionIdRef.current = null;
        setMessages([]);
        setIsLoading(false);
        setCurrentSessionId(null);
      }
    },
    [agentId],
  );

  // ─── handlePoll — delta-streaming callback for startPolling ─────────────────────
  const handlePoll = useCallback(
    ({
      messages: polledMsgs,
      status: pollStatus,
    }: {
      messages: ChatMessage[];
      status: "running" | "done" | "cancelled";
    }) => {
      const pollAssistant = polledMsgs.toReversed().find((m) => m.role === "assistant");
      const newText =
        pollAssistant?.segments
          .filter((s): s is { type: "text"; content: string } => s.type === "text")
          .map((s) => s.content)
          .join("") ?? "";

      // On first poll with an assistant message, add a blank animated entry.
      if (!pollAssistantIdRef.current && pollAssistant) {
        pollAssistantIdRef.current = pollAssistant.id;
        assistantIdRef.current = pollAssistant.id;
        setMessages([
          ...polledMsgs.slice(0, -1),
          {
            id: pollAssistant.id,
            role: "assistant" as const,
            segments: [{ type: "text" as const, content: "" }],
            isLoading: true,
            agentId,
          },
        ]);
      }

      // Animate only new text since the last poll tick.
      const delta = newText.slice(pollPrevTextRef.current.length);
      if (delta && pollAssistantIdRef.current) {
        animation.enqueue(pollAssistantIdRef.current, delta);
        pollPrevTextRef.current = newText;
      }

      if (pollStatus !== "running") {
        const aid = pollAssistantIdRef.current;
        if (aid) animation.flush(aid);
        setMessages(polledMsgs);
        setIsLoading(false);
        pollPrevTextRef.current = "";
        pollAssistantIdRef.current = null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- animation is stable
    [agentId, animation],
  );

  // ─── reconnectRunningSession ──────────────────────────────────────────────────
  // Shared by setSessionId and the mount effect: computes resumeHint, sets
  // messages, and routes to connectStream (buffered SSE) or startPolling (A2A).
  const reconnectRunningSession = useCallback(
    ({
      sessionId,
      stamped,
      resumeSeq,
      warmReconnect,
      isCancelled,
    }: {
      sessionId: string;
      stamped: ChatMessage[];
      resumeSeq: number;
      warmReconnect: boolean;
      isCancelled: () => boolean;
    }) => {
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
      const lastMsg = stamped[stamped.length - 1];
      setMessages(
        resumeHint ? stamped : lastMsg?.role === "assistant" ? stamped.slice(0, -1) : stamped,
      );
      setIsLoading(true);
      if (resumeHint) {
        connectStream(sessionId, warmReconnect, resumeHint);
      } else {
        // No buffered SSE (e.g. Dove-triggered A2A session) — poll DB instead.
        pollPrevTextRef.current = "";
        pollAssistantIdRef.current = null;
        startPolling({
          agentId,
          sessionId,
          isCancelled,
          getCurrentSessionId: () => sessionIdRef.current,
          pollTimeoutRef,
          onPoll: handlePoll,
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- animation is stable
    [agentId, connectStream, handlePoll],
  );

  // ─── setSessionId ─────────────────────────────────────────────────────────────
  const setSessionId = useCallback(
    async (id: string | null) => {
      if (!id) return;
      // Set immediately so in-flight poll/stream callbacks can detect a stale session.
      sessionIdRef.current = id;
      abortRef.current?.abort();
      abortRef.current = null;
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
        pollTimeoutRef.current = null;
      }
      lastSeqRef.current = 0;
      animation.reset();
      setMessages([]);
      setIsLoading(false);
      setPendingPermissions([]);
      setPendingQuestions([]);
      void (async () => {
        try {
          const {
            messages: stamped,
            resumeSeq,
            status,
          } = await fetchSessionDetail(sessionDetailUrl(agentId, id), agentId);
          // Another setSessionId call may have fired while fetch was in flight.
          if (sessionIdRef.current !== id) return;
          setCurrentSessionId(id);
          if (status === "running") {
            reconnectRunningSession({
              sessionId: id,
              stamped,
              resumeSeq,
              warmReconnect: false,
              isCancelled: () => sessionIdRef.current !== id,
            });
          } else {
            setMessages(stamped);
          }
        } catch {
          sessionIdRef.current = id;
          setCurrentSessionId(id);
        }
      })();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- animation is stable
    [agentId, animation, connectStream, reconnectRunningSession],
  );

  // ─── resolvePermission ────────────────────────────────────────────────────────
  const resolvePermission = useCallback(async (requestId: string, allowed: boolean) => {
    try {
      const res = await fetch("/api/chat/permission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, allowed }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPendingPermissions((prev) => prev.filter((p) => p.requestId !== requestId));
    } catch {
      // Leave the banner visible so the user can retry.
    }
  }, []);

  // ─── resolveQuestion ─────────────────────────────────────────────────────────
  const resolveQuestion = useCallback(
    async (requestId: string, answers: Record<string, string>) => {
      try {
        const res = await fetch("/api/chat/question", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId, answers }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setPendingQuestions((prev) => prev.filter((q) => q.requestId !== requestId));
      } catch {
        // Leave the banner visible so the user can retry.
      }
    },
    [],
  );

  // ─── removeFromQueue ──────────────────────────────────────────────────────────
  const removeFromQueue = useCallback((index: number) => {
    const next = pendingQueueRef.current.filter((_, i) => i !== index);
    pendingQueueRef.current = next;
    setPendingQueue(next);
  }, []);

  // ─── Pending queue drain ──────────────────────────────────────────────────────
  useEffect(() => {
    if (isLoading || pendingQueueRef.current.length === 0) return;
    const [next, ...rest] = pendingQueueRef.current;
    pendingQueueRef.current = rest;
    setPendingQueue(rest);
    void sendMessage(next);
  }, [isLoading, sendMessage]);

  // ─── Mount: load last session ─────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { id } = activeSessionResponseSchema.parse(
          await (await fetch(activeSessionUrl(agentId))).json(),
        );
        let resolvedId = id;
        if (!resolvedId && agentId !== "dove") {
          const sessionsRes = await fetch(agentSessionsUrl(agentId));
          if (sessionsRes.ok) {
            const fetched = await parseSessions(sessionsRes);
            resolvedId = fetched[0]?.id ?? null;
          }
        }
        if (!resolvedId) return;
        if (cancelled) return;

        const {
          messages: stamped,
          status,
          resumeSeq,
        } = await fetchSessionDetail(sessionDetailUrl(agentId, resolvedId), agentId);
        if (cancelled) return;

        sessionIdRef.current = resolvedId;
        setCurrentSessionId(resolvedId);

        if (status === "running") {
          reconnectRunningSession({
            sessionId: resolvedId,
            stamped,
            resumeSeq,
            warmReconnect: lastSeqRef.current !== 0,
            isCancelled: () => cancelled,
          });
        } else {
          setMessages(stamped);
        }
      } catch {
        // no prior session — start fresh
      }
    })();
    return () => {
      cancelled = true;
      abortRef.current?.abort();
      abortRef.current = null;
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
        pollTimeoutRef.current = null;
      }
    };
    // Only re-run on agentId changes. connectStream is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  return {
    messages,
    isLoading,
    currentSessionId,
    pendingPermissions,
    pendingQuestions,
    pendingQueue,
    sendMessage,
    cancelMessage,
    newSession,
    deleteSession,
    setSessionId,
    resolvePermission,
    resolveQuestion,
    removeFromQueue,
  };
}
