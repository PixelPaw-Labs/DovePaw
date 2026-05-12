import type { ChatMessage } from "@/components/hooks/use-messages";

export const USER_BUCKET = "__user__";
export const DOVE_AGENT_ID = "dove";

export function bucketOf(msg: ChatMessage): string {
  if (msg.role === "assistant") return msg.agentId ?? USER_BUCKET;
  if (msg.senderAgentId) return msg.senderAgentId;
  return USER_BUCKET;
}

export function isDove(agentId: string): boolean {
  return agentId.toLowerCase() === DOVE_AGENT_ID;
}
