/**
 * Shared helpers for managing launchd agents via launchctl.
 * Used by the heartbeat server and the /api/settings/launchd route.
 */

import { exec } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { readAgentsConfig } from "@@/lib/agents-config";
import type { AgentDef } from "@@/lib/agents";
import { AGENTS_ROOT, plistFilePath } from "@@/lib/paths";
import { jobPlistLabel, plistLabel } from "@@/lib/plist-generate";
import { externalPackagesInBundle } from "@/lib/bundle-utils";
import {
  getUid,
  isAgentLoaded,
  areAgentsLoaded,
  getAgentLogs,
  getAgentStatus as installerGetAgentStatus,
  installAgent as installerInstallAgent,
  loadAgent as installerLoadAgent,
  unloadAgent as installerUnloadAgent,
  uninstallAgent as installerUninstallAgent,
} from "@@/lib/installer";
export {
  writePlistFile as writePlist,
  areAgentsLoaded,
  writeJobPlistFile,
  removeJobPlistFile,
  loadJobPlist,
  unloadJobPlist,
} from "@@/lib/installer";
import type { AgentStatusDetail } from "@@/lib/installer";
import type { LaunchdStatus } from "@/a2a/heartbeat-types";
export { getUid as uid, isAgentLoaded as isLoaded, getAgentLogs };

const execAsync = promisify(exec);

/** Resolves the ~/Library/LaunchAgents plist path for a given agent name (legacy single plist). */
export async function agentPlistPath(agentName: string): Promise<string> {
  const agent = (await readAgentsConfig()).find((a) => a.name === agentName);
  if (!agent) throw new Error(`Unknown agent: ${agentName}`);
  return plistFilePath(plistLabel(agent));
}

/** Resolves the ~/Library/LaunchAgents plist path for a specific job. */
export function jobPlistPath(agentName: string, jobId: string): string {
  return plistFilePath(jobPlistLabel(agentName, jobId));
}

/** Bootstrap (load) this agent's plist into launchd. */
export async function loadAgent(agent: AgentDef): Promise<void> {
  await installerLoadAgent(agent, getUid());
}

/** Bootout (unload) this agent from launchd without removing its plist. */
export async function unloadAgent(agent: AgentDef): Promise<void> {
  await installerUnloadAgent(agent, getUid());
}

/**
 * Build and install only this agent (scoped tsup build → deploy script → copy native deps → write plist → bootstrap).
 * Returns whether the agent is loaded after installation.
 */
export async function installAgent(
  agent: AgentDef,
): Promise<{ loaded: boolean; skipped?: boolean }> {
  if (agent.schedulingEnabled === false) return { loaded: false, skipped: true };
  const u = getUid();

  // Step 1: Build only this agent's entry.
  // Plugin agents need an absolute entry path; core agents use the relative path.
  const entryFile = agent.pluginPath ? join(agent.pluginPath, agent.entryPath) : agent.entryPath;
  await execAsync(`npx tsup --entry.${agent.name}=${entryFile} --metafile`, {
    cwd: AGENTS_ROOT,
  });

  // Steps 2+3: Deploy, configure, unload, write plist, bootstrap
  await installerInstallAgent(agent, u, externalPackagesInBundle(agent.name));

  return { loaded: await isAgentLoaded(plistLabel(agent)) };
}

/** Unload and delete only this agent's plist. */
export async function uninstallAgent(agent: AgentDef): Promise<void> {
  await installerUninstallAgent(agent, getUid());
}

/** Return parsed state/pid/last-exit for a single agent via `launchctl print`. */
export async function getAgentStatus(agent: AgentDef): Promise<AgentStatusDetail> {
  return installerGetAgentStatus(agent, getUid());
}

/**
 * Returns launchd load+running status for all agents, keyed by manifestKey.
 * Used by the heartbeat server.
 */
export async function getLaunchdStatuses(): Promise<Record<string, LaunchdStatus>> {
  try {
    const { stdout } = await execAsync("launchctl list");
    const loaded = new Map<string, boolean>();
    for (const line of stdout.split("\n")) {
      const [pid, , ...labelParts] = line.split("\t");
      const label = labelParts.join("\t").trim();
      if (label) loaded.set(label, pid !== "-");
    }
    const agents = await readAgentsConfig();
    return Object.fromEntries(
      agents.map((a) => {
        let isLoaded: boolean;
        let isRunning: boolean;
        if (a.scheduledJobs?.length) {
          // Agent is "loaded" if ANY job plist is loaded
          const jobEntries = a.scheduledJobs.map((j) =>
            loaded.get(jobPlistLabel(a.name, j.id, j.label)),
          );
          isLoaded = jobEntries.some((v) => v !== undefined);
          isRunning = jobEntries.some((v) => v === true);
        } else {
          const running = loaded.get(plistLabel(a));
          isLoaded = running !== undefined;
          isRunning = running === true;
        }
        return [a.manifestKey, { loaded: isLoaded, running: isRunning }];
      }),
    );
  } catch {
    const agents = await readAgentsConfig();
    return Object.fromEntries(
      agents.map((a) => [a.manifestKey, { loaded: false, running: false }]),
    );
  }
}
