"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { z } from "zod";
import { sessionMessageSchema } from "@/lib/message-types";
import type { ChatSsePermission } from "@/lib/chat-sse";
import type { ChatSseEvent } from "@/lib/chat-sse";
import { useTextAnimation } from "./use-text-animation";
import type { ChatMessage } from "./use-messages";
import { mergeProgressEntries } from "./use-messages";
import type { ProgressEntry } from "@/lib/query-tools";
import {
  agentChatUrl,
  sessionStreamUrl,
  activeSessionUrl,
  sessionDetailUrl,
  agentSessionsUrl,
  type AgentId,
} from "@/lib/agent-api-urls";
import { parseSessions } from "./use-agent-sessions";

export type { ChatMessage } from "./use-messages";

const activeSessionResponseSchema = z.object({ id: z.string().nullable() });
const sessionDetailResponseSchema = z.object({
  messages: z.array(sessionMessageSchema).default([]),
  progress: z
    .array(z.object({ message: z.string(), artifacts: z.record(z.string(), z.string()) }))
    .default([]),
  status: z.enum(["running", "done", "cancelled", "interrupted"]).default("done"),
});

// ─── Types ────────────────────────────────────────────────────────────────────

export type SessionStatus = "running" | "done" | "cancelled" | "interrupted" | "pending";

export interface PerSessionState {
  /** Stable local key assigned at creation — never changes */
  key: string;
  /** null until first "session" SSE event arrives */
  sessionId: string | null;
  /** First 40 chars of the initial user message */
  label: string;
  messages: ChatMessage[];
  sessionProgress: ProgressEntry[];
  isLoading: boolean;
  isCancelled: boolean;
  hasPendingPermission: boolean;
  status: SessionStatus;
  connectionAbort: AbortController | null;
  /** FIFO order of when the connection was last opened (for background cap eviction) */
  connectionOpenedAt: number | null;
  /** Last seen SSE _seq, for reconnect */
  lastSeq: number;
}

function makeBlankSession(key: string): PerSessionState {
  return {
    key,
    sessionId: null,
    label: "",
    messages: [],
    sessionProgress: [],
    isLoading: false,
    isCancelled: false,
    hasPendingPermission: false,
    status: "pending",
    connectionAbort: null,
    connectionOpenedAt: null,
    lastSeq: 0,
  };
}

// Max concurrent SSE connections across all background sessions.
const MAX_BACKGROUND_CONNECTIONS = 5;

// ─── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Manages multiple concurrent Dove sessions, plus single-session mode for
 * non-Dove agents.
 *
 * Sessions are identified by a stable local key (UUID) assigned at creation.
 * The server-side session ID is unknown until the first "session" SSE event fires.
 *
 * State architecture:
 *   - sessionsRef   — source of truth; background updates go here (no re-render cost)
 *   - sessions      — render snapshot of sessionsRef (tab bar)
 *   - activeKey     — which session is shown in the main pane
 *   - Rendering state vars (messages, isLoading, …) mirror the active session's entry
 *
 * For non-Dove agents, the registry is bypassed and a simple single-session
 * mode is used instead, with singleAbortRef and singleSessionIdRef tracking state.
 */
