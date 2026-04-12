/**
 * Handles pipeline strategy auto-triggers.
 *
 * After a source agent completes, PipelineTrigger reads the pipeline-linked
 * targets and fires each one with the source's final output — fire-and-forget.
 * The source agent does not wait for pipeline targets to complete.
 */

import { consola } from "consola";
import type { AgentDef } from "@@/lib/agents";
import { readAgentLinks, resolveLinkedTargets } from "@@/lib/agent-links";
import { readAgentsConfig } from "@@/lib/agents-config";
import { isAgentOnline, isHeartbeatReady } from "@/a2a/heartbeat-server";
import { resolveAgentPort, startAgentStream } from "@/lib/a2a-client";

export class PipelineTrigger {
  /**
   * Resolve all pipeline-linked targets for `agentName` that are currently online.
   */
  private async resolveTargets(agentName: string): Promise<AgentDef[]> {
    const [links, allAgents] = await Promise.all([
      Promise.resolve(readAgentLinks()),
      readAgentsConfig(),
    ]);

    return resolveLinkedTargets(agentName, links)
      .filter(({ strategy }) => strategy === "pipeline")
      .map(({ targetName }) => allAgents.find((a) => a.name === targetName))
      .filter((a): a is AgentDef => a !== undefined)
      .filter((a) =>
        isHeartbeatReady()
          ? isAgentOnline(a.manifestKey)
          : resolveAgentPort(a.manifestKey) !== null,
      );
  }

  /**
   * Fire pipeline-linked agents with `output` as their instruction.
   * Each target is started independently; errors are logged but do not
   * affect the source agent's completion state.
   */
  async fire(agentName: string, output: string): Promise<void> {
    const targets = await this.resolveTargets(agentName);
    if (targets.length === 0) return;

    for (const target of targets) {
      const port = resolveAgentPort(target.manifestKey);
      if (!port) {
        consola.warn(`[pipeline] ${target.displayName} port not found — skipped`);
        continue;
      }

      consola.info(`[pipeline] → ${target.displayName}`);
      void startAgentStream(port, output || `Pipeline trigger from ${agentName}`)
        .then(async (handle) => {
          if (!handle) {
            consola.warn(`[pipeline] ${target.displayName} stream did not open`);
            return;
          }
          // Drain stream so the pipeline target runs to completion
          for await (const _ of handle.stream) {
            /* drain */
          }
          consola.success(`[pipeline] ${target.displayName} complete`);
        })
        .catch((err) => consola.warn(`[pipeline] ${target.displayName} failed:`, err));
    }
  }
}
