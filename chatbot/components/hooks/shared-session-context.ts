"use client";

import { z } from "zod";
import { sessionMessageSchema } from "@/lib/message-types";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { ChatSsePermission } from "@/lib/chat-sse";
import type { ChatMessage } from "./use-messages";
import type { ProgressEntry } from "@/lib/query-tools";
import type { AgentId } from "@/lib/agent-api-urls";
import type { useTextAnimation } from "./use-text-animation";

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const activeSessionResponseSchema = z.object({ id: z.string().nullable() });
export const sessionDetailResponseSchema = z.object({
  messages: z.array(sessionMessageSchema).default([]),
  progress: z
    .array(z.object({ message: z.string(), artifacts: z.record(z.string(), z.string()) }))
    .default([]),
  resumeSeq: z.number().default(0),
  status: z.enum(["running", "done", "cancelled", "interrupted"]).default("done"),
});

// ─── Types ────────────────────────────────────────────────────────────────────

export type SessionStatus = "running" | "done" | "cancelled" | "interrupted" | "pending";

export interface PerSessionState {
  /** Stable local key assigned at creation — never changes */
  key: string;
  /** null until first "session" SSE event arrives */
  sessionId: string | null;
  /** First 40 chars of the initial user message */
  label: string;
  messages: ChatMessage[];
  sessionProgress: ProgressEntry[];
  isLoading: boolean;
  isCancelled: boolean;
  hasPendingPermission: boolean;
  status: SessionStatus;
  connectionAbort: AbortController | null;
  /** FIFO order of when the connection was last opened (for background cap eviction) */
  connectionOpenedAt: number | null;
  /** Last seen SSE _seq, for reconnect */
  lastSeq: number;
}

export function makeBlankSession(key: string): PerSessionState {
  return {
    key,
    sessionId: null,
    label: "",
    messages: [],
    sessionProgress: [],
    isLoading: false,
    isCancelled: false,
    hasPendingPermission: false,
    status: "pending",
    connectionAbort: null,
    connectionOpenedAt: null,
    lastSeq: 0,
  };
}

// Max concurrent SSE connections across all background sessions.
export const MAX_BACKGROUND_CONNECTIONS = 5;

// ─── Shared context interfaces ────────────────────────────────────────────────

/** Drives text into the currently streaming assistant message. */
export interface StreamCtx {
  animation: ReturnType<typeof useTextAnimation>;
  assistantIdRef: MutableRefObject<string | null>;
  pendingToolNameRef: MutableRefObject<string | null>;
  messagesRef: MutableRefObject<ChatMessage[]>;
  updateActiveMessages: (updater: (prev: ChatMessage[]) => ChatMessage[]) => void;
}

/** Manages session lifecycle and rendered UI state. */
export interface SessionCtx {
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setSessionProgress: Dispatch<SetStateAction<ProgressEntry[]>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  isLoadingRef: MutableRefObject<boolean>;
  setSessionCancelled: Dispatch<SetStateAction<boolean>>;
  setCurrentSessionId: Dispatch<SetStateAction<string | null>>;
  setPendingPermissions: Dispatch<SetStateAction<ChatSsePermission[]>>;
  activeAgentIdRef: MutableRefObject<AgentId>;
  pendingQueueRef: MutableRefObject<string[]>;
  setPendingQueue: Dispatch<SetStateAction<string[]>>;
}

export interface SharedSessionContext {
  stream: StreamCtx;
  session: SessionCtx;
}
