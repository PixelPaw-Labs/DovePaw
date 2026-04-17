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

/**
 * Named group of agents. Membership is independent of links — an agent in
 * `members` may or may not have links to other members. Links control
 * who-can-message-whom; membership controls who appears in the group chat view.
 */
const agentGroupSchema = z.object({
  name: z.string(),
  members: z.array(z.string()).default([]),
  /** Human-readable description of the group's business domain; shown to Dove for semantic routing. */
  description: z.string().default(""),
});

/** Accepts legacy string form for on-disk migration of older agent-links.json files. */
const agentGroupInputSchema = z.union([
  z.string().transform((name) => ({ name, members: [] as string[], description: "" })),
  agentGroupSchema,
]);

export const agentLinksFileSchema = z.object({
  version: z.literal(1),
  groups: z.array(agentGroupInputSchema).default([]),
  links: z.array(agentLinkSchema),
});

export type AgentLink = z.infer<typeof agentLinkSchema>;
export type AgentGroup = z.infer<typeof agentGroupSchema>;
export type AgentLinksFile = z.infer<typeof agentLinksFileSchema>;

export type ResolvedLink = { targetName: string; strategy: AgentLinkStrategy };
