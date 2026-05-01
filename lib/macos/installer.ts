import { exec, execSync } from "node:child_process";
import {
  access,
  chmod,
  copyFile,
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { promisify } from "node:util";
import { join } from "node:path";
import type { AgentDef } from "../agents";
import {
  A2A_TRIGGER_SCRIPT,
  AGENTS_DIST,
  AGENTS_ROOT,
  LAUNCH_AGENTS_DIR,
  agentDistScript,
  agentPersistentLogDir,
  plistFilePath,
  schedulerNodeModule,
  schedulerScript,
  SCHEDULER_ROOT,
} from "../paths";
import { generateJobPlist, generatePlist, jobPlistLabel, plistLabel } from "./plist-generate";
import type { ScheduledJob } from "../agents-config-schemas";

const execAsync = promisify(exec);

/** Deduplicates concurrent deployTriggerScript calls; reset after each run so the next install re-deploys. */
let _deployTriggerScriptOnce: Promise<void> | null = null;

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

/** Copy compiled .mjs to ~/.dovepaw/cron and make it executable.
 *  Triggers a full build first if the compiled output is missing. */
export async function deployAgentScript(agentName: string): Promise<void> {
  await mkdir(SCHEDULER_ROOT, { recursive: true });
  const src = agentDistScript(agentName);
  try {
    await access(src);
  } catch {
    await execAsync("npm run build", { cwd: AGENTS_ROOT });
  }
  await copyFile(src, schedulerScript(agentName));
  await chmod(schedulerScript(agentName), 0o755);
}

/** Copy compiled a2a-trigger.mjs to ~/.dovepaw/cron and make it executable.
 *  Runs npm run build first if the compiled output is missing.
 *  Also copies @a2a-js/sdk and its dependency uuid to cron/node_modules.
 *  Concurrent calls share one run; the promise is cleared after each run so
 *  the next install call always re-deploys the latest binary. */
export async function deployTriggerScript(): Promise<void> {
  _deployTriggerScriptOnce ??= _doDeployTriggerScript().finally(() => {
    _deployTriggerScriptOnce = null;
  });
  return _deployTriggerScriptOnce;
}

async function _doDeployTriggerScript(): Promise<void> {
  await mkdir(SCHEDULER_ROOT, { recursive: true });
  const src = join(AGENTS_DIST, "a2a-trigger.mjs");
  try {
    await access(src);
  } catch {
    await execAsync("npm run build", { cwd: AGENTS_ROOT });
  }
  await copyFile(src, A2A_TRIGGER_SCRIPT);
  await chmod(A2A_TRIGGER_SCRIPT, 0o755);
  await copyNativePackages(["@a2a-js/sdk", "uuid"]);
}

/**
 * Copy native addon packages (those that can't be bundled) from DovePaw/node_modules
 * into ~/.dovepaw/cron/node_modules.
 */
export async function copyNativePackages(packages: string[]): Promise<void> {
  await Promise.all(
    packages.map(async (pkg) => {
      const src = `${AGENTS_ROOT}/node_modules/${pkg}`;
      try {
        await access(src);
      } catch {
        return;
      }
      await mkdir(schedulerNodeModule(""), { recursive: true });
      await rm(schedulerNodeModule(pkg), { recursive: true, force: true });
      await cp(src, schedulerNodeModule(pkg), { recursive: true });
    }),
  );
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

/** Return the last N lines from the most recent log file for an agent. */
export async function getAgentLogs(agent: AgentDef, lines = 100): Promise<string> {
  const logDir = agentPersistentLogDir(agent.name);
  let files: string[];
  try {
    files = await readdir(logDir);
  } catch {
    return `No log directory found at ${logDir}`;
  }
  const logFiles = await Promise.all(
    files
      .filter((f) => f.endsWith(".log"))
      .map(async (f) => ({ name: f, mtime: (await stat(join(logDir, f))).mtime })),
  );
  logFiles.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  if (logFiles.length === 0) return "No log files found.";
  const content = await readFile(join(logDir, logFiles[0].name), "utf-8");
  const all = content.split("\n");
  return `${logFiles[0].name} (last ${lines} lines):\n\n${all.slice(-lines).join("\n")}`;
}

/** Bootout and re-bootstrap one agent without rebuilding. */
export async function reloadAgent(agent: AgentDef, uid: string): Promise<void> {
  await unloadAgent(agent, uid);
  await loadAgent(agent, uid);
}
