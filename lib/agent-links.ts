/**
 * Server-side read/write and helpers for the global agent link topology.
 * Stored in ~/.dovepaw/agent-links.json.
 *
 * Do NOT import this file in client components — it uses node:fs.
 * Import from lib/agent-links-schemas.ts for types/constants only.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { AGENT_LINKS_FILE } from "./paths";
import {
  agentLinksFileSchema,
  type AgentLink,
  type AgentLinksFile,
  type ResolvedLink,
} from "./agent-links-schemas";

export type {
  AgentLink,
  AgentLinksFile,
  AgentLinkStrategy,
  ResolvedLink,
} from "./agent-links-schemas";
export {
  AGENT_LINK_STRATEGIES,
  agentLinkSchema,
  agentLinksFileSchema,
} from "./agent-links-schemas";

// ─── Read / Write ─────────────────────────────────────────────────────────────

export function readAgentLinks(): AgentLink[] {
  try {
    const raw: unknown = JSON.parse(readFileSync(AGENT_LINKS_FILE, "utf-8"));
    const result = agentLinksFileSchema.safeParse(raw);
    return result.success ? result.data.links : [];
  } catch {
    return [];
  }
}

export function writeAgentLinks(links: AgentLink[]): void {
  const file: AgentLinksFile = { version: 1, links };
  writeFileSync(AGENT_LINKS_FILE, JSON.stringify(file, null, 2), "utf-8");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns resolved links for `agentName` — each with target name and strategy.
 * Handles both single (source→target) and dual (both directions) links.
 */
export function resolveLinkedTargets(agentName: string, links: AgentLink[]): ResolvedLink[] {
  return links
    .filter((l) => l.source === agentName || (l.direction === "dual" && l.target === agentName))
    .map((l) => ({
      targetName: l.source === agentName ? l.target : l.source,
      strategy: l.strategy,
    }));
}
