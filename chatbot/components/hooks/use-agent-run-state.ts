"use client";

import { useConversationContext } from "./use-conversation-context";
import type { AgentStatus } from "@/a2a/heartbeat-types";

export interface AgentRunState {
  isRunning: boolean;
  processingTrigger: "dove" | "scheduled" | null;
}

/**
 * Merges two independent processing signals into a single run state:
 *   - Chat-triggered: isLoading (ConversationContext) + isActive
 *   - Launchd-triggered: heartbeat status.processing where trigger === "scheduled"
 *
 * Chat signal takes priority to avoid heartbeat lag bleeding into the UI
 * after a chat session completes.
 */
export function useAgentRunState(
  isActive: boolean,
  status: AgentStatus | undefined,
): AgentRunState {
  const { isLoading } = useConversationContext();

  const isDoveChatRunning = isLoading && isActive;
  const isScheduledRunning =
    (status?.processing ?? false) && status?.processingTrigger === "scheduled";

  return {
    isRunning: isDoveChatRunning || isScheduledRunning,
    processingTrigger: isDoveChatRunning ? "dove" : (status?.processingTrigger ?? null),
  };
}
