const DOVE_ID = "dove";

export function activeSessionUrl(agentId: string): string {
  return agentId === DOVE_ID ? "/api/chat/active-session" : `/api/agent/${agentId}/active-session`;
}

export function sessionDetailUrl(agentId: string, id: string): string {
  return agentId === DOVE_ID ? `/api/chat/session/${id}` : `/api/agent/${agentId}/session/${id}`;
}

export function agentChatUrl(agentId: string): string {
  return agentId === DOVE_ID ? "/api/chat" : `/api/agent/${agentId}/chat`;
}

export function agentSessionsUrl(agentId: string): string {
  return `/api/agent/${agentId}/sessions`;
}
