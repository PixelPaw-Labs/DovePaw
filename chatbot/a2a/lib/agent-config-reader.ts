/**
 * Reads per-agent config files and resolves derived artefacts needed at
 * execution time: environment variables, repo slugs, and chat_to_* MCP tools.
 */

import { readAgentsConfig } from "@@/lib/agents-config";
import { readSettings, readAgentSettings } from "@@/lib/settings";
import { resolveSettingsEnv } from "@/lib/env-resolver";
import { readAgentLinks, resolveLinkedTargets } from "@@/lib/agent-links";
import {
  makeStartChatToTool,
  makeAwaitChatToTool,
  makeReviewTool,
  makeEscalateTool,
} from "@/lib/agent-tools";
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { isAgentOnline, isHeartbeatReady } from "@/a2a/heartbeat-server";
import { resolveAgentPort } from "@/lib/a2a-client";

export class AgentConfigReader {
  /**
   * Resolves the agent's execution environment fresh from disk so that settings
   * changes take effect on the next run without a server restart.
   */
  async resolveAgentSettings(
    agentName: string,
  ): Promise<{ extraEnv: Record<string, string>; repoSlugs: string[] }> {
    const settings = readSettings();
    const agentSettings = await readAgentSettings(agentName);
    const extraEnv = resolveSettingsEnv(settings, agentSettings.envVars);
    const repoSlugs = agentSettings.repos
      .map((id) => settings.repositories.find((r) => r.id === id))
      .filter((r): r is NonNullable<typeof r> => r !== undefined)
      .map((r) => r.githubRepo);
    return { extraEnv, repoSlugs };
  }

  /**
   * Returns the MCP tools for every agent this agent is linked to, based on strategy:
   *   sequential  → chat_to_*
   *   parallel    → start_chat_to_* + await_chat_to_*
   *   pipeline    → no tool (executor handles post-completion trigger)
   *   review      → review_with_*
   *   escalation  → escalate_to_*
   *
   * Only injects tools for linked agents that are currently online.
   * Before the first heartbeat cycle, falls back to port manifest presence.
   */
  async resolveLinkedTools(
    agentName: string,
    signal?: AbortSignal,
    backgroundTasks?: Promise<unknown>[],
  ) {
    const [links, allAgents] = await Promise.all([
      Promise.resolve(readAgentLinks()),
      readAgentsConfig(),
    ]);

    const resolvedLinks = resolveLinkedTargets(agentName, links);
    const tools: Parameters<typeof createSdkMcpServer>[0]["tools"] = [];

    for (const { targetName, strategy } of resolvedLinks) {
      if (strategy === "pipeline") continue; // handled by executor post-completion

      const targetDef = allAgents.find((a) => a.name === targetName);
      if (!targetDef) continue;

      const online = isHeartbeatReady()
        ? isAgentOnline(targetDef.manifestKey)
        : resolveAgentPort(targetDef.manifestKey) !== null;
      if (!online) continue;

      switch (strategy) {
        case "review":
          tools.push(makeReviewTool(targetDef, signal));
          break;
        case "escalation":
          tools.push(makeEscalateTool(targetDef, signal));
          break;
        default: // "parallel" and any future strategies default to start + await
          tools.push(makeStartChatToTool(targetDef, signal, backgroundTasks));
          tools.push(makeAwaitChatToTool(targetDef, signal));
      }
    }

    return tools;
  }
}
