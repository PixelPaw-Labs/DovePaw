const DOVE_ID = "dove";

export function activeSessionUrl(agentId: string): string {
  return agentId === DOVE_ID ? "/api/chat/active-session" : `/api/agent/${agentId}/active-session`;
}

export function sessionDetailUrl(agentId: string, contextId: string): string {
  return agentId === DOVE_ID
    ? `/api/chat/session/${contextId}`
    : `/api/agent/${agentId}/session/${contextId}`;
}

export function agentChatUrl(agentId: string): string {
  return agentId === DOVE_ID ? "/api/chat" : `/api/agent/${agentId}/chat`;
}
