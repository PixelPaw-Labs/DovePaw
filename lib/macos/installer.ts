import { exec, execSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import type { AgentDef } from "../agents";
import { deployAgentScript, deployTriggerScript, copyNativePackages } from "../installer";
import { LAUNCH_AGENTS_DIR, plistFilePath } from "./launchd-paths";
import { generateJobPlist, generatePlist, jobPlistLabel, plistLabel } from "./plist-generate";
import type { ScheduledJob } from "../agents-config-schemas";
import { agentPersistentLogDir } from "../paths";

const execAsync = promisify(exec);

/** Returns the current user's numeric UID. */
export function getUid(): string {
  return execSync("id -u", { stdio: "pipe" }).toString().trim();
}

/** Runs a shell command, silently ignoring errors. */
async function tryExec(cmd: string): Promise<void> {
  try {
    await execAsync(cmd);
  } catch {
    // ignore errors (e.g., agent not loaded)
  }
}

/** Write the agent's plist to ~/Library/LaunchAgents and create its log directory. */
export async function writePlistFile(agent: AgentDef): Promise<void> {
  const HOME = process.env.HOME!;
  await mkdir(LAUNCH_AGENTS_DIR, { recursive: true });
  await Promise.all([
    writeFile(plistFilePath(plistLabel(agent)), generatePlist(agent, HOME)),
    mkdir(agentPersistentLogDir(agent.name), { recursive: true }),
  ]);
}

/** Delete the agent's plist from ~/Library/LaunchAgents. No-op if already absent. */
export async function removePlistFile(agent: AgentDef): Promise<void> {
  await rm(plistFilePath(plistLabel(agent)), { force: true });
}

/** Write a job-specific plist to ~/Library/LaunchAgents. */
export async function writeJobPlistFile(agent: AgentDef, job: ScheduledJob): Promise<void> {
  const HOME = process.env.HOME!;
  await mkdir(LAUNCH_AGENTS_DIR, { recursive: true });
  await writeFile(
    plistFilePath(jobPlistLabel(agent.name, job.id, job.label)),
    generateJobPlist(agent, job, HOME),
  );
  await mkdir(agentPersistentLogDir(agent.name), { recursive: true });
}

/** Delete a job-specific plist. No-op if already absent. */
export async function removeJobPlistFile(agent: AgentDef, job: ScheduledJob): Promise<void> {
  await rm(plistFilePath(jobPlistLabel(agent.name, job.id, job.label)), { force: true });
}

/** Bootstrap (load) a single job's plist into launchd. */
export async function loadJobPlist(agent: AgentDef, job: ScheduledJob, uid: string): Promise<void> {
  await tryExec(
    `launchctl bootstrap gui/${uid} ${plistFilePath(jobPlistLabel(agent.name, job.id, job.label))}`,
  );
}

/** Bootout (unload) a single job's plist from launchd. */
export async function unloadJobPlist(
  agent: AgentDef,
  job: ScheduledJob,
  uid: string,
): Promise<void> {
  await tryExec(
    `launchctl bootout gui/${uid} ${plistFilePath(jobPlistLabel(agent.name, job.id, job.label))}`,
  );
}

/** Returns true if the given launchd label is currently loaded. */
export async function isAgentLoaded(label: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync("launchctl list");
    return stdout.includes(label);
  } catch {
    return false;
  }
}

/**
 * Check multiple launchd labels in a single `launchctl list` call.
 * Use this instead of calling isAgentLoaded() in parallel to avoid
 * spawning N child processes and buffering N copies of the full output.
 */
export async function areAgentsLoaded(labels: string[]): Promise<Record<string, boolean>> {
  try {
    const { stdout } = await execAsync("launchctl list");
    return Object.fromEntries(labels.map((label) => [label, stdout.includes(label)]));
  } catch {
    return Object.fromEntries(labels.map((label) => [label, false]));
  }
}

export interface AgentStatusDetail {
  state: string | null;
  pid: string | null;
  lastExitCode: string | null;
  raw: string;
}

/** Return parsed state/pid/last-exit for a single agent via `launchctl print`. */
export async function getAgentStatus(agent: AgentDef, uid: string): Promise<AgentStatusDetail> {
  try {
    const { stdout } = await execAsync(`launchctl print gui/${uid}/${plistLabel(agent)}`);
    return {
      state: stdout.match(/state\s*=\s*(\S+)/)?.[1] ?? null,
      pid: stdout.match(/\bpid\s*=\s*(\d+)/)?.[1] ?? null,
      lastExitCode: stdout.match(/last exit code\s*=\s*(\S+)/)?.[1] ?? null,
      raw: stdout,
    };
  } catch {
    return {
      state: null,
      pid: null,
      lastExitCode: null,
      raw: "Agent not loaded or label not found.",
    };
  }
}

/** Kill any child processes spawned by the agent to prevent orphans. */
export async function killChildren(agent: AgentDef, uid: string): Promise<void> {
  const { pid } = await getAgentStatus(agent, uid);
  if (pid) await tryExec(`pkill -P ${pid}`);
}

/** Bootout the agent from launchd without removing its plist. */
export async function unloadAgent(agent: AgentDef, uid: string): Promise<void> {
  await killChildren(agent, uid);
  const plistPath = plistFilePath(plistLabel(agent));
  await tryExec(`launchctl bootout gui/${uid} ${plistPath}`);
  await tryExec(`launchctl bootout gui/${uid}/${plistLabel(agent)}`);
}

/** Bootout the agent (all jobs + legacy plist) and remove all plists. */
export async function uninstallAgent(agent: AgentDef, uid: string): Promise<void> {
  if (agent.scheduledJobs?.length) {
    await Promise.all(
      agent.scheduledJobs.map(async (job) => {
        await unloadJobPlist(agent, job, uid);
        await removeJobPlistFile(agent, job);
      }),
    );
  }
  // Always clean up legacy single plist too (migration case)
  await unloadAgent(agent, uid);
  await removePlistFile(agent);
}

/** Deploy, configure, and load one agent (all jobs if scheduledJobs present, else legacy single plist). */
export async function installAgent(
  agent: AgentDef,
  uid: string,
  nativePackages: string[],
): Promise<{ skipped: boolean }> {
  if (agent.schedulingEnabled === false) return { skipped: true };
  await Promise.all([
    deployAgentScript(agent.name),
    deployTriggerScript(),
    copyNativePackages(nativePackages),
  ]);
  await uninstallAgent(agent, uid);
  if (agent.scheduledJobs?.length) {
    await Promise.all(
      agent.scheduledJobs.map(async (job) => {
        await writeJobPlistFile(agent, job);
        await loadJobPlist(agent, job, uid);
      }),
    );
  } else {
    await writePlistFile(agent);
    await loadAgent(agent, uid);
  }
  return { skipped: false };
}

/** Bootstrap (load) this agent's plist into launchd. */
export async function loadAgent(agent: AgentDef, uid: string): Promise<void> {
  const plistPath = plistFilePath(plistLabel(agent));
  await tryExec(`launchctl bootstrap gui/${uid} ${plistPath}`);
}

/** Bootout and re-bootstrap one agent without rebuilding. */
export async function reloadAgent(agent: AgentDef, uid: string): Promise<void> {
  await unloadAgent(agent, uid);
  await loadAgent(agent, uid);
}