export function useSessionRegistry() {
  // ─── Session map ─────────────────────────────────────────────────────────────
  const sessionsRef = useRef<Map<string, PerSessionState>>(new Map());
  const [sessions, setSessions] = useState<PerSessionState[]>([]);

  // ─── Active session key ───────────────────────────────────────────────────────
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const activeKeyRef = useRef<string | null>(null);

  // ─── Active session rendering state ──────────────────────────────────────────
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionProgress, setSessionProgress] = useState<ProgressEntry[]>([]);
  const [sessionCancelled, setSessionCancelled] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [pendingPermissions, setPendingPermissions] = useState<ChatSsePermission[]>([]);

  // ─── Refs that mirror rendering state for sync-back before tab switch ────────
  const messagesRef = useRef<ChatMessage[]>([]);
  const sessionProgressRef = useRef<ProgressEntry[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    sessionProgressRef.current = sessionProgress;
  }, [sessionProgress]);

  // ─── Per-stream refs ──────────────────────────────────────────────────────────
  const assistantIdRef = useRef<string | null>(null);
  const pendingToolNameRef = useRef<string | null>(null);

  // ─── Active agent — "dove" enables multi-session registry; others use single-session mode ─
  const [activeAgentId, setActiveAgentIdState] = useState<AgentId>("dove");
  const activeAgentIdRef = useRef<AgentId>("dove");

  // For non-Dove agents: single-session abort, session ID, and last-seen SSE seq tracking
  const singleAbortRef = useRef<AbortController | null>(null);
  const singleSessionIdRef = useRef<string | null>(null);
  const singleLastSeqRef = useRef<number>(0);

  // ─── Active message sync ───────────────────────────────────────────────────────
  // All active-session message mutations MUST go through this function.
  // It writes to both React rendering state AND sessionsRef in one atomic step,
  // preventing the two stores from diverging. Background session message updates
  // should go through patchEntry instead (ref → rendering direction).
  const updateActiveMessages = useCallback((updater: (prev: ChatMessage[]) => ChatMessage[]) => {
    setMessages((prev) => {
      const next = updater(prev);
      const key = activeKeyRef.current;
      if (key) {
        const entry = sessionsRef.current.get(key);
        if (entry) sessionsRef.current.set(key, { ...entry, messages: next });
      }
      return next;
    });
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

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  /** Snapshot sessionsRef into the sessions state (for tab bar re-render). */
  const snapshotSessions = useCallback(() => {
    setSessions([...sessionsRef.current.values()]);
  }, []);

  /** Sync active session's rendering state from sessionsRef. */
  const syncActiveFromRef = useCallback((key: string) => {
    const entry = sessionsRef.current.get(key);
    if (!entry) return;
    setMessages(entry.messages);
    setSessionProgress(entry.sessionProgress);
    setIsLoading(entry.isLoading);
    setSessionCancelled(entry.isCancelled);
    setCurrentSessionId(entry.sessionId);
  }, []);

  /** Write current rendering state back to sessionsRef for the active key.
   *  Must be called before switching away so the entry has the latest data. */
  const syncActiveToRef = useCallback(() => {
    const key = activeKeyRef.current;
    if (!key) return;
    const entry = sessionsRef.current.get(key);
    if (!entry) return;
    sessionsRef.current.set(key, {
      ...entry,
      messages: messagesRef.current,
      sessionProgress: sessionProgressRef.current,
    });
  }, []);

  /** Patch an entry in sessionsRef and optionally sync to rendering state. */
  const patchEntry = useCallback(
    (key: string, update: Partial<PerSessionState>) => {
      const entry = sessionsRef.current.get(key);
      if (!entry) return;
      const next = { ...entry, ...update };
      sessionsRef.current.set(key, next);
      // Always snapshot so tab bar badges (hasPendingPermission) stay fresh.
      snapshotSessions();
      // If this is the active session, sync rendering state.
      if (key === activeKeyRef.current) {
        if ("messages" in update) setMessages(next.messages);
        if ("sessionProgress" in update) setSessionProgress(next.sessionProgress);
        if ("isLoading" in update) setIsLoading(next.isLoading);
        if ("isCancelled" in update) setSessionCancelled(next.isCancelled);
        if ("sessionId" in update) setCurrentSessionId(next.sessionId);
      }
    },
    [snapshotSessions],
  );

  // ─── Background connection cap ────────────────────────────────────────────────
  /** Evict the oldest background SSE connection if we're at the cap. */
  const evictOldestBackgroundIfNeeded = useCallback(() => {
    const backgroundConnected = [...sessionsRef.current.values()].filter(
      (e) => e.key !== activeKeyRef.current && e.connectionAbort !== null,
    );
    if (backgroundConnected.length < MAX_BACKGROUND_CONNECTIONS) return;
    // Sort by connectionOpenedAt ascending, evict the oldest
    backgroundConnected.sort((a, b) => (a.connectionOpenedAt ?? 0) - (b.connectionOpenedAt ?? 0));
    const oldest = backgroundConnected[0];
    if (!oldest) return;
    oldest.connectionAbort?.abort();
    patchEntry(oldest.key, { connectionAbort: null, connectionOpenedAt: null });
  }, [patchEntry]);

  // ─── SSE event processing ─────────────────────────────────────────────────────
  /**
   * Process a single SSE event for a given session key.
   * Updates sessionsRef and (if active) the rendering state.
   */
  const processEvent = useCallback(
    (key: string, event: ChatSseEvent, assistantId: string) => {
      const entry = sessionsRef.current.get(key);
      if (!entry) return;

      const seq = (event as Record<string, unknown>)._seq;
      if (typeof seq === "number") {
        patchEntry(key, { lastSeq: seq });
      }

      const isActive = key === activeKeyRef.current;

      if (event.type === "permission") {
        patchEntry(key, { hasPendingPermission: true });
        if (isActive) setPendingPermissions((prev) => [...prev, event]);
        return;
      }

      if (event.type === "session") {
        patchEntry(key, { sessionId: event.sessionId });
        return;
      }

      if (event.type === "progress") {
        const latestEntry = sessionsRef.current.get(key);
        const merged = mergeProgressEntries(
          latestEntry?.sessionProgress ?? [],
          event.result.progress,
        );
        patchEntry(key, { sessionProgress: merged });
        // Set the live tool-call indicator on the assistant message bubble
        const lastToolCall = event.result.progress.at(-1)?.artifacts["tool-call"];
        if (lastToolCall) {
          if (isActive) {
            updateActiveMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, liveProgress: lastToolCall } : m)),
            );
          } else {
            const e = sessionsRef.current.get(key);
            if (e) {
              const updatedMsgs = e.messages.map((m) =>
                m.id === assistantId ? { ...m, liveProgress: lastToolCall } : m,
              );
              sessionsRef.current.set(key, { ...e, messages: updatedMsgs });
            }
          }
        }
        return;
      }

      if (event.type === "thinking" && event.content) {
        if (isActive) {
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
        } else {
          const latestEntry = sessionsRef.current.get(key);
          if (!latestEntry) return;
          patchEntry(key, {
            messages: latestEntry.messages.map((m) =>
              m.id === assistantId
                ? Object.assign({}, m, {
                    processContent: (m.processContent ?? "") + event.content,
                    isProcessStreaming: true,
                  })
                : m,
            ),
          });
        }
        return;
      }

      if (event.type === "tool_call") {
        pendingToolNameRef.current = event.name;
        if (isActive) animation.cut(assistantId);
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
        if (isActive) {
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
        } else {
          const latestEntry = sessionsRef.current.get(key);
          if (!latestEntry) return;
          patchEntry(key, {
            messages: latestEntry.messages.map((m) =>
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
          });
        }
        return;
      }

      if (event.type === "text" && event.content) {
        if (isActive) {
          updateActiveMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? Object.assign({}, m, { isProcessStreaming: false }) : m,
            ),
          );
          animation.enqueue(assistantId, event.content);
        } else {
          // For background sessions, accumulate text directly (no animation)
          const latestEntry = sessionsRef.current.get(key);
          if (!latestEntry) return;
          const updatedMsgs = latestEntry.messages.map((m) => {
            if (m.id !== assistantId) return m;
            const segs = [...m.segments];
            let lastTextIdx = -1;
            for (let i = segs.length - 1; i >= 0; i--) {
              if (segs[i].type === "text") {
                lastTextIdx = i;
                break;
              }
            }
            const existingSeg = lastTextIdx >= 0 ? segs[lastTextIdx] : null;
            const prevContent = existingSeg?.type === "text" ? existingSeg.content : "";
            const accumulated = prevContent + event.content;
            const updated = [...segs];
            if (lastTextIdx >= 0) {
              updated[lastTextIdx] = { type: "text" as const, content: accumulated };
            } else {
              updated.push({ type: "text" as const, content: accumulated });
            }
            return Object.assign({}, m, { segments: updated, isProcessStreaming: false });
          });
          patchEntry(key, { messages: updatedMsgs });
        }
        return;
      }

      if (event.type === "result" && event.content) {
        // Replace last text segment with the final result — same as setLastTextContent in useConversations.
        const applyResult = (prev: ChatMessage[]): ChatMessage[] =>
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
              segs[lastTextIdx] = { type: "text" as const, content: event.content };
            return Object.assign({}, m, {
              segments: segs,
              isLoading: false,
              isProcessStreaming: false,
            });
          });
        if (isActive) {
          updateActiveMessages(applyResult);
        } else {
          const latestEntry = sessionsRef.current.get(key);
          if (!latestEntry) return;
          patchEntry(key, { messages: applyResult(latestEntry.messages) });
        }
        return;
      }

      if (event.type === "cancelled") {
        if (isActive) {
          setPendingPermissions([]);
          animation.flush(assistantId);
        }
        const latestEntry = sessionsRef.current.get(key);
        if (!latestEntry) return;
        const updatedMsgs = latestEntry.messages.map((m) =>
          m.id === assistantId
            ? Object.assign({}, m, {
                isLoading: false,
                isProcessStreaming: false,
                isCancelled: true,
              })
            : m,
        );
        patchEntry(key, {
          messages: updatedMsgs,
          isLoading: false,
          isCancelled: true,
          status: "cancelled",
        });
        return;
      }

      if (event.type === "error" && event.content) {
        if (isActive) {
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
        } else {
          const latestEntry = sessionsRef.current.get(key);
          if (!latestEntry) return;
          const updatedMsgs = latestEntry.messages.map((m) => {
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
          });
          patchEntry(key, { messages: updatedMsgs, isLoading: false });
        }
        return;
      }

      if (event.type === "done") {
        if (isActive) {
          animation.flush(assistantId);
          updateActiveMessages((prev) =>
            prev.map((m) => {
              if (m.id !== assistantId || !m.isLoading) return m;
              const hasText = m.segments.some(
                (s) => s.type === "text" && (s as { type: "text"; content: string }).content.trim(),
              );
              if (hasText)
                return Object.assign({}, m, { isLoading: false, isProcessStreaming: false });
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
        } else {
          const latestEntry = sessionsRef.current.get(key);
          if (!latestEntry) return;
          const updatedMsgs = latestEntry.messages.map((m) => {
            if (m.id !== assistantId || !m.isLoading) return m;
            const hasText = m.segments.some(
              (s) => s.type === "text" && (s as { type: "text"; content: string }).content.trim(),
            );
            if (hasText)
              return Object.assign({}, m, { isLoading: false, isProcessStreaming: false });
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
          });
          patchEntry(key, { messages: updatedMsgs, isLoading: false, status: "done" });
        }
        patchEntry(key, { isLoading: false, status: "done" });
        return;
      }
    },
    [patchEntry, updateActiveMessages, animation],
  );

  // ─── Stream reader ────────────────────────────────────────────────────────────
  /**
   * Read SSE events from a response body and dispatch them to processEvent.
   * Returns when the stream ends or the abort controller fires.
   */
  const readStream = useCallback(
    async (key: string, body: ReadableStream<Uint8Array>, assistantId: string) => {
      const reader = body.getReader();
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
            processEvent(key, event, assistantId);
          } catch {
            // ignore malformed SSE lines
          }
        }
      }
    },
    [processEvent],
  );

  // ─── reconnectToSession ───────────────────────────────────────────────────────
  /**
   * Fire-and-forget: open a new SSE connection for a session already in the
   * registry that still has isLoading:true.  No-ops if the session is not
   * running or has no server session ID.
   */
  const reconnectToSession = useCallback(
    (key: string) => {
      const entry = sessionsRef.current.get(key);
      if (!entry?.isLoading || !entry.sessionId) return;

      evictOldestBackgroundIfNeeded();
      const abort = new AbortController();
      patchEntry(key, { connectionAbort: abort, connectionOpenedAt: Date.now() });
      const lastAssistant = entry.messages.toReversed().find((m) => m.role === "assistant");
      const resumeAssistantId = lastAssistant?.id ?? crypto.randomUUID();
      assistantIdRef.current = resumeAssistantId;
      const url = `${sessionStreamUrl(entry.sessionId)}?after=${entry.lastSeq}`;

      void (async () => {
        try {
          const response = await fetch(url, { signal: abort.signal });
          if (response.ok && response.body) {
            await readStream(key, response.body, resumeAssistantId);
          }
        } catch (err: unknown) {
          if (err instanceof Error && err.name !== "AbortError") {
            console.warn("[useSessionRegistry] reconnect error:", err);
          }
        } finally {
          patchEntry(key, { connectionAbort: null, connectionOpenedAt: null });
        }
      })();
    },
    [sessionsRef, evictOldestBackgroundIfNeeded, patchEntry, readStream],
  );

  // ─── disconnectStream ─────────────────────────────────────────────────────────
  /** Abort a session's SSE connection without killing the server-side subprocess. */
  const disconnectStream = useCallback(
    (key: string) => {
      const entry = sessionsRef.current.get(key);
      if (!entry?.connectionAbort) return;
      entry.connectionAbort.abort();
      patchEntry(key, { connectionAbort: null, connectionOpenedAt: null });
    },
    [patchEntry],
  );

  // ─── createSession ────────────────────────────────────────────────────────────
  /** Create a blank session entry and set it as active. Returns the new key. */
  const createSession = useCallback((): string => {
    const key = crypto.randomUUID();
    const blank = makeBlankSession(key);
    sessionsRef.current.set(key, blank);
    snapshotSessions();
    activeKeyRef.current = key;
    setActiveKey(key);
    // Reset all rendering state for the new blank session
    pendingQueueRef.current = [];
    setPendingQueue([]);
    setMessages([]);
    setSessionProgress([]);
    setIsLoading(false);
    setSessionCancelled(false);
    setCurrentSessionId(null);
    setPendingPermissions([]);
    return key;
  }, [snapshotSessions]);

  // ─── connectSingleSessionStream ───────────────────────────────────────────────
  /**
   * Connect to a running non-Dove session's live SSE stream.
   *
   * Two modes:
   *  - warm (warmReconnect=true):  user was previously connected; singleLastSeqRef has
   *    the last seen seq.  Reconnects with after=lastSeq so only NEW events arrive and
   *    update the existing last assistant message in-place.
   *  - cold (warmReconnect=false): first time connecting (e.g. clicking history). Adds
   *    a fresh blank loading assistant message and replays the buffer from after=0 into
   *    it so the in-progress turn is rebuilt from scratch.
   */
  const connectSingleSessionStream = useCallback(
    (sessionId: string, agentId: string, warmReconnect: boolean) => {
      singleAbortRef.current?.abort();
      const abort = new AbortController();
      singleAbortRef.current = abort;

      // Determine which assistant message to update and what seq to start from.
      let resumeAssistantId: string;
      if (warmReconnect) {
        const lastAssistant = messagesRef.current.toReversed().find((m) => m.role === "assistant");
        resumeAssistantId = lastAssistant?.id ?? crypto.randomUUID();
      } else {
        // Cold: append a fresh blank loading message; stream replay will fill it in.
        resumeAssistantId = crypto.randomUUID();
        singleLastSeqRef.current = 0;
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
      assistantIdRef.current = resumeAssistantId;

      const after = warmReconnect ? singleLastSeqRef.current : 0;
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

                if (event.type === "session") {
                  singleSessionIdRef.current = event.sessionId;
                  setCurrentSessionId(event.sessionId);
                } else if (event.type === "progress") {
                  setSessionProgress((prev) => mergeProgressEntries(prev, event.result.progress));
                } else if (event.type === "thinking" && event.content) {
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === resumeAssistantId
                        ? Object.assign({}, m, {
                            processContent: (m.processContent ?? "") + event.content,
                            isProcessStreaming: true,
                          })
                        : m,
                    ),
                  );
                } else if (event.type === "tool_call") {
                  animation.cut(resumeAssistantId);
                  pendingToolNameRef.current = event.name;
                } else if (event.type === "tool_input") {
                  const toolName = pendingToolNameRef.current;
                  pendingToolNameRef.current = null;
                  if (toolName) {
                    let parsedInput: Record<string, unknown>;
                    try {
                      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- JSON from trusted SSE stream
                      parsedInput = JSON.parse(event.content) as Record<string, unknown>;
                    } catch {
                      parsedInput = { raw: event.content };
                    }
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === resumeAssistantId
                          ? Object.assign({}, m, {
                              segments: [
                                ...m.segments,
                                {
                                  type: "tool_call" as const,
                                  tool: { name: toolName, input: parsedInput },
                                },
                                { type: "text" as const, content: "" },
                              ],
                            })
                          : m,
                      ),
                    );
                  }
                } else if (event.type === "text" && event.content) {
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === resumeAssistantId
                        ? Object.assign({}, m, { isProcessStreaming: false })
                        : m,
                    ),
                  );
                  animation.enqueue(resumeAssistantId, event.content);
                } else if (event.type === "result" && event.content) {
                  setMessages((prev) =>
                    prev.map((m) => {
                      if (m.id !== resumeAssistantId) return m;
                      const segs = [...m.segments];
                      let lastTextIdx = -1;
                      for (let i = segs.length - 1; i >= 0; i--) {
                        if (segs[i].type === "text") {
                          lastTextIdx = i;
                          break;
                        }
                      }
                      if (lastTextIdx >= 0)
                        segs[lastTextIdx] = { type: "text" as const, content: event.content };
                      return Object.assign({}, m, {
                        segments: segs,
                        isLoading: false,
                        isProcessStreaming: false,
                      });
                    }),
                  );
                } else if (event.type === "cancelled") {
                  animation.flush(resumeAssistantId);
                  setSessionCancelled(true);
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === resumeAssistantId
                        ? Object.assign({}, m, {
                            isLoading: false,
                            isProcessStreaming: false,
                            isCancelled: true,
                          })
                        : m,
                    ),
                  );
                } else if (event.type === "error" && event.content) {
                  animation.flush(resumeAssistantId);
                  setMessages((prev) =>
                    prev.map((m) => {
                      if (m.id !== resumeAssistantId) return m;
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
                          content: `⚠️ ${event.content}`,
                        };
                      return Object.assign({}, m, {
                        segments: segs,
                        isLoading: false,
                        isProcessStreaming: false,
                      });
                    }),
                  );
                } else if (event.type === "done") {
                  animation.flush(resumeAssistantId);
                  setMessages((prev) =>
                    prev.map((m) => {
                      if (m.id !== resumeAssistantId || !m.isLoading) return m;
                      const hasText = m.segments.some(
                        (s) =>
                          s.type === "text" &&
                          (s as { type: "text"; content: string }).content.trim(),
                      );
                      if (hasText)
                        return Object.assign({}, m, {
                          isLoading: false,
                          isProcessStreaming: false,
                        });
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
                }
              } catch {
                // ignore malformed SSE lines
              }
            }
          }
        } catch (err: unknown) {
          if (err instanceof Error && err.name === "AbortError") return;
          animation.flush(resumeAssistantId);
        } finally {
          setIsLoading(false);
          if (singleAbortRef.current === abort) singleAbortRef.current = null;
        }
      })();
    },
    [animation, messagesRef],
  );

  // ─── setActiveAgentId ─────────────────────────────────────────────────────────
  const setActiveAgentId = useCallback(
    (agentId: string) => {
      const current = activeAgentIdRef.current;
      if (current === agentId) return;

      // Save current Dove session rendering state back to ref before switching away.
      // Only meaningful for Dove (multi-session registry); subagents have no registry entry.
      if (current === "dove") syncActiveToRef();

      // Abort any in-flight streams
      singleAbortRef.current?.abort();
      singleAbortRef.current = null;
      // Disconnect the active Dove session's SSE (subprocess stays alive)
      const currentKey = activeKeyRef.current;
      if (currentKey) {
        const entry = sessionsRef.current.get(currentKey);
        entry?.connectionAbort?.abort();
      }

      animation.reset();
      setPendingPermissions([]);
      setMessages([]);
      setSessionProgress([]);
      setSessionCancelled(false);
      pendingQueueRef.current = [];
      setPendingQueue([]);
      setIsLoading(false);
      setCurrentSessionId(null);
      singleSessionIdRef.current = null;
      singleLastSeqRef.current = 0;

      activeAgentIdRef.current = agentId;
      setActiveAgentIdState(agentId);

      // ── Switching back to Dove: restore from in-memory registry ─────────────
      // sessionsRef still holds the Dove session with isLoading:true even while
      // the user was in another agent tab — restore it instead of hitting the DB.
      if (agentId === "dove") {
        const key = activeKeyRef.current;
        const doveEntry = key ? sessionsRef.current.get(key) : null;
        if (doveEntry) {
          syncActiveFromRef(key!);
          reconnectToSession(key!);
          return;
        }
        // No registry entry for Dove — fall through to DB load
      }

      void (async () => {
        try {
          const { id } = activeSessionResponseSchema.parse(
            await (await fetch(activeSessionUrl(agentId))).json(),
          );
          let resolvedContextId = id;
          if (!resolvedContextId && agentId !== "dove") {
            if (activeAgentIdRef.current !== agentId) return;
            const sessionsRes = await fetch(agentSessionsUrl(agentId));
            if (sessionsRes.ok) {
              const fetchedSessions = await parseSessions(sessionsRes);
              resolvedContextId = fetchedSessions[0]?.id ?? null;
            }
          }
          if (!resolvedContextId) return;
          const {
            messages: msgs,
            progress,
            status,
          } = sessionDetailResponseSchema.parse(
            await (await fetch(sessionDetailUrl(agentId, resolvedContextId))).json(),
          );
          const stamped = msgs.map((m) =>
            m.role === "assistant" ? Object.assign({}, m, { agentId }) : m,
          );
          if (activeAgentIdRef.current !== agentId) return;
          singleSessionIdRef.current = resolvedContextId;
          setCurrentSessionId(resolvedContextId);
          setMessages(stamped);
          setSessionProgress(progress);
          if (status === "running") {
            // Session was running when user switched away — reconnect to live stream.
            // Warm reconnect: singleLastSeqRef may be 0 if never connected, or > 0 if
            // the user was previously connected and we're switching back.
            setIsLoading(true);
            connectSingleSessionStream(resolvedContextId, agentId, singleLastSeqRef.current > 0);
          }
        } catch {
          // no prior session for this agent
        }
      })();
    },
    [
      animation,
      sessionsRef,
      activeKeyRef,
      syncActiveFromRef,
      reconnectToSession,
      connectSingleSessionStream,
    ],
  );

  // ─── sendMessage ──────────────────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed) return;

      // ── Non-Dove: single-session mode ──────────────────────────────────────────
      if (activeAgentIdRef.current !== "dove") {
        if (isLoading) return;
        singleAbortRef.current?.abort();
        animation.reset();
        setSessionCancelled(false);
        const abort = new AbortController();
        singleAbortRef.current = abort;

        const assistantId = crypto.randomUUID();
        assistantIdRef.current = assistantId;
        const agentId = activeAgentIdRef.current;

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
        setPendingPermissions([]);

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

                if (event.type === "permission") {
                  setPendingPermissions((prev) => [...prev, event]);
                } else if (event.type === "session") {
                  singleSessionIdRef.current = event.sessionId;
                  setCurrentSessionId(event.sessionId);
                } else if (event.type === "progress") {
                  setSessionProgress((prev) => mergeProgressEntries(prev, event.result.progress));
                } else if (event.type === "thinking" && event.content) {
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantId
                        ? Object.assign({}, m, {
                            processContent: (m.processContent ?? "") + event.content,
                            isProcessStreaming: true,
                          })
                        : m,
                    ),
                  );
                } else if (event.type === "tool_call") {
                  animation.cut(assistantId);
                  pendingToolNameRef.current = event.name;
                } else if (event.type === "tool_input") {
                  const toolName = pendingToolNameRef.current;
                  pendingToolNameRef.current = null;
                  if (toolName) {
                    let parsedInput: Record<string, unknown>;
                    try {
                      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- JSON from trusted SSE stream
                      parsedInput = JSON.parse(event.content) as Record<string, unknown>;
                    } catch {
                      parsedInput = { raw: event.content };
                    }
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === assistantId
                          ? Object.assign({}, m, {
                              segments: [
                                ...m.segments,
                                {
                                  type: "tool_call" as const,
                                  tool: { name: toolName, input: parsedInput },
                                },
                                { type: "text" as const, content: "" },
                              ],
                            })
                          : m,
                      ),
                    );
                  }
                } else if (event.type === "text" && event.content) {
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantId
                        ? Object.assign({}, m, { isProcessStreaming: false })
                        : m,
                    ),
                  );
                  animation.enqueue(assistantId, event.content);
                } else if (event.type === "result" && event.content) {
                  setMessages((prev) =>
                    prev.map((m) => {
                      if (m.id !== assistantId) return m;
                      const hasText = m.segments.some(
                        (s) =>
                          s.type === "text" &&
                          (s as { type: "text"; content: string }).content.trim(),
                      );
                      if (hasText) return m;
                      const segs = [...m.segments];
                      let lastTextIdx = -1;
                      for (let i = segs.length - 1; i >= 0; i--) {
                        if (segs[i].type === "text") {
                          lastTextIdx = i;
                          break;
                        }
                      }
                      if (lastTextIdx >= 0) {
                        segs[lastTextIdx] = { type: "text" as const, content: event.content };
                      }
                      return Object.assign({}, m, {
                        segments: segs,
                        isLoading: false,
                        isProcessStreaming: false,
                      });
                    }),
                  );
                } else if (event.type === "cancelled") {
                  setPendingPermissions([]);
                  animation.flush(assistantId);
                  setSessionCancelled(true);
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantId
                        ? Object.assign({}, m, {
                            isLoading: false,
                            isProcessStreaming: false,
                            isCancelled: true,
                          })
                        : m,
                    ),
                  );
                } else if (event.type === "error" && event.content) {
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
                          content: `⚠️ ${event.content}`,
                        };
                      return Object.assign({}, m, {
                        segments: segs,
                        isLoading: false,
                        isProcessStreaming: false,
                      });
                    }),
                  );
                } else if (event.type === "done") {
                  animation.flush(assistantId);
                  setMessages((prev) =>
                    prev.map((m) => {
                      if (m.id !== assistantId || !m.isLoading) return m;
                      const hasText = m.segments.some(
                        (s) =>
                          s.type === "text" &&
                          (s as { type: "text"; content: string }).content.trim(),
                      );
                      if (hasText)
                        return Object.assign({}, m, {
                          isLoading: false,
                          isProcessStreaming: false,
                        });
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
          setIsLoading(false);
          if (singleAbortRef.current === abort) singleAbortRef.current = null;
        }
        return;
      }

      // ── Dove multi-session mode ────────────────────────────────────────────────

      // Auto-create a session on first prompt (fresh load, no prior history)
      let key = activeKeyRef.current;
      if (!key) {
        key = createSession();
      }

      const entry = sessionsRef.current.get(key);
      if (!entry) return;

      if (entry.isLoading) {
        const next = [...pendingQueueRef.current, trimmed];
        pendingQueueRef.current = next;
        setPendingQueue(next);
        return;
      }

      // Set up label on first message
      if (!entry.label) {
        patchEntry(key, { label: trimmed.slice(0, 40) });
      }

      // Abort any existing connection for this session
      entry.connectionAbort?.abort();
      animation.reset();
      setPendingPermissions([]);

      const abort = new AbortController();
      const assistantId = crypto.randomUUID();
      assistantIdRef.current = assistantId;

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        segments: [{ type: "text", content: trimmed }],
      };
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: "assistant",
        segments: [{ type: "text", content: "" }],
        isLoading: true,
        agentId: "dove",
      };

      const latestEntry = sessionsRef.current.get(key);
      if (!latestEntry) return;
      const updatedMsgs = [...latestEntry.messages, userMsg, assistantMsg];

      patchEntry(key, {
        messages: updatedMsgs,
        isLoading: true,
        isCancelled: false,
        status: "running",
        connectionAbort: abort,
        connectionOpenedAt: Date.now(),
      });

      const endpoint = agentChatUrl("dove");

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: trimmed, sessionId: latestEntry.sessionId }),
          signal: abort.signal,
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await readStream(key, response.body!, assistantId);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          // Connection aborted (user switched away) — session is still running server-side.
          // Keep isLoading: true so switchToSession can detect it and reconnect.
          patchEntry(key, { connectionAbort: null, connectionOpenedAt: null });
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        animation.flush(assistantId);
        const latestErr = sessionsRef.current.get(key);
        if (!latestErr) return;
        const errMsgs = latestErr.messages.map((m) => {
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
            segs[lastTextIdx] = { type: "text" as const, content: `⚠️ Connection error: ${msg}` };
          return Object.assign({}, m, {
            segments: segs,
            isLoading: false,
            isProcessStreaming: false,
          });
        });
        patchEntry(key, {
          messages: errMsgs,
          isLoading: false,
          connectionAbort: null,
          connectionOpenedAt: null,
        });
      }
    },
    [isLoading, patchEntry, readStream, animation],
  );

  // ─── switchToSession ──────────────────────────────────────────────────────────
  const switchToSession = useCallback(
    async (key: string) => {
      const prevKey = activeKeyRef.current;
      if (prevKey === key) return;

      // Save current rendering state back to ref before switching away
      syncActiveToRef();

      // Disconnect the current active session's stream (subprocess stays alive)
      if (prevKey) disconnectStream(prevKey);

      animation.reset();
      setPendingPermissions([]);
      pendingQueueRef.current = [];
      setPendingQueue([]);

      activeKeyRef.current = key;
      setActiveKey(key);

      const entry = sessionsRef.current.get(key);
      if (!entry) return;

      // Sync rendering state from the session's stored data
      syncActiveFromRef(key);
      // If the session is still running with a known server session ID, reconnect
      reconnectToSession(key);
    },
    [syncActiveToRef, disconnectStream, syncActiveFromRef, reconnectToSession, animation],
  );

  // ─── stopSession ─────────────────────────────────────────────────────────────
  const stopSession = useCallback(
    async (key: string) => {
      const entry = sessionsRef.current.get(key);
      if (!entry) return;

      // Kill subprocess server-side if we have a session ID (keep the session row for resumption)
      if (entry.sessionId) {
        try {
          await fetch(agentChatUrl("dove"), {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId: entry.sessionId }),
          });
        } catch (err) {
          console.warn("[stopSession] Failed to stop session on server:", err);
        }
      }

      // Disconnect the client-side SSE connection
      disconnectStream(key);

      if (key === activeKeyRef.current) {
        const stoppedAssistantId = assistantIdRef.current;
        animation.flush(stoppedAssistantId ?? "");
        assistantIdRef.current = null;
        setPendingPermissions([]);
        if (stoppedAssistantId) {
          updateActiveMessages((prev) =>
            prev.map((m) =>
              m.id === stoppedAssistantId
                ? Object.assign({}, m, { isLoading: false, isCancelled: true })
                : m,
            ),
          );
        }
        setSessionCancelled(true);
        setIsLoading(false);
      }

      patchEntry(key, { isLoading: false, isCancelled: true, status: "cancelled" });
    },
    [disconnectStream, patchEntry, updateActiveMessages, animation],
  );

  // ─── newSession ───────────────────────────────────────────────────────────────
  /**
   * For Dove: creates a blank session slot and makes it active.
   * For non-Dove: resets the single-session conversation.
   * Does NOT kill or alter existing sessions.
   */
  const newSession = useCallback(() => {
    if (activeAgentIdRef.current !== "dove") {
      // Non-Dove: reset the single-session conversation
      singleAbortRef.current?.abort();
      singleAbortRef.current = null;
      singleSessionIdRef.current = null;
      pendingQueueRef.current = [];
      setPendingQueue([]);
      setMessages([]);
      setSessionProgress([]);
      setSessionCancelled(false);
      setIsLoading(false);
      setCurrentSessionId(null);
      // Tell server to clear active session
      void fetch(activeSessionUrl(activeAgentIdRef.current), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: null }),
      });
      return;
    }
    // Disconnect the current session's SSE stream (subprocess stays alive)
    const prevKey = activeKeyRef.current;
    if (prevKey) disconnectStream(prevKey);
    createSession();
  }, [createSession, disconnectStream]);

  // ─── cancelMessage ────────────────────────────────────────────────────────────
  const cancelMessage = useCallback(() => {
    if (activeAgentIdRef.current !== "dove") {
      singleAbortRef.current?.abort();
      singleAbortRef.current = null;
      animation.flush(assistantIdRef.current ?? "");
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantIdRef.current
            ? Object.assign({}, m, { isLoading: false, isCancelled: true })
            : m,
        ),
      );
      setSessionCancelled(true);
      setIsLoading(false);
      return;
    }
    const key = activeKeyRef.current;
    if (!key) return;
    void stopSession(key);
  }, [stopSession, animation]);

  // ─── resolvePermission ────────────────────────────────────────────────────────
  const resolvePermission = useCallback(
    async (requestId: string, allowed: boolean) => {
      try {
        const res = await fetch("/api/chat/permission", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId, allowed }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // Filter out the resolved permission and clear the tab badge when none remain
        const key = activeKeyRef.current;
        setPendingPermissions((prev) => {
          const next = prev.filter((p) => p.requestId !== requestId);
          if (key && next.length === 0) {
            patchEntry(key, { hasPendingPermission: false });
          }
          return next;
        });
      } catch {
        // Leave the banner visible so the user can retry.
      }
    },
    [patchEntry],
  );

  // ─── Pending queue ──────────────────────────────────────────────────────────
  // Queue follow-up prompts submitted while a Dove session is still generating.

  const [pendingQueue, setPendingQueue] = useState<string[]>([]);
  const pendingQueueRef = useRef<string[]>([]);

  const removeFromQueue = useCallback((index: number) => {
    const next = pendingQueueRef.current.filter((_, i) => i !== index);
    pendingQueueRef.current = next;
    setPendingQueue(next);
  }, []);
  const deleteSession = useCallback(
    async (contextId: string) => {
      if (activeAgentIdRef.current !== "dove") {
        // Non-Dove: delete via agent-specific endpoint
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
        if (singleSessionIdRef.current === contextId) {
          singleAbortRef.current?.abort();
          singleAbortRef.current = null;
          singleSessionIdRef.current = null;
          setMessages([]);
          setSessionProgress([]);
          setSessionCancelled(false);
          setIsLoading(false);
          setCurrentSessionId(null);
        }
        return;
      }
      // Find session in registry by server sessionId (may be absent for history-only sessions)
      let foundKey: string | null = null;
      for (const [k, entry] of sessionsRef.current) {
        if (entry.sessionId === contextId) {
          foundKey = k;
          break;
        }
      }
      const entry = foundKey ? sessionsRef.current.get(foundKey) : null;
      // Disconnect client-side SSE if the session is still streaming
      if (foundKey && entry?.isLoading) disconnectStream(foundKey);
      // Always delete from server (aborts subprocess if running, removes DB row)
      try {
        await fetch(agentChatUrl("dove"), {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: contextId }),
        });
      } catch {
        // best effort
      }
      if (foundKey) {
        sessionsRef.current.delete(foundKey);
        snapshotSessions();
        if (foundKey === activeKeyRef.current) {
          activeKeyRef.current = null;
          setActiveKey(null);
          // Reset rendering state to landing page
          setMessages([]);
          setSessionProgress([]);
          setSessionCancelled(false);
          setIsLoading(false);
          setCurrentSessionId(null);
          setPendingPermissions([]);
        }
      }
    },
    [disconnectStream, snapshotSessions],
  );

  const setSessionId = useCallback(
    async (id: string | null) => {
      if (activeAgentIdRef.current !== "dove") {
        if (!id) return;
        const agentId = activeAgentIdRef.current;
        // Abort any current stream before loading the historical session
        singleAbortRef.current?.abort();
        singleAbortRef.current = null;
        singleLastSeqRef.current = 0;
        animation.reset();
        setMessages([]);
        setSessionProgress([]);
        setIsLoading(false);
        setSessionCancelled(false);
        setPendingPermissions([]);
        void (async () => {
          try {
            const {
              messages: msgs,
              progress,
              status,
            } = sessionDetailResponseSchema.parse(
              await (await fetch(sessionDetailUrl(agentId, id))).json(),
            );
            if (activeAgentIdRef.current !== agentId) return;
            const stamped = msgs.map((m) =>
              m.role === "assistant" ? Object.assign({}, m, { agentId }) : m,
            );
            singleSessionIdRef.current = id;
            setCurrentSessionId(id);
            setMessages(stamped);
            setSessionProgress(progress);
            setSessionCancelled(status === "cancelled");
            if (status === "running") {
              // Cold reconnect — never been connected to this session; replay from seq 0
              // into a new blank assistant message so the in-progress turn is visible.
              setIsLoading(true);
              connectSingleSessionStream(id, agentId, false);
            }
          } catch {
            singleSessionIdRef.current = id;
            setCurrentSessionId(id);
          }
        })();
        return;
      }
      // Dove: load the historical session from DB into the registry
      if (!id) return;
      // Check if we already have this session in the registry
      for (const [existingKey, entry] of sessionsRef.current) {
        if (entry.sessionId === id) {
          void switchToSession(existingKey);
          return;
        }
      }
      // Not in registry — disconnect the current stream and create a new entry
      const prevKeyForHistory = activeKeyRef.current;
      if (prevKeyForHistory) disconnectStream(prevKeyForHistory);
      syncActiveToRef();
      const key = crypto.randomUUID();
      const blank = makeBlankSession(key);
      blank.sessionId = id;
      let isRunning = false;
      try {
        const {
          messages: msgs,
          progress,
          status,
        } = sessionDetailResponseSchema.parse(
          await (await fetch(sessionDetailUrl("dove", id))).json(),
        );
        blank.messages = msgs.map((m) =>
          m.role === "assistant" ? Object.assign({}, m, { agentId: "dove" }) : m,
        );
        blank.sessionProgress = progress;
        blank.status = status;
        isRunning = status === "running";
        if (isRunning) blank.isLoading = true;
      } catch {
        // couldn't load — show empty session with the known ID
      }
      sessionsRef.current.set(key, blank);
      snapshotSessions();
      activeKeyRef.current = key;
      setActiveKey(key);
      syncActiveFromRef(key);
      if (isRunning) reconnectToSession(key);
    },
    [
      switchToSession,
      syncActiveToRef,
      syncActiveFromRef,
      snapshotSessions,
      reconnectToSession,
      animation,
      connectSingleSessionStream,
      disconnectStream,
    ],
  );

  // ─── Queue drain effect ─────────────────────────────────────────────────────
  // Process the next queued prompt when the current one finishes.
  useEffect(() => {
    if (isLoading || pendingQueueRef.current.length === 0) return;
    const [next, ...rest] = pendingQueueRef.current;
    pendingQueueRef.current = rest;
    setPendingQueue(rest);
    void sendMessage(next);
  }, [isLoading, sendMessage]);

  return {
    // ─── Multi-session API ───────────────────────────────────────────────────────
    sessions: activeAgentId === "dove" ? sessions : [],
    activeSessionKey: activeKey,
    switchToSession,
    stopSession,
    createSession,
    newSession,

    // ─── Active session rendering (drop-in for useConversations) ────────────────
    messages,
    sessionProgress,
    sessionCancelled,
    currentSessionId,
    isLoading,
    sendMessage,
    cancelMessage,
    pendingPermissions,
    resolvePermission,

    // ─── Agent switching ─────────────────────────────────────────────────────────
    activeAgentId,
    setActiveAgentId,

    // ─── Stubs for useConversations compatibility ────────────────────────────────
    pendingQueue,
    removeFromQueue,
    deleteSession,
    setSessionId,
  };
}
