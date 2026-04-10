"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { ChatSseEvent } from "@/lib/chat-sse";
import { mergeProgressEntries } from "./use-messages";
import { agentChatUrl, sessionStreamUrl } from "@/lib/agent-api-urls";
import {
  fetchSessionDetail,
  makeBlankSession,
  MAX_BACKGROUND_CONNECTIONS,
  type PerSessionState,
  type SharedSessionContext,
} from "./shared-session-context";
import { processActiveStreamEvent } from "./process-stream-event";

export function useDoveSession(sharedCtx: SharedSessionContext) {
  // ─── Session map ─────────────────────────────────────────────────────────────
  const sessionsRef = useRef<Map<string, PerSessionState>>(new Map());
  const [sessions, setSessions] = useState<PerSessionState[]>([]);

  // ─── Active session key ───────────────────────────────────────────────────────
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const activeKeyRef = useRef<string | null>(null);

  // ─── Ref for session progress (needed for syncActiveToRef) ────────────────────
  const sessionProgressRef = useRef<import("@/lib/query-tools").ProgressEntry[]>([]);
  useEffect(() => {
    sessionProgressRef.current = [];
  }, []);

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  /** Snapshot sessionsRef into the sessions state (for tab bar re-render). */
  const snapshotSessions = useCallback(() => {
    setSessions([...sessionsRef.current.values()]);
  }, []);

  /** Sync active session's rendering state from sessionsRef. */
  const syncActiveFromRef = useCallback(
    (key: string) => {
      const entry = sessionsRef.current.get(key);
      if (!entry) return;
      sharedCtx.session.setMessages(entry.messages);
      sharedCtx.session.setSessionProgress(entry.sessionProgress);
      sharedCtx.session.setIsLoading(entry.isLoading);
      sharedCtx.session.setSessionCancelled(entry.isCancelled);
      sharedCtx.session.setCurrentSessionId(entry.sessionId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sharedCtx is stable
    [sharedCtx.session],
  );

  /** Write current rendering state back to sessionsRef for the active key.
   *  Must be called before switching away so the entry has the latest data. */
  const syncActiveToRef = useCallback(() => {
    const key = activeKeyRef.current;
    if (!key) return;
    const entry = sessionsRef.current.get(key);
    if (!entry) return;
    sessionsRef.current.set(key, {
      ...entry,
      messages: sharedCtx.stream.messagesRef.current,
      sessionProgress: sessionProgressRef.current,
    });
  }, [sharedCtx.stream.messagesRef]);

  /** Keep sessionProgressRef in sync so syncActiveToRef has the latest data. */
  // We don't have direct access to sessionProgress state here, but we subscribe via setSessionProgress.
  // The orchestrator keeps its own sessionProgress state; we just need a way to read it.
  // We expose sessionProgressRef so the orchestrator can write to it.
  // For now, we rely on the orchestrator to keep sessionProgressRef updated by injecting it.

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
        if ("messages" in update) sharedCtx.session.setMessages(next.messages);
        if ("sessionProgress" in update) {
          sharedCtx.session.setSessionProgress(next.sessionProgress);
          sessionProgressRef.current = next.sessionProgress;
        }
        if ("isLoading" in update) sharedCtx.session.setIsLoading(next.isLoading);
        if ("isCancelled" in update) sharedCtx.session.setSessionCancelled(next.isCancelled);
        if ("sessionId" in update) sharedCtx.session.setCurrentSessionId(next.sessionId);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sharedCtx is stable
    [snapshotSessions, sharedCtx.session],
  );

  // ─── Background connection cap ────────────────────────────────────────────────
  /** Evict the oldest background SSE connection if we're at the cap. */
  const evictOldestBackgroundIfNeeded = useCallback(() => {
    const backgroundConnected = [...sessionsRef.current.values()].filter(
      (e) => e.key !== activeKeyRef.current && e.connectionAbort !== null,
    );
    if (backgroundConnected.length < MAX_BACKGROUND_CONNECTIONS) return;
    backgroundConnected.sort((a, b) => (a.connectionOpenedAt ?? 0) - (b.connectionOpenedAt ?? 0));
    const oldest = backgroundConnected[0];
    if (!oldest) return;
    oldest.connectionAbort?.abort();
    patchEntry(oldest.key, { connectionAbort: null, connectionOpenedAt: null });
  }, [patchEntry]);

  // ─── SSE event processing ─────────────────────────────────────────────────────
  const processEvent = useCallback(
    (key: string, event: ChatSseEvent, assistantId: string) => {
      const entry = sessionsRef.current.get(key);
      if (!entry) return;

      const seq = (event as Record<string, unknown>)._seq;
      if (typeof seq === "number") {
        patchEntry(key, { lastSeq: seq });
      }

      const isActive = key === activeKeyRef.current;

      // ── Events handled the same for all sessions (active + background) ────────

      // Permission: always update hasPendingPermission badge on the tab.
      // Active session also receives the full event for the UI permission prompt.
      if (event.type === "permission") {
        patchEntry(key, { hasPendingPermission: true });
        if (isActive) sharedCtx.session.setPendingPermissions((prev) => [...prev, event]);
        return;
      }

      // Session ID: patchEntry handles both active (calls setCurrentSessionId) and background.
      if (event.type === "session") {
        patchEntry(key, { sessionId: event.sessionId });
        return;
      }

      // Progress: patchEntry handles both paths; liveProgress needs separate active/background.
      if (event.type === "progress") {
        const latestEntry = sessionsRef.current.get(key);
        const merged = mergeProgressEntries(
          latestEntry?.sessionProgress ?? [],
          event.result.progress,
        );
        patchEntry(key, { sessionProgress: merged });
        const lastToolCall = event.result.progress.at(-1)?.artifacts["tool-call"];
        if (lastToolCall) {
          if (isActive) {
            sharedCtx.stream.updateActiveMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, liveProgress: lastToolCall } : m)),
            );
          } else {
            const e = sessionsRef.current.get(key);
            if (e) {
              sessionsRef.current.set(key, {
                ...e,
                messages: e.messages.map((m) =>
                  m.id === assistantId ? Object.assign({}, m, { liveProgress: lastToolCall }) : m,
                ),
              });
            }
          }
        }
        return;
      }

      // ── Active session: delegate to shared handler ────────────────────────────
      if (isActive) {
        processActiveStreamEvent(event, assistantId, sharedCtx, {
          onDone: () => patchEntry(key, { isLoading: false, status: "done" }),
          onCancelled: () =>
            patchEntry(key, { isLoading: false, isCancelled: true, status: "cancelled" }),
        });
        return;
      }

      // ── Background (inactive) session: update sessionsRef directly ────────────

      if (event.type === "thinking" && event.content) {
        const e = sessionsRef.current.get(key);
        if (!e) return;
        patchEntry(key, {
          messages: e.messages.map((m) =>
            m.id === assistantId
              ? Object.assign({}, m, {
                  processContent: (m.processContent ?? "") + event.content,
                  isProcessStreaming: true,
                })
              : m,
          ),
        });
        return;
      }

      if (event.type === "tool_call") {
        // Store tool name for the upcoming tool_input event (shared pendingToolNameRef).
        // animation.cut is intentionally skipped for background sessions.
        sharedCtx.stream.pendingToolNameRef.current = event.name;
        return;
      }

      if (event.type === "tool_input") {
        const toolName = sharedCtx.stream.pendingToolNameRef.current;
        sharedCtx.stream.pendingToolNameRef.current = null;
        if (!toolName) return;
        let parsedInput: Record<string, unknown>;
        try {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- JSON from trusted SSE stream
          parsedInput = JSON.parse(event.content) as Record<string, unknown>;
        } catch {
          parsedInput = { raw: event.content };
        }
        const e = sessionsRef.current.get(key);
        if (!e) return;
        patchEntry(key, {
          messages: e.messages.map((m) =>
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
        return;
      }

      if (event.type === "text" && event.content) {
        const e = sessionsRef.current.get(key);
        if (!e) return;
        patchEntry(key, {
          messages: e.messages.map((m) => {
            if (m.id !== assistantId) return m;
            const segs = [...m.segments];
            let lastTextIdx = -1;
            for (let i = segs.length - 1; i >= 0; i--) {
              if (segs[i].type === "text") {
                lastTextIdx = i;
                break;
              }
            }
            const seg = lastTextIdx >= 0 ? segs[lastTextIdx] : null;
            const prevContent = seg?.type === "text" ? seg.content : "";
            const accumulated = prevContent + event.content;
            const updated = [...segs];
            if (lastTextIdx >= 0) {
              updated[lastTextIdx] = { type: "text" as const, content: accumulated };
            } else {
              updated.push({ type: "text" as const, content: accumulated });
            }
            return Object.assign({}, m, { segments: updated, isProcessStreaming: false });
          }),
        });
        return;
      }

      if (event.type === "result" && event.content) {
        const e = sessionsRef.current.get(key);
        if (!e) return;
        patchEntry(key, {
          messages: e.messages.map((m) => {
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
          }),
        });
        return;
      }

      if (event.type === "cancelled") {
        const e = sessionsRef.current.get(key);
        if (!e) return;
        patchEntry(key, {
          messages: e.messages.map((m) =>
            m.id === assistantId
              ? Object.assign({}, m, {
                  isLoading: false,
                  isProcessStreaming: false,
                  isCancelled: true,
                })
              : m,
          ),
          isLoading: false,
          isCancelled: true,
          status: "cancelled",
        });
        return;
      }

      if (event.type === "error" && event.content) {
        const e = sessionsRef.current.get(key);
        if (!e) return;
        patchEntry(key, {
          messages: e.messages.map((m) => {
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
          isLoading: false,
        });
        return;
      }

      if (event.type === "done") {
        const e = sessionsRef.current.get(key);
        if (!e) return;
        patchEntry(key, {
          messages: e.messages.map((m) => {
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
          isLoading: false,
          status: "done",
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sharedCtx is stable
    [patchEntry, sharedCtx.stream, sharedCtx.session],
  );

  // ─── Stream reader ────────────────────────────────────────────────────────────
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
  const reconnectToSession = useCallback(
    (key: string) => {
      const entry = sessionsRef.current.get(key);
      if (!entry?.isLoading || !entry.sessionId) return;

      evictOldestBackgroundIfNeeded();
      const abort = new AbortController();
      patchEntry(key, { connectionAbort: abort, connectionOpenedAt: Date.now() });
      const lastAssistant = entry.messages.toReversed().find((m) => m.role === "assistant");
      const resumeAssistantId = lastAssistant?.id ?? crypto.randomUUID();
      sharedCtx.stream.assistantIdRef.current = resumeAssistantId;
      const url = `${sessionStreamUrl(entry.sessionId)}?after=${entry.lastSeq}`;

      void (async () => {
        try {
          const response = await fetch(url, { signal: abort.signal });
          if (response.ok && response.body) {
            await readStream(key, response.body, resumeAssistantId);
          }
        } catch (err: unknown) {
          if (err instanceof Error && err.name !== "AbortError") {
            console.warn("[useDoveSession] reconnect error:", err);
          }
        } finally {
          patchEntry(key, { connectionAbort: null, connectionOpenedAt: null });
        }
      })();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sharedCtx is stable
    [evictOldestBackgroundIfNeeded, patchEntry, readStream, sharedCtx.stream],
  );

  // ─── disconnectStream ─────────────────────────────────────────────────────────
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
  const createSession = useCallback((): string => {
    const key = crypto.randomUUID();
    const blank = makeBlankSession(key);
    sessionsRef.current.set(key, blank);
    snapshotSessions();
    activeKeyRef.current = key;
    setActiveKey(key);
    sharedCtx.session.pendingQueueRef.current = [];
    sharedCtx.session.setPendingQueue([]);
    sharedCtx.session.setMessages([]);
    sharedCtx.session.setSessionProgress([]);
    sharedCtx.session.setIsLoading(false);
    sharedCtx.session.setSessionCancelled(false);
    sharedCtx.session.setCurrentSessionId(null);
    sharedCtx.session.setPendingPermissions([]);
    return key;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sharedCtx is stable
  }, [snapshotSessions, sharedCtx.session]);

  // ─── switchToSession ──────────────────────────────────────────────────────────
  const switchToSession = useCallback(
    async (key: string) => {
      const prevKey = activeKeyRef.current;
      if (prevKey === key) return;

      syncActiveToRef();

      if (prevKey) disconnectStream(prevKey);

      sharedCtx.stream.animation.reset();
      sharedCtx.session.setPendingPermissions([]);
      sharedCtx.session.pendingQueueRef.current = [];
      sharedCtx.session.setPendingQueue([]);

      activeKeyRef.current = key;
      setActiveKey(key);

      const entry = sessionsRef.current.get(key);
      if (!entry) return;

      // If the session was running when we last left it, re-check DB status.
      // It may have completed while we were viewing another session — in that
      // case load the full conversation from DB instead of reconnecting to a
      // potentially-dead stream (which would only replay partial text via Mode 3).
      if (entry.isLoading && entry.sessionId) {
        try {
          const {
            messages: stamped,
            progress,
            status,
          } = await fetchSessionDetail(`/api/chat/session/${entry.sessionId}`, "dove");
          if (status !== "running") {
            patchEntry(key, {
              messages: stamped,
              sessionProgress: progress,
              isLoading: false,
              status,
            });
            syncActiveFromRef(key);
            return;
          }
        } catch {
          // Fetch failed — fall through to reconnect with in-memory state
        }
      }

      syncActiveFromRef(key);
      reconnectToSession(key);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sharedCtx is stable
    [
      syncActiveToRef,
      disconnectStream,
      syncActiveFromRef,
      patchEntry,
      reconnectToSession,
      sharedCtx.stream,
      sharedCtx.session,
    ],
  );

  // ─── stopSession ─────────────────────────────────────────────────────────────
  const stopSession = useCallback(
    async (key: string) => {
      const entry = sessionsRef.current.get(key);
      if (!entry) return;

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

      disconnectStream(key);

      if (key === activeKeyRef.current) {
        const stoppedAssistantId = sharedCtx.stream.assistantIdRef.current;
        sharedCtx.stream.animation.flush(stoppedAssistantId ?? "");
        sharedCtx.stream.assistantIdRef.current = null;
        sharedCtx.session.setPendingPermissions([]);
        if (stoppedAssistantId) {
          sharedCtx.stream.updateActiveMessages((prev) =>
            prev.map((m) =>
              m.id === stoppedAssistantId
                ? Object.assign({}, m, { isLoading: false, isCancelled: true })
                : m,
            ),
          );
        }
        sharedCtx.session.setSessionCancelled(true);
        sharedCtx.session.setIsLoading(false);
      }

      patchEntry(key, { isLoading: false, isCancelled: true, status: "cancelled" });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sharedCtx is stable
    [disconnectStream, patchEntry, sharedCtx.stream, sharedCtx.session],
  );

  // ─── sendMessage (Dove branch) ────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed) return;

      let key = activeKeyRef.current;
      if (!key) {
        key = createSession();
      }

      const entry = sessionsRef.current.get(key);
      if (!entry) return;

      if (entry.isLoading) {
        const next = [...sharedCtx.session.pendingQueueRef.current, trimmed];
        sharedCtx.session.pendingQueueRef.current = next;
        sharedCtx.session.setPendingQueue(next);
        return;
      }

      if (!entry.label) {
        patchEntry(key, { label: trimmed.slice(0, 40) });
      }

      entry.connectionAbort?.abort();
      sharedCtx.stream.animation.reset();
      sharedCtx.session.setPendingPermissions([]);

      const abort = new AbortController();
      const assistantId = crypto.randomUUID();
      sharedCtx.stream.assistantIdRef.current = assistantId;

      const userMsg: import("./use-messages").ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        segments: [{ type: "text", content: trimmed }],
      };
      const assistantMsg: import("./use-messages").ChatMessage = {
        id: assistantId,
        role: "assistant",
        segments: [{ type: "text", content: "" }],
        isLoading: true,
        agentId: "dove",
      };

      const latestEntry = sessionsRef.current.get(key);
      if (!latestEntry) return;
      // Use messagesRef (mirrors React state) not latestEntry.messages — sessionsRef is not
      // updated during streaming, so latestEntry.messages would be stale on subsequent turns.
      const updatedMsgs = [...sharedCtx.stream.messagesRef.current, userMsg, assistantMsg];

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
          patchEntry(key, { connectionAbort: null, connectionOpenedAt: null });
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        sharedCtx.stream.animation.flush(assistantId);
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
            segs[lastTextIdx] = {
              type: "text" as const,
              content: `⚠️ Connection error: ${msg}`,
            };
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sharedCtx is stable
    [createSession, patchEntry, readStream, sharedCtx.stream, sharedCtx.session],
  );

  // ─── cancelMessage (Dove branch) ─────────────────────────────────────────────
  const cancelMessage = useCallback(() => {
    const key = activeKeyRef.current;
    if (!key) return;
    void stopSession(key);
  }, [stopSession]);

  // ─── newSession (Dove branch) ─────────────────────────────────────────────────
  const newSession = useCallback(() => {
    const prevKey = activeKeyRef.current;
    if (prevKey) disconnectStream(prevKey);
    createSession();
  }, [createSession, disconnectStream]);

  // ─── deleteSession (Dove branch) ─────────────────────────────────────────────
  const deleteSession = useCallback(
    async (contextId: string) => {
      let foundKey: string | null = null;
      for (const [k, entry] of sessionsRef.current) {
        if (entry.sessionId === contextId) {
          foundKey = k;
          break;
        }
      }
      const entry = foundKey ? sessionsRef.current.get(foundKey) : null;
      if (foundKey && entry?.isLoading) disconnectStream(foundKey);
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
          sharedCtx.session.setMessages([]);
          sharedCtx.session.setSessionProgress([]);
          sharedCtx.session.setSessionCancelled(false);
          sharedCtx.session.setIsLoading(false);
          sharedCtx.session.setCurrentSessionId(null);
          sharedCtx.session.setPendingPermissions([]);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sharedCtx is stable
    [disconnectStream, snapshotSessions, sharedCtx.session],
  );

  // ─── setSessionId (Dove branch) ───────────────────────────────────────────────
  const setSessionId = useCallback(
    async (id: string | null) => {
      if (!id) return;
      for (const [existingKey, entry] of sessionsRef.current) {
        if (entry.sessionId === id) {
          void switchToSession(existingKey);
          return;
        }
      }
      const prevKeyForHistory = activeKeyRef.current;
      if (prevKeyForHistory) disconnectStream(prevKeyForHistory);
      syncActiveToRef();
      const key = crypto.randomUUID();
      const blank = makeBlankSession(key);
      blank.sessionId = id;
      let isRunning = false;
      try {
        const {
          messages: stamped,
          progress,
          status,
        } = await fetchSessionDetail(`/api/chat/session/${id}`, "dove");
        blank.messages = stamped;
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
      disconnectStream,
    ],
  );

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
        const key = activeKeyRef.current;
        sharedCtx.session.setPendingPermissions((prev) => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sharedCtx is stable
    [patchEntry, sharedCtx.session],
  );

  // ─── Orchestrator coordination methods ────────────────────────────────────────

  /** Called by orchestrator when switching AWAY from Dove */
  const disconnect = useCallback(() => {
    const key = activeKeyRef.current;
    if (key) disconnectStream(key);
  }, [disconnectStream]);

  /** Called by orchestrator when switching BACK to Dove */
  const load = useCallback(() => {
    const key = activeKeyRef.current;
    if (!key) return;
    const entry = sessionsRef.current.get(key);
    if (!entry) return;
    syncActiveFromRef(key);
    reconnectToSession(key);
  }, [syncActiveFromRef, reconnectToSession]);

  /** Called by orchestrator BEFORE switching away from Dove */
  const syncToRef = syncActiveToRef;

  return {
    // Public state
    sessions,
    activeSessionKey: activeKey,
    // Actions
    sendMessage,
    cancelMessage,
    newSession,
    deleteSession,
    switchToSession,
    createSession,
    stopSession,
    setSessionId,
    resolvePermission,
    // Orchestrator coordination
    disconnect,
    load,
    syncToRef,
  };
}
