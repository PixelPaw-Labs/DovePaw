import type { AgentConfigEntry } from "@@/lib/agents-config-schemas";

const DOVE_ID = "dove";

/** "dove" | any agent config entry name. Derived from AgentConfigEntry["name"] so it
 *  automatically widens if the schema ever narrows name to a literal union. */
export type AgentId = typeof DOVE_ID | (AgentConfigEntry["name"] & {});

export function activeSessionUrl(agentId: AgentId): string {
  return agentId === DOVE_ID ? "/api/chat/active-session" : `/api/agent/${agentId}/active-session`;
}

export function sessionDetailUrl(agentId: AgentId, id: string): string {
  return agentId === DOVE_ID ? `/api/chat/session/${id}` : `/api/agent/${agentId}/session/${id}`;
}

export function agentChatUrl(agentId: AgentId): string {
  return agentId === DOVE_ID ? "/api/chat" : `/api/agent/${agentId}/chat`;
}

export function agentSessionsUrl(agentId: AgentId): string {
  return agentId === DOVE_ID ? "/api/chat/sessions" : `/api/agent/${agentId}/sessions`;
}

export function sessionStreamUrl(sessionId: string): string {
  return `/api/chat/stream/${sessionId}`;
}
