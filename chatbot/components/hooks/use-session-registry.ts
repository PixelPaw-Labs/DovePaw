"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { ChatSsePermission } from "@/lib/chat-sse";
import { useTextAnimation } from "./use-text-animation";
import type { ChatMessage } from "./use-messages";
import type { ProgressEntry } from "@/lib/query-tools";
import type { AgentId } from "@/lib/agent-api-urls";
import type { SharedSessionContext } from "./shared-session-context";
import { useDoveSession } from "./use-dove-session";
import { useAgentSession } from "./use-agent-session";

export type { ChatMessage } from "./use-messages";
export type { SessionStatus, PerSessionState } from "./shared-session-context";

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
  // ─── Active session rendering state ──────────────────────────────────────────
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionProgress, setSessionProgress] = useState<ProgressEntry[]>([]);
  const [sessionCancelled, setSessionCancelled] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [pendingPermissions, setPendingPermissions] = useState<ChatSsePermission[]>([]);

  // ─── isLoadingRef — allows sub-hooks to read isLoading without stale closure ─
  const isLoadingRef = useRef(false);
  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

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

  // ─── Active agent ─────────────────────────────────────────────────────────────
  const [activeAgentId, setActiveAgentIdState] = useState<AgentId>("dove");
  const activeAgentIdRef = useRef<AgentId>("dove");

  // ─── Pending queue ────────────────────────────────────────────────────────────
  const [pendingQueue, setPendingQueue] = useState<string[]>([]);
  const pendingQueueRef = useRef<string[]>([]);

  const removeFromQueue = useCallback((index: number) => {
    const next = pendingQueueRef.current.filter((_, i) => i !== index);
    pendingQueueRef.current = next;
    setPendingQueue(next);
  }, []);

  // ─── Active message sync ───────────────────────────────────────────────────────
  const updateActiveMessages = useCallback((updater: (prev: ChatMessage[]) => ChatMessage[]) => {
    setMessages((prev) => {
      const next = updater(prev);
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

  // ─── Shared context ───────────────────────────────────────────────────────────
  const sharedCtx: SharedSessionContext = {
    stream: {
      animation,
      assistantIdRef,
      pendingToolNameRef,
      messagesRef,
      updateActiveMessages,
    },
    session: {
      setMessages,
      setSessionProgress,
      setIsLoading,
      isLoadingRef,
      setSessionCancelled,
      setCurrentSessionId,
      setPendingPermissions,
      activeAgentIdRef,
      pendingQueueRef,
      setPendingQueue,
    },
  };

  // ─── Sub-hooks ────────────────────────────────────────────────────────────────
  const dove = useDoveSession(sharedCtx);
  const agent = useAgentSession(sharedCtx);

  // ─── setActiveAgentId ─────────────────────────────────────────────────────────
  const setActiveAgentId = useCallback(
    (agentId: string) => {
      const current = activeAgentIdRef.current;
      if (current === agentId) return;

      // Save current Dove session rendering state back to ref before switching away.
      if (current === "dove") dove.syncToRef();

      // Disconnect any in-flight streams
      agent.disconnect();
      dove.disconnect();

      animation.reset();
      setPendingPermissions([]);
      setMessages([]);
      setSessionProgress([]);
      setSessionCancelled(false);
      pendingQueueRef.current = [];
      setPendingQueue([]);
      setIsLoading(false);
      setCurrentSessionId(null);

      activeAgentIdRef.current = agentId as AgentId;
      setActiveAgentIdState(agentId as AgentId);

      // ── Switching back to Dove: restore from in-memory registry ─────────────
      if (agentId === "dove") {
        dove.load();
        return;
      }

      // ── Switching to a non-Dove agent ────────────────────────────────────────
      agent.load(agentId as AgentId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dove/agent refs are stable
    [animation, dove, agent],
  );

  // ─── Routing ──────────────────────────────────────────────────────────────────
  const isDove = activeAgentId === "dove";

  const sendMessage = useCallback(
    async (content: string) => {
      if (isDove) return dove.sendMessage(content);
      return agent.sendMessage(content, activeAgentId);
    },
    [isDove, dove, agent, activeAgentId],
  );

  const cancelMessage = useCallback(() => {
    if (isDove) return dove.cancelMessage();
    return agent.cancelMessage();
  }, [isDove, dove, agent]);

  const newSession = useCallback(() => {
    if (isDove) return dove.newSession();
    return agent.newSession();
  }, [isDove, dove, agent]);

  const deleteSession = useCallback(
    async (contextId: string) => {
      if (isDove) return dove.deleteSession(contextId);
      return agent.deleteSession(contextId);
    },
    [isDove, dove, agent],
  );

  const setSessionId = useCallback(
    async (id: string | null) => {
      if (isDove) return dove.setSessionId(id);
      return agent.setSessionId(id);
    },
    [isDove, dove, agent],
  );

  // ─── Queue drain effect ─────────────────────────────────────────────────────
  useEffect(() => {
    if (isLoading || pendingQueueRef.current.length === 0) return;
    const [next, ...rest] = pendingQueueRef.current;
    pendingQueueRef.current = rest;
    setPendingQueue(rest);
    void sendMessage(next);
  }, [isLoading, sendMessage]);

  return {
    // ─── Multi-session API ───────────────────────────────────────────────────────
    sessions: activeAgentId === "dove" ? dove.sessions : [],
    doveHasRunningSession: dove.sessions.some((s) => s.isLoading),
    activeSessionKey: dove.activeSessionKey,
    switchToSession: dove.switchToSession,
    stopSession: dove.stopSession,
    createSession: dove.createSession,
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
    resolvePermission: dove.resolvePermission,

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
