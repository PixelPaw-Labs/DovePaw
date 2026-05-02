/**
 * Server-side read/write and helpers for the global agent link topology.
 * Stored in ~/.dovepaw/agent-links.json.
 *
 * Do NOT import this file in client components — it uses node:fs.
 * Import from lib/agent-links-schemas.ts for types/constants only.
 */

import { readFile, writeFile } from "node:fs/promises";
import { AGENT_LINKS_FILE } from "./paths";
import { pushConfig } from "./s3-config-sync";
import {
  agentLinksFileSchema,
  type AgentLink,
  type AgentLinksFile,
  type ResolvedLink,
} from "./agent-links-schemas";

export { AGENT_LINK_STRATEGIES } from "./agent-links-schemas";

// ─── Read / Write ─────────────────────────────────────────────────────────────

export async function readAgentLinksFile(): Promise<AgentLinksFile> {
  try {
    const raw: unknown = JSON.parse(await readFile(AGENT_LINKS_FILE, "utf-8"));
    const result = agentLinksFileSchema.safeParse(raw);
    return result.success ? result.data : { version: 1, groups: [], links: [] };
  } catch {
    return { version: 1, groups: [], links: [] };
  }
}

export async function readAgentLinks(): Promise<AgentLink[]> {
  return (await readAgentLinksFile()).links;
}

export async function writeAgentLinksFile(file: AgentLinksFile): Promise<void> {
  const data = JSON.stringify(file, null, 2);
  await writeFile(AGENT_LINKS_FILE, data, "utf-8");
  await pushConfig("agent-links.json", data);
}

/** Updates only the links array, preserving the existing groups list. */
export async function writeAgentLinks(links: AgentLink[]): Promise<void> {
  const existing = await readAgentLinksFile();
  await writeAgentLinksFile({ ...existing, links });
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
