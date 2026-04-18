import { z } from "zod";

// ─── Zod schemas (source of truth) ───────────────────────────────────────────

export const toolCallSchema = z.object({
  name: z.string(),
  input: z.record(z.string(), z.unknown()),
});

export const messageSegmentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), content: z.string() }),
  z.object({ type: z.literal("tool_call"), tool: toolCallSchema }),
]);

export const sessionMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  segments: z.array(messageSegmentSchema),
  processContent: z.string().optional(),
  senderAgentId: z.string().optional(),
});

// ─── Inferred types ───────────────────────────────────────────────────────────

export type ToolCall = z.infer<typeof toolCallSchema>;
export type MessageSegment = z.infer<typeof messageSegmentSchema>;
export type SessionMessage = z.infer<typeof sessionMessageSchema>;
