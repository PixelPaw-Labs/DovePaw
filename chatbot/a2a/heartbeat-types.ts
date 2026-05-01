/** Shared types for the WebSocket heartbeat protocol. Safe to import in client components. */

import { z } from "zod";

const schedulerStatusSchema = z.object({ loaded: z.boolean(), running: z.boolean() });
const agentStatusSchema = z.object({
  online: z.boolean(),
  latency: z.number().nullable(),
  scheduler: schedulerStatusSchema.nullable(),
  processing: z.boolean(),
  processingTrigger: z.enum(["scheduled", "dove"]).nullable(),
});
export const statusMessageSchema = z.object({
  type: z.literal("status"),
  agents: z.record(z.string(), agentStatusSchema),
});

export type SchedulerStatus = z.infer<typeof schedulerStatusSchema>;
export type AgentStatus = z.infer<typeof agentStatusSchema>;
export type StatusMessage = z.infer<typeof statusMessageSchema>;
