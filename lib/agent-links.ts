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

export { AGENT_LINK_STRATEGIES } from "./agent-links-schemas";

// ─── Read / Write ─────────────────────────────────────────────────────────────

export function readAgentLinksFile(): AgentLinksFile {
  try {
    const raw: unknown = JSON.parse(readFileSync(AGENT_LINKS_FILE, "utf-8"));
    const result = agentLinksFileSchema.safeParse(raw);
    return result.success ? result.data : { version: 1, groups: [], links: [] };
  } catch {
    return { version: 1, groups: [], links: [] };
  }
}

/** Returns only the links array. Existing callers remain unchanged. */
export function readAgentLinks(): AgentLink[] {
  return readAgentLinksFile().links;
}

export function writeAgentLinksFile(file: AgentLinksFile): void {
  writeFileSync(AGENT_LINKS_FILE, JSON.stringify(file, null, 2), "utf-8");
}

/** Updates only the links array, preserving the existing groups list. */
export function writeAgentLinks(links: AgentLink[]): void {
  const existing = readAgentLinksFile();
  writeAgentLinksFile({ ...existing, links });
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
