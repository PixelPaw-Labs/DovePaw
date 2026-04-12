/**
 * Pure grouping utilities for agent lists.
 * No Node.js imports — safe to use in client components.
 */
import type { AgentConfigEntry } from "./agents-config-schemas";
import type { PluginRecord } from "./plugin-schemas";

export interface AgentGroup {
  /** Canonical plugin name (e.g. "dovepaw-plugins"), or "" for ungrouped agents */
  pluginName: string;
  /** Absent for ungrouped agents */
  pluginPath?: string;
  /** True for agents from ~/.dovepaw/tmp/ */
  temporary?: true;
  agents: AgentConfigEntry[];
}

/**
 * Resolve the display name for a plugin from its installed path.
 * Uses the canonical name from the plugin registry when available;
 * falls back to the directory basename of pluginPath.
 * This is the single source of truth for plugin name derivation.
 */
export function resolvePluginName(
  pluginPath: string,
  plugins: readonly Pick<PluginRecord, "path" | "name">[] = [],
): string {
  return (
    plugins.find((p) => p.path === pluginPath)?.name ?? pluginPath.split("/").pop() ?? pluginPath
  );
}

/**
 * Group a flat agent list by their pluginPath.
 * - Agents without pluginPath come first, ungrouped (no section header).
 * - Plugin agents are grouped by their canonical plugin name.
 * - tmp agents form a "Kilin" group at the end (only when non-empty).
 *
 * Pass `plugins` from the registry to use canonical names; omit to fall back
 * to the directory basename of each agent's pluginPath.
 */
export function groupAgentsByPlugin(
  agents: AgentConfigEntry[],
  tmpAgents: AgentConfigEntry[] = [],
  plugins: readonly Pick<PluginRecord, "path" | "name">[] = [],
): AgentGroup[] {
  const ungrouped: AgentConfigEntry[] = [];
  const byPlugin = new Map<string, AgentConfigEntry[]>();

  for (const agent of agents) {
    if (!agent.pluginPath) {
      ungrouped.push(agent);
    } else {
      if (!byPlugin.has(agent.pluginPath)) byPlugin.set(agent.pluginPath, []);
      byPlugin.get(agent.pluginPath)!.push(agent);
    }
  }

  const result: AgentGroup[] = [];
  if (ungrouped.length > 0) {
    result.push({ pluginName: "", agents: ungrouped });
  }
  for (const [pluginPath, pluginAgents] of byPlugin) {
    result.push({
      pluginName: resolvePluginName(pluginPath, plugins),
      pluginPath,
      agents: pluginAgents,
    });
  }
  if (tmpAgents.length > 0) {
    result.push({ pluginName: "Kilin", temporary: true, agents: tmpAgents });
  }
  return result;
}
