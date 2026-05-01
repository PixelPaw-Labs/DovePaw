/**
 * Cross-platform helpers for managing scheduled agents.
 * Used by the heartbeat server and the /api/settings/scheduler route.
 * All scheduler operations go through the platform-neutral `scheduler` abstraction.
 */

import { exec } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { readAgentsConfig } from "@@/lib/agents-config";
import type { AgentDef } from "@@/lib/agents";
import { AGENTS_ROOT } from "@@/lib/paths";
import { scheduler } from "@@/lib/scheduler";
import type { AgentStatusDetail } from "@@/lib/scheduler";
import { getAgentLogs } from "@@/lib/installer";
import { externalPackagesInBundle } from "@/lib/bundle-utils";
import type { SchedulerStatus } from "@/a2a/heartbeat-types";

export { getAgentLogs };
export type { AgentStatusDetail };
export const isLoaded = (label: string) => scheduler.isAgentLoaded(label);

const execAsync = promisify(exec);

/** Bootstrap (load) this agent into the scheduler. */
export async function loadAgent(agent: AgentDef): Promise<void> {
  await scheduler.loadAgent(agent);
}

/** Bootout (unload) this agent from the scheduler without removing its config. */
export async function unloadAgent(agent: AgentDef): Promise<void> {
  await scheduler.unloadAgent(agent);
}

/**
 * Build and install only this agent (scoped tsup build → deploy script → copy native deps → write config → activate).
 * Returns whether the agent is loaded after installation.
 */
export async function installAgent(
  agent: AgentDef,
): Promise<{ loaded: boolean; skipped?: boolean }> {
  if (agent.schedulingEnabled === false) return { loaded: false, skipped: true };

  const entryFile = agent.pluginPath ? join(agent.pluginPath, agent.entryPath) : agent.entryPath;
  await execAsync(`npx tsup --entry.${agent.name}=${entryFile} --metafile`, {
    cwd: AGENTS_ROOT,
  });

  await scheduler.installAgent(agent, externalPackagesInBundle(agent.name));

  return { loaded: await scheduler.isAgentLoaded(scheduler.agentLabel(agent)) };
}

/** Unload and remove only this agent's scheduler config. */
export async function uninstallAgent(agent: AgentDef): Promise<void> {
  await scheduler.uninstallAgent(agent);
}

/** Return state, pid, and last exit code for a single agent. */
export async function getAgentStatus(agent: AgentDef): Promise<AgentStatusDetail> {
  return scheduler.getAgentStatus(agent);
}

/**
 * Returns load+running status for all agents, keyed by manifestKey.
 * Used by the heartbeat server.
 */
export async function getSchedulerStatuses(): Promise<Record<string, SchedulerStatus>> {
  const agents = await readAgentsConfig();
  const labels = agents.flatMap((a) =>
    a.scheduledJobs?.length
      ? a.scheduledJobs.map((j) => scheduler.jobLabel(a.name, j.id, j.label))
      : [scheduler.agentLabel(a)],
  );
  const loadedMap = await scheduler.areAgentsLoaded(labels);
  let labelIdx = 0;
  return Object.fromEntries(
    agents.map((a) => {
      const count = a.scheduledJobs?.length ?? 0;
      const active = count
        ? labels.slice(labelIdx, labelIdx + count).some((l) => loadedMap[l])
        : (loadedMap[labels[labelIdx]] ?? false);
      labelIdx += count || 1;
      return [a.manifestKey, { loaded: active, running: active }];
    }),
  );
}
