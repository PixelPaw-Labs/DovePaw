"use client";

import type { ChatSseEvent, ChatSsePermission, ChatSseQuestion } from "@/lib/chat-sse";
import type { useTextAnimation } from "./use-text-animation";
import type { ChatMessage } from "./use-messages";
import type React from "react";

export interface StreamEventContext {
  updateActiveMessages: (updater: (prev: ChatMessage[]) => ChatMessage[]) => void;
  animation: ReturnType<typeof useTextAnimation>;
  pendingToolNameRef: React.MutableRefObject<string | null>;
  setPendingPermissions: React.Dispatch<React.SetStateAction<ChatSsePermission[]>>;
  setPendingQuestions: React.Dispatch<React.SetStateAction<ChatSseQuestion[]>>;
}

export interface StreamEventCallbacks {
  /**
   * Extra side effect when a "done" event arrives (e.g. update sessionsRef isLoading/status).
   * Called after the animation flush and message finalization.
   */
  onDone?: () => void;
  /**
   * Extra side effect when a "cancelled" event arrives (e.g. update sessionsRef).
   * Called after pending permissions are cleared, animation flushed, and messages updated.
   */
  onCancelled?: () => void;
  /**
   * When true, the "result" event is a no-op if the assistant message already has
   * non-empty text — preserves content that was streamed via "text" events (agent behaviour).
   * When false/omitted, always replaces the last text segment (Dove / reconnect behaviour).
   */
  skipResultIfHasText?: boolean;
}

/**
 * Process a single SSE event for the ACTIVE session.
 *
 * Handles: permission, thinking, tool_call, tool_input, text, result, done, cancelled, error.
 * NOT handled here (too hook-specific): session, progress, seq.
 *
 * Hook-specific side effects (e.g. sessionsRef updates) are injected via `callbacks`.
 */
export function processActiveStreamEvent(
  event: ChatSseEvent,
  assistantId: string,
  ctx: StreamEventContext,
  callbacks?: StreamEventCallbacks,
): void {
  const {
    updateActiveMessages,
    animation,
    pendingToolNameRef,
    setPendingPermissions,
    setPendingQuestions,
  } = ctx;

  if (event.type === "permission") {
    setPendingPermissions((prev) => [...prev, event]);
    return;
  }

  if (event.type === "question") {
    setPendingQuestions((prev) => [...prev, event]);
    return;
  }

  if (event.type === "thinking" && event.content) {
    updateActiveMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId
          ? Object.assign({}, m, {
              processContent: (m.processContent ?? "") + event.content,
              isProcessStreaming: true,
            })
          : m,
      ),
    );
    return;
  }

  if (event.type === "tool_call") {
    pendingToolNameRef.current = event.name;
    animation.cut(assistantId);
    return;
  }

  if (event.type === "tool_input") {
    const toolName = pendingToolNameRef.current;
    pendingToolNameRef.current = null;
    if (!toolName) return;
    let parsedInput: Record<string, unknown>;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- JSON from trusted SSE stream
      parsedInput = JSON.parse(event.content) as Record<string, unknown>;
    } catch {
      parsedInput = { raw: event.content };
    }
    updateActiveMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId
          ? Object.assign({}, m, {
              segments: [
                ...m.segments,
                { type: "tool_call" as const, tool: { name: toolName, input: parsedInput } },
                { type: "text" as const, content: "" },
              ],
            })
          : m,
      ),
    );
    return;
  }

  if (event.type === "text" && event.content) {
    updateActiveMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId ? Object.assign({}, m, { isProcessStreaming: false }) : m,
      ),
    );
    animation.enqueue(assistantId, event.content);
    return;
  }

  if (event.type === "result" && event.content) {
    updateActiveMessages((prev) =>
      prev.map((m) => {
        if (m.id !== assistantId) return m;
        if (callbacks?.skipResultIfHasText) {
          const hasText = m.segments.some(
            (s) => s.type === "text" && (s as { type: "text"; content: string }).content.trim(),
          );
          if (hasText) return m;
        }
        const segs = [...m.segments];
        let lastTextIdx = -1;
        for (let i = segs.length - 1; i >= 0; i--) {
          if (segs[i].type === "text") {
            lastTextIdx = i;
            break;
          }
        }
        if (lastTextIdx >= 0) segs[lastTextIdx] = { type: "text" as const, content: event.content };
        return Object.assign({}, m, {
          segments: segs,
          isLoading: false,
          isProcessStreaming: false,
        });
      }),
    );
    return;
  }

  if (event.type === "done") {
    animation.flush(assistantId);
    updateActiveMessages((prev) =>
      prev.map((m) => {
        if (m.id !== assistantId || !m.isLoading) return m;
        const hasText = m.segments.some(
          (s) => s.type === "text" && (s as { type: "text"; content: string }).content.trim(),
        );
        if (hasText) return Object.assign({}, m, { isLoading: false, isProcessStreaming: false });
        const segs = m.segments.map((s, i, arr) => {
          if (s.type !== "text") return s;
          const isLast = arr.slice(i + 1).every((x) => x.type !== "text");
          return isLast ? { type: "text" as const, content: "(no response)" } : s;
        });
        return Object.assign({}, m, {
          segments: segs,
          isLoading: false,
          isProcessStreaming: false,
        });
      }),
    );
    callbacks?.onDone?.();
    return;
  }

  if (event.type === "cancelled") {
    setPendingPermissions([]);
    setPendingQuestions([]);
    animation.flush(assistantId);
    updateActiveMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId
          ? Object.assign({}, m, { isLoading: false, isProcessStreaming: false, isCancelled: true })
          : m,
      ),
    );
    callbacks?.onCancelled?.();
    return;
  }

  if (event.type === "error" && event.content) {
    animation.flush(assistantId);
    updateActiveMessages((prev) =>
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
          segs[lastTextIdx] = { type: "text" as const, content: `⚠️ ${event.content}` };
        return Object.assign({}, m, {
          segments: segs,
          isLoading: false,
          isProcessStreaming: false,
        });
      }),
    );
  }
}
