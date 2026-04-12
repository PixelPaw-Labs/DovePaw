/**
 * AgentConfig type and its factory function.
 *
 * Kept separate from spawn.ts so the type can be imported by agent-tools.ts
 * (and tests) without pulling in spawning dependencies.
 */

import { join } from "node:path";
import type { AgentDef } from "@@/lib/agents";
import type { AgentWorkspace } from "./workspace";

export interface AgentConfig {
  scriptPath: string;
  agentName: string;
  whatItDoes: string;
  /** Resolved env vars from settings to merge into the spawned process environment. */
  extraEnv?: Record<string, string>;
  /** The workspace directory for this run — used as cwd when spawning the agent script. */
  workspacePath: string;
}

/**
 * Build the AgentConfig for a script execution run.
 *
 * Validates that the agent has a pluginPath, merges workspace-specific env vars
 * (AGENT_WORKSPACE, REPO_LIST) on top of the pre-resolved extraEnv, and
 * composes the scriptPath from the plugin root and the agent's entryPath.
 *
 * Throws if `def.pluginPath` is absent — the agent must be installed via a plugin first.
 */
export function buildAgentConfig(
  def: AgentDef,
  workspace: AgentWorkspace,
  extraEnv: Record<string, string>,
  repoSlugs: string[],
): AgentConfig {
  if (!def.pluginPath) {
    throw new Error(`Agent "${def.name}" has no pluginPath — register it via plugin:add first`);
  }
  return {
    scriptPath: join(def.pluginPath, def.entryPath),
    agentName: def.displayName,
    whatItDoes: def.description,
    workspacePath: workspace.path,
    extraEnv: {
      ...extraEnv,
      AGENT_WORKSPACE: workspace.path,
      ...(repoSlugs.length > 0 ? { REPO_LIST: repoSlugs.join(",") } : {}),
    },
  };
}
