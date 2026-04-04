"use client";

import type { ChatMessage } from "./use-messages";
import type { ProgressEntry } from "@/lib/query-tools";

export const STORAGE_KEY_ACTIVE = "dovepaw:active";
export const messagesKey = (agentId: string) => `dovepaw:conv:${agentId}:messages`;
export const sessionKey = (agentId: string) => `dovepaw:conv:${agentId}:sessionId`;
export const sessionMessagesKey = (contextId: string) => `dovepaw:session:${contextId}:messages`;
export const sessionProgressKey = (contextId: string) => `dovepaw:session:${contextId}:progress`;

export function readActiveAgentId(): string {
  return "dove";
}
export function writeActiveAgentId(_id: string): void {}
export function readPersistedMessages(_agentId: string): ChatMessage[] | null {
  return null;
}
export function writePersistedMessages(_agentId: string, _messages: ChatMessage[]): void {}
export function readSessionMessages(_contextId: string): ChatMessage[] | null {
  return null;
}
export function writeSessionMessages(_contextId: string, _messages: ChatMessage[]): void {}
export function clearSessionMessages(_contextId: string): void {}
export function readSessionProgress(_contextId: string): ProgressEntry[] | null {
  return null;
}
export function writeSessionProgress(_contextId: string, _progress: ProgressEntry[]): void {}
export function clearSessionProgress(_contextId: string): void {}
export function readPersistedSessionId(_agentId: string): string | null {
  return null;
}
export function writePersistedSessionId(_agentId: string, _sessionId: string | null): void {}
export function clearPersistedConversation(_agentId: string): void {}
