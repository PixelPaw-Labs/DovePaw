"use client";

import { useConversationContext } from "./use-conversation-context";
import type { AgentStatus } from "@/a2a/heartbeat-types";

export interface AgentRunState {
  isRunning: boolean;
  processingTrigger: "dove" | "scheduled" | null;
}

/**
 * Merges two independent processing signals into a single run state:
 *   - Chat-triggered: isLoading (ConversationContext) + isActive (fast-path, no heartbeat lag)
 *   - Heartbeat: status.processing from the A2A processing registry
 *
 * For the SELECTED agent, the heartbeat is only trusted for "scheduled" trigger.
 * This avoids lag where heartbeat still reports processing=dove after the chat
 * session ends (isDoveChatRunning already handles that case).
 *
 * For UNSELECTED agents, the heartbeat is trusted for all triggers — a dove-triggered
 * job must remain visible even after the user switches to a different agent.
 */
export function useAgentRunState(
  isActive: boolean,
  status: AgentStatus | undefined,
): AgentRunState {
  const { isLoading } = useConversationContext();

  const isDoveChatRunning = isLoading && isActive;
  const isHeartbeatRunning = isActive
    ? // Selected: only trust scheduled trigger to prevent post-session lag
      (status?.processing ?? false) && status?.processingTrigger === "scheduled"
    : // Unselected: trust any trigger — dove job must stay visible after switching
      (status?.processing ?? false);

  return {
    isRunning: isDoveChatRunning || isHeartbeatRunning,
    processingTrigger: isDoveChatRunning ? "dove" : (status?.processingTrigger ?? null),
  };
}
