/**
 * Creates and starts an A2A server for a named agent group.
 *
 * Each group with 2+ members gets its own A2A server at startup (alongside
 * per-agent servers). The group A2A port is written to the ports manifest as
 * "group-<groupName>" so ask_group_* can discover it.
 */

import type { AgentCard } from "@a2a-js/sdk";
import type { AgentGroup } from "@@/lib/agent-links-schemas";
import type { AgentDef } from "@@/lib/agents";
import { GroupQueryExecutor } from "./group-query-executor";
import { createAgentServer } from "./base-server";
import { SessionManager } from "@/lib/session-manager";

/** Port manifest key for a group A2A server. */
export function groupManifestKey(groupName: string): string {
  return `group-${groupName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")}`;
}

/**
 * Create and start an A2A server for a group.
 * Port is written to the manifest by the caller (start-all.ts).
 */
export function createGroupServer(group: AgentGroup, allAgentDefs: AgentDef[], port: number): void {
  const agentCard: AgentCard = {
    name: `${group.name} Group`,
    description:
      group.description ||
      `Orchestrator for the "${group.name}" group (${group.members.join(", ")})`,
    url: "",
    protocolVersion: "0.3.0",
    version: "1.0.0",
    skills: [],
    capabilities: { streaming: true, pushNotifications: false },
    defaultInputModes: ["text"],
    defaultOutputModes: ["text"],
  };

  const sessionManager = new SessionManager();
  const executor = new GroupQueryExecutor(group, allAgentDefs);
  createAgentServer(agentCard, executor, port, sessionManager);
}
