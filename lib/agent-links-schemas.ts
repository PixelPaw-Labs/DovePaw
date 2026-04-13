/**
 * Pure schema/type definitions for agent communication links.
 * No Node.js imports — safe to use in client components.
 */

import { z } from "zod";

export const AGENT_LINK_STRATEGIES = ["parallel", "pipeline", "review", "escalation"] as const;

export type AgentLinkStrategy = (typeof AGENT_LINK_STRATEGIES)[number];

export const agentLinkSchema = z.object({
  source: z.string(),
  target: z.string(),
  direction: z.enum(["single", "dual"]),
  strategy: z.enum(AGENT_LINK_STRATEGIES).default("parallel"),
  /** User-defined group name this link belongs to */
  group: z.string().optional(),
});

export const agentLinksFileSchema = z.object({
  version: z.literal(1),
  /** Ordered list of user-defined group names */
  groups: z.array(z.string()).default([]),
  links: z.array(agentLinkSchema),
});

export type AgentLink = z.infer<typeof agentLinkSchema>;
export type AgentLinksFile = z.infer<typeof agentLinksFileSchema>;

export type ResolvedLink = { targetName: string; strategy: AgentLinkStrategy };
