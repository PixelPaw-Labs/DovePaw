"use client";

import type { MutableRefObject } from "react";
import type { ChatMessage } from "./use-messages";
import type { AgentId } from "@/lib/agent-api-urls";
import { sessionDetailUrl } from "@/lib/agent-api-urls";
import { fetchSessionDetail } from "./session-api-client";

export const POLL_INTERVAL_MS = 500;

interface PollResult {
  messages: ChatMessage[];
  status: "running" | "done" | "cancelled";
}

interface PollSessionOptions {
  agentId: AgentId;
  sessionId: string;
  isCancelled: () => boolean;
  /** Returns the currently active session ID — used to discard stale poll results. */
  getCurrentSessionId: () => string | null;
  pollTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  /** Called on each successful poll. Caller owns all state updates and animation. */
  onPoll: (result: PollResult) => void;
}

/**
 * Pure polling scheduler — fetches session detail every POLL_INTERVAL_MS and
 * calls `onPoll` with the result. Stops when status is no longer "running",
 * when cancelled, or when the active session changes.
 * Cleanup: clear pollTimeoutRef.current on unmount / session switch.
 */
export function startPolling({
  agentId,
  sessionId,
  isCancelled,
  getCurrentSessionId,
  pollTimeoutRef,
  onPoll,
}: PollSessionOptions): void {
  const poll = async () => {
    if (isCancelled()) return;
    try {
      const { messages, status } = await fetchSessionDetail(
        sessionDetailUrl(agentId, sessionId),
        agentId,
      );
      if (isCancelled()) return;
      if (getCurrentSessionId() !== sessionId) return;

      onPoll({ messages, status });

      if (status === "running") {
        pollTimeoutRef.current = setTimeout(() => {
          void poll();
        }, POLL_INTERVAL_MS);
      } else {
        pollTimeoutRef.current = null;
      }
    } catch {
      if (!isCancelled() && getCurrentSessionId() === sessionId) {
        pollTimeoutRef.current = setTimeout(() => {
          void poll();
        }, POLL_INTERVAL_MS);
      }
    }
  };
  pollTimeoutRef.current = setTimeout(() => {
    void poll();
  }, POLL_INTERVAL_MS);
}
