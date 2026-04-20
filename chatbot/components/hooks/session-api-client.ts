"use client";

import { z } from "zod";
import { sessionMessageSchema } from "@/lib/message-types";
import type { AgentId } from "@/lib/agent-api-urls";
import type { ChatMessage } from "./use-messages";

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const activeSessionResponseSchema = z.object({ id: z.string().nullable() });

export const sessionDetailResponseSchema = z.object({
  messages: z.array(sessionMessageSchema).default([]),
  progress: z
    .array(z.object({ message: z.string(), artifacts: z.record(z.string(), z.string()) }))
    .default([]),
  resumeSeq: z.number().default(0),
  status: z.enum(["running", "done", "cancelled"]).default("done"),
  startedAt: z.string().optional(),
});

export type SessionStatus = "running" | "done" | "cancelled" | "pending";

// ─── fetchSessionDetail ────────────────────────────────────────────────────────

/**
 * Fetch a session's messages, progress, resumeSeq, and status from the given
 * URL. Stamps each assistant message with the supplied agentId.
 */
export async function fetchSessionDetail(url: string, agentId: AgentId) {
  const detail = sessionDetailResponseSchema.parse(await (await fetch(url)).json());
  return {
    ...detail,
    messages: detail.messages.map(
      (m): ChatMessage =>
        m.role === "assistant" ? Object.assign({}, m, { agentId }) : (m as ChatMessage),
    ),
  };
}
