"use client";

import { useState, useCallback, useRef, useEffect } from "react";
export type { ToolCall, MessageSegment, SessionMessage } from "@/lib/message-types";
import type { MessageSegment, ToolCall } from "@/lib/message-types";

export type MessageRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  segments: MessageSegment[];
  processContent?: string;
  isProcessStreaming?: boolean;
  isLoading?: boolean;
  isCancelled?: boolean;
  liveProgress?: string | null;
  /** Which agent sent this message — "dove" or a subagent name */
  agentId?: string;
  /** For user-role messages in group chat: which agent sent the message */
  senderAgentId?: string;
}

/** Extract all text from a message's segments as a single string. */
export function messageText(m: ChatMessage): string {
  return m.segments
    .filter((s): s is { type: "text"; content: string } => s.type === "text")
    .map((s) => s.content)
    .join("");
}

export function useMessages() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const ref = useRef<ChatMessage[]>([]);
  useEffect(() => {
    ref.current = messages;
  }, [messages]);

  const patch = useCallback(
    (id: string, update: Partial<ChatMessage>) =>
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...update } : m))),
    [],
  );

  const patchWhere = useCallback(
    (
      id: string,
      predicate: (m: ChatMessage) => boolean,
      update: (m: ChatMessage) => Partial<ChatMessage>,
    ) =>
      setMessages((prev) =>
        prev.map((m) => (m.id === id && predicate(m) ? { ...m, ...update(m) } : m)),
      ),
    [],
  );

  const appendToProcess = useCallback(
    (id: string, delta: string) =>
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id
            ? { ...m, processContent: (m.processContent ?? "") + delta, isProcessStreaming: true }
            : m,
        ),
      ),
    [],
  );

  /** Update the last text segment's content. Used by the animation callback. */
  const setLastTextContent = useCallback(
    (id: string, content: string) =>
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== id) return m;
          const segments = [...m.segments];
          let lastTextIdx = -1;
          for (let i = segments.length - 1; i >= 0; i--) {
            if (segments[i].type === "text") {
              lastTextIdx = i;
              break;
            }
          }
          if (lastTextIdx === -1) {
            return { ...m, segments: [...segments, { type: "text", content }], isLoading: false };
          }
          const updated = [...segments];
          updated[lastTextIdx] = { type: "text", content };
          return { ...m, segments: updated, isLoading: false };
        }),
      ),
    [],
  );

  /** Append a tool_call segment then a new empty text segment for subsequent streaming text. */
  const appendToolCallSegment = useCallback(
    (id: string, tool: ToolCall) =>
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id
            ? {
                ...m,
                segments: [
                  ...m.segments,
                  { type: "tool_call" as const, tool },
                  { type: "text" as const, content: "" },
                ],
              }
            : m,
        ),
      ),
    [],
  );

  const setLiveProgress = useCallback(
    (id: string, progress: string | null) =>
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, liveProgress: progress } : m))),
    [],
  );

  const append = useCallback(
    (...newMessages: ChatMessage[]) => setMessages((prev) => [...prev, ...newMessages]),
    [],
  );

  const clear = useCallback(() => setMessages([]), []);

  const find = useCallback((id: string) => ref.current.find((m) => m.id === id), []);

  return {
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
    find,
  };
}
