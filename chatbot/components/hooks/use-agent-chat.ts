"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { ChatSseEvent } from "@/lib/chat-sse";
import { useMessages } from "./use-messages";
import { useTextAnimation } from "./use-text-animation";

export type { MessageRole, ChatMessage } from "./use-messages";

export function useAgentChat() {
  const {
    messages,
    patch,
    patchWhere,
    appendToProcess,
    setLastTextContent,
    appendToolCallSegment,
    append,
    clear,
  } = useMessages();
  const pendingToolNameRef = useRef<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const pendingQueueRef = useRef<string[]>([]);
  const [pendingQueue, setPendingQueue] = useState<string[]>([]);
  const sessionIdRef = useRef<string | null>(null);
  const assistantIdRef = useRef<string | null>(null);

  const animation = useTextAnimation((id, content) => {
    setLastTextContent(id, content);
  });

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

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: trimmed, sessionId: sessionIdRef.current }),
          signal: abort.signal,
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";

          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith("data: ")) continue;
            try {
              const event = JSON.parse(line.slice(6)) as ChatSseEvent;

              if (event.type === "session") {
                sessionIdRef.current = event.sessionId;
              } else if (event.type === "thinking" && event.content) {
                appendToProcess(assistantId, event.content);
              } else if (event.type === "tool_call") {
                // Close the current text segment and prepare for a new one after the tool call
                animation.cut(assistantId);
                pendingToolNameRef.current = event.name;
              } else if (event.type === "tool_input") {
                const toolName = pendingToolNameRef.current;
                pendingToolNameRef.current = null;
                if (toolName) {
                  try {
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
                // Fallback for tool-only responses: populate last text segment if still empty
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
                      segments[lastTextIdx] = { type: "text", content: event.content! };
                    }
                    return { segments, isLoading: false, isProcessStreaming: false };
                  },
                );
              } else if (event.type === "error" && event.content) {
                animation.flush(assistantId);
                setLastTextContent(assistantId, `⚠️ ${event.content}`);
                patch(assistantId, { isLoading: false, isProcessStreaming: false });
              } else if (event.type === "done") {
                animation.flush(assistantId);
                patchWhere(
                  assistantId,
                  (m) => !!m.isLoading,
                  (m) => {
                    const hasText = m.segments.some((s) => s.type === "text" && s.content.trim());
                    if (hasText) return { isLoading: false, isProcessStreaming: false };
                    // No text at all — set fallback on last text segment
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
              // ignore malformed lines
            }
          }
        }
      } catch (err: unknown) {
        if ((err as Error).name === "AbortError") return;
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
      patch,
      patchWhere,
      appendToProcess,
      setLastTextContent,
      appendToolCallSegment,
      append,
    ],
  );

  // When the agent finishes, pop and send the next queued message
  useEffect(() => {
    if (isLoading || pendingQueueRef.current.length === 0) return;
    const [next, ...rest] = pendingQueueRef.current;
    pendingQueueRef.current = rest;
    setPendingQueue(rest);
    sendMessage(next);
  }, [isLoading, sendMessage]);

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
      assistantIdRef.current = null;
    }
    setIsLoading(false);
  }, [animation, patch]);

  const clearMessages = useCallback(() => {
    abortRef.current?.abort();
    animation.reset();
    clear();
    setIsLoading(false);
    sessionIdRef.current = null;
  }, [animation, clear]);

  return {
    messages,
    isLoading,
    sendMessage,
    cancelMessage,
    clearMessages,
    pendingQueue,
    removeFromQueue,
  };
}
