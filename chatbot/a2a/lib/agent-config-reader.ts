/**
 * Reads per-agent config files and resolves derived artefacts needed at
 * execution time: environment variables, repo slugs, and linked-agent MCP tools.
 */

import { readAgentsConfig } from "@@/lib/agents-config";
import { readSettings, readAgentSettings } from "@@/lib/settings";
import { resolveSettingsEnv } from "@/lib/env-resolver";
import { readAgentLinks, resolveTransitiveTargets } from "@@/lib/agent-links";
import { makeStartTool, makeAwaitTool } from "@/lib/query-tools";
import type { PendingRegistry } from "@/lib/pending-registry";
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type { CollectedStream } from "@/lib/a2a-client";
import { resolveAgentPort } from "@/lib/a2a-client";

export class AgentConfigReader {
  /**
   * Resolves the agent's execution environment fresh from disk so that settings
   * changes take effect on the next run without a server restart.
   */
  async resolveAgentSettings(
    agentName: string,
  ): Promise<{ extraEnv: Record<string, string>; repoSlugs: string[] }> {
    const settings = await readSettings();
    const agentSettings = await readAgentSettings(agentName);
    const extraEnv = resolveSettingsEnv(settings, agentSettings.envVars);
    const repoSlugs = agentSettings.repos
      .map((id) => settings.repositories.find((r) => r.id === id))
      .filter((r): r is NonNullable<typeof r> => r !== undefined)
      .map((r) => r.githubRepo);
    return { extraEnv, repoSlugs };
  }

  /**
   * Returns `start_<key>` / `await_<key>` MCP tools for every agent this agent
   * is linked to. Sub-agent orchestrators (non-group, directly-chatted) use the
   * same tool pair as Dove — the link strategy informs the PostToolUse
   * links-reminder, not the tool factory.
   *
   * Only injects tools for linked agents that are currently online.
   *
   * Returns an empty array when in group mode: group members must not have
   * tools to call peer agents — the orchestrator (Dove via `start_group_*`)
   * owns the chain, otherwise the cascade would be recreated.
   */
  async resolveLinkedTools(
    agentName: string,
    signal?: AbortSignal,
    backgroundTasks?: Promise<CollectedStream>[],
    registry?: PendingRegistry,
    isGroupMode = false,
  ): Promise<{
    tools: Parameters<typeof createSdkMcpServer>[0]["tools"];
  }> {
    if (isGroupMode) return { tools: [] };

    const [links, allAgents] = await Promise.all([readAgentLinks(), readAgentsConfig()]);

    const resolvedLinks = resolveTransitiveTargets(agentName, links);
    const tools: Parameters<typeof createSdkMcpServer>[0]["tools"] = [];
    const callerDisplayName = allAgents.find((a) => a.name === agentName)?.displayName;

    for (const { targetName } of resolvedLinks) {
      const targetDef = allAgents.find((a) => a.name === targetName);
      if (!targetDef) continue;

      const online = resolveAgentPort(targetDef.manifestKey) !== null;
      if (!online) continue;

      tools.push(
        makeStartTool(
          targetDef,
          signal,
          backgroundTasks,
          registry,
          callerDisplayName,
          undefined,
          agentName,
        ),
      );
      tools.push(makeAwaitTool(targetDef, signal, registry));
    }

    return { tools };
  }
}
