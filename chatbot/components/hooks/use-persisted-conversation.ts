"use client";

import type { ChatMessage } from "./use-messages";

const MAX_MESSAGES = 200;

// ─── Storage keys ─────────────────────────────────────────────────────────────

export const STORAGE_KEY_ACTIVE = "dovepaw:active";
export const messagesKey = (agentId: string) => `dovepaw:conv:${agentId}:messages`;
export const sessionKey = (agentId: string) => `dovepaw:conv:${agentId}:sessionId`;

// ─── Active agent ─────────────────────────────────────────────────────────────

export function readActiveAgentId(): string {
  try {
    return localStorage.getItem(STORAGE_KEY_ACTIVE) || "dove";
  } catch {
    return "dove";
  }
}

export function writeActiveAgentId(agentId: string): void {
  try {
    localStorage.setItem(STORAGE_KEY_ACTIVE, agentId);
  } catch {
    // ignore storage quota / security errors
  }
}

// ─── Messages ─────────────────────────────────────────────────────────────────

export function readPersistedMessages(agentId: string): ChatMessage[] | null {
  try {
    const raw = localStorage.getItem(messagesKey(agentId));
    if (raw === null) return null;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- trusted localStorage value we wrote ourselves
    return JSON.parse(raw) as ChatMessage[];
  } catch {
    return null;
  }
}

export function writePersistedMessages(agentId: string, messages: ChatMessage[]): void {
  try {
    const capped = messages.length > MAX_MESSAGES ? messages.slice(-MAX_MESSAGES) : messages;
    localStorage.setItem(messagesKey(agentId), JSON.stringify(capped));
  } catch {
    // ignore storage quota / security errors
  }
}

// ─── Session ID ───────────────────────────────────────────────────────────────

export function readPersistedSessionId(agentId: string): string | null {
  try {
    return localStorage.getItem(sessionKey(agentId));
  } catch {
    return null;
  }
}

export function writePersistedSessionId(agentId: string, sessionId: string | null): void {
  try {
    if (sessionId) {
      localStorage.setItem(sessionKey(agentId), sessionId);
    } else {
      localStorage.removeItem(sessionKey(agentId));
    }
  } catch {
    // ignore storage quota / security errors
  }
}

// ─── Clear ────────────────────────────────────────────────────────────────────

export function clearPersistedConversation(agentId: string): void {
  try {
    localStorage.removeItem(messagesKey(agentId));
    localStorage.removeItem(sessionKey(agentId));
  } catch {
    // ignore storage quota / security errors
  }
}
