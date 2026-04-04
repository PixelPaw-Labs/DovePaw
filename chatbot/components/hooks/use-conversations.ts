"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { ChatSseEvent } from "@/lib/chat-sse";
import { useMessages } from "./use-messages";
import { useTextAnimation } from "./use-text-animation";
import type { ChatMessage } from "./use-messages";
import {
  readActiveAgentId,
  writeActiveAgentId,
  readPersistedMessages,
  writePersistedMessages,
  readPersistedSessionId,
  writePersistedSessionId,
  clearPersistedConversation,
} from "./use-persisted-conversation";
import { mergeProgressEntries } from "./use-messages";
import type { ProgressEntry } from "@/lib/query-tools";

export type { MessageRole, ChatMessage } from "./use-messages";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface CachedConversation {
  messages: ChatMessage[];
  sessionId: string | null;
}

const WRITE_DEBOUNCE_MS = 300;

// ─── Hook ──────────────────────────────────────────────────────────────────────

export function useConversations() {
  // ─── Active agent ─────────────────────────────────────────────────────────────
  // "dove" is the SSR-safe default; localStorage is read after mount to avoid hydration mismatch
  const [activeAgentId, setActiveAgentIdState] = useState<string>("dove");
  const activeAgentIdRef = useRef<string>("dove");

  useEffect(() => {
    activeAgentIdRef.current = activeAgentId;
  }, [activeAgentId]);

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

  // Track current messages in a ref so setActiveAgentId can read them synchronously
  const messagesRef = useRef<ChatMessage[]>(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

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
  const assistantIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pendingToolNameRef = useRef<string | null>(null);

  // ─── In-memory conversation cache ─────────────────────────────────────────────
  const cacheRef = useRef<Map<string, CachedConversation>>(new Map());

  // ─── Debounced localStorage write ─────────────────────────────────────────────
  const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleWrite = useCallback(
    (agentId: string, msgs: ChatMessage[], sessId: string | null) => {
      if (writeTimerRef.current) clearTimeout(writeTimerRef.current);
      writeTimerRef.current = setTimeout(() => {
        writePersistedMessages(agentId, msgs);
        writePersistedSessionId(agentId, sessId);
      }, WRITE_DEBOUNCE_MS);
    },
    [],
  );

  // ─── Hydrate from localStorage on mount ───────────────────────────────────────
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const storedAgentId = readActiveAgentId();
    if (storedAgentId !== "dove") {
      activeAgentIdRef.current = storedAgentId;
      setActiveAgentIdState(storedAgentId);
    }
    const storedMessages = readPersistedMessages(storedAgentId);
    if (storedMessages?.length) setMessages(storedMessages);
    sessionIdRef.current = readPersistedSessionId(storedAgentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally run only once on mount
  }, []);

  // ─── Persist messages whenever they change ────────────────────────────────────
  useEffect(() => {
    scheduleWrite(activeAgentId, messages, sessionIdRef.current);
  }, [messages, activeAgentId, scheduleWrite]);

  // ─── Switch active agent ──────────────────────────────────────────────────────
  const setActiveAgentId = useCallback(
    (agentId: string) => {
      const currentId = activeAgentIdRef.current;
      if (currentId === agentId) return;

      // Abort in-flight request and stop animation for the current agent
      abortRef.current?.abort();
      animation.reset();

      // Save current conversation to in-memory cache + localStorage
      const currentMessages = messagesRef.current;
      const currentSessionId = sessionIdRef.current;
      cacheRef.current.set(currentId, { messages: currentMessages, sessionId: currentSessionId });
      writePersistedMessages(currentId, currentMessages);
      writePersistedSessionId(currentId, currentSessionId);

      // Load conversation for the new agent (prefer in-memory cache, then localStorage)
      const cached = cacheRef.current.get(agentId);
      const nextMessages = cached ? cached.messages : (readPersistedMessages(agentId) ?? []);
      const nextSessionId = cached ? cached.sessionId : readPersistedSessionId(agentId);

      setMessages(nextMessages);
      setSessionProgress([]);
      setSessionCancelled(false);
      sessionIdRef.current = nextSessionId;
      pendingQueueRef.current = [];
      setPendingQueue([]);
      setIsLoading(false);

      writeActiveAgentId(agentId);
      setActiveAgentIdState(agentId);
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
        },
      );
      setIsLoading(true);

      const agentId = activeAgentIdRef.current;
      const endpoint = agentId === "dove" ? "/api/chat" : `/api/agent/${agentId}/chat`;

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

  const clearMessages = useCallback(() => {
    abortRef.current?.abort();
    animation.reset();
    clear();
    setSessionProgress([]);
    setSessionCancelled(false);
    setIsLoading(false);
    const agentId = activeAgentIdRef.current;
    const currentSessionId = sessionIdRef.current;
    if (currentSessionId) {
      const endpoint = agentId === "dove" ? "/api/chat" : `/api/agent/${agentId}/chat`;
      void fetch(endpoint, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: currentSessionId }),
      }).catch(() => {});
    }
    sessionIdRef.current = null;
    clearPersistedConversation(agentId);
    // Also update the in-memory cache so switching back doesn't restore stale data
    cacheRef.current.set(agentId, { messages: [], sessionId: null });
  }, [animation, clear]);

  return {
    activeAgentId,
    setActiveAgentId,
    messages,
    sessionProgress,
    sessionCancelled,
    isLoading,
    sendMessage,
    cancelMessage,
    clearMessages,
    pendingQueue,
    removeFromQueue,
  };
}
