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
  makeStartReviewTool,
  makeAwaitReviewTool,
  makeStartEscalateTool,
  makeAwaitEscalateTool,
} from "@/lib/agent-tools";
import type { PendingRegistry } from "@/lib/pending-registry";
import type { GroupMeta } from "@/lib/group-meta";
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
   * Returns the MCP tools for every agent this agent is linked to, based on strategy:
   *   sequential  → chat_to_*
   *   chat        → start_chat_to_* + await_chat_to_*
   *   review      → review_with_*
   *   escalation  → escalate_to_*
   *
   * Only injects tools for linked agents that are currently online.
   * Before the first heartbeat cycle, falls back to port manifest presence.
   */
  async resolveLinkedTools(
    agentName: string,
    signal?: AbortSignal,
    backgroundTasks?: Promise<CollectedStream>[],
    registry?: PendingRegistry,
    groupMeta?: GroupMeta,
  ) {
    const [links, allAgents] = await Promise.all([readAgentLinks(), readAgentsConfig()]);

    const resolvedLinks = resolveLinkedTargets(agentName, links);
    const tools: Parameters<typeof createSdkMcpServer>[0]["tools"] = [];
    const callerDisplayName = allAgents.find((a) => a.name === agentName)?.displayName;

    for (const { targetName, strategy } of resolvedLinks) {
      const targetDef = allAgents.find((a) => a.name === targetName);
      if (!targetDef) continue;

      const online = resolveAgentPort(targetDef.manifestKey) !== null;
      if (!online) continue;

      switch (strategy) {
        case "review":
          tools.push(
            makeStartReviewTool(
              targetDef,
              signal,
              registry,
              agentName,
              groupMeta,
              callerDisplayName,
            ),
          );
          tools.push(makeAwaitReviewTool(targetDef, signal, registry, groupMeta));
          break;
        case "escalation":
          tools.push(
            makeStartEscalateTool(
              targetDef,
              signal,
              registry,
              agentName,
              groupMeta,
              callerDisplayName,
            ),
          );
          tools.push(makeAwaitEscalateTool(targetDef, signal, registry, groupMeta));
          break;
        default: // "chat" and any future strategies default to start + await
          tools.push(
            makeStartChatToTool(targetDef, signal, backgroundTasks, registry, agentName, groupMeta),
          );
          tools.push(makeAwaitChatToTool(targetDef, signal, registry, groupMeta));
      }
    }

    return tools;
  }
}
