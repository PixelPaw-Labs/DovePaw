/**
 * Shared agent installation primitives used by both build.ts (CLI) and
 * launchd.ts (chatbot).
 */

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
  symlink,
  writeFile,
} from "node:fs/promises";
import { promisify } from "node:util";
import { join } from "node:path";
import type { AgentDef } from "./agents";
import {
  AGENTS_ROOT,
  LAUNCH_AGENTS_DIR,
  SKILLS_DIR,
  SKILLS_ROOT,
  agentDistScript,
  agentLogDir,
  plistFilePath,
  schedulerNodeModule,
  schedulerScript,
  SCHEDULER_ROOT,
} from "./paths";
import { generatePlist, plistLabel } from "./plist-generate";
import { readSettings, readAgentSettings } from "./settings";
import { writeAgentEnvScript } from "./env-script";

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

/** Copy compiled .mjs to ~/.claude/scheduler and make it executable. */
export async function deployAgentScript(agentName: string): Promise<void> {
  await mkdir(SCHEDULER_ROOT, { recursive: true });
  await copyFile(agentDistScript(agentName), schedulerScript(agentName));
  await chmod(schedulerScript(agentName), 0o755);
}

/** Read settings and write the agent's env bootstrap script. */
export async function writeEnvScript(agent: AgentDef): Promise<void> {
  const settings = readSettings();
  const agentSettings = readAgentSettings(agent.name);
  await writeAgentEnvScript(agent.name, agent.reposEnvVar, settings, agentSettings.repos);
}

/**
 * Copy native addon packages (those that can't be bundled) from DovePaw/node_modules
 * into ~/.claude/scheduler/node_modules.
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
    mkdir(agentLogDir(agent.name), { recursive: true }),
  ]);
}

/** Delete the agent's plist from ~/Library/LaunchAgents. No-op if already absent. */
export async function removePlistFile(agent: AgentDef): Promise<void> {
  await rm(plistFilePath(plistLabel(agent)), { force: true });
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
    const { stdout } = await execAsync(`launchctl print gui/${uid}/${agent.label}`);
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
  await tryExec(`launchctl bootout gui/${uid}/${agent.label}`);
}

/** Bootout the agent and remove its plist. */
export async function uninstallAgent(agent: AgentDef, uid: string): Promise<void> {
  await unloadAgent(agent, uid);
  await removePlistFile(agent);
}

/** Deploy, configure, and load one agent. */
export async function installAgent(
  agent: AgentDef,
  uid: string,
  nativePackages: string[],
): Promise<void> {
  await Promise.all([
    deployAgentScript(agent.name),
    writeEnvScript(agent),
    copyNativePackages(nativePackages),
  ]);
  await uninstallAgent(agent, uid);
  await writePlistFile(agent);
  await loadAgent(agent, uid);
}

/** Bootstrap (load) this agent's plist into launchd. */
export async function loadAgent(agent: AgentDef, uid: string): Promise<void> {
  const plistPath = plistFilePath(plistLabel(agent));
  await tryExec(`launchctl bootstrap gui/${uid} ${plistPath}`);
}

/** Return the last N lines from the most recent log file for an agent. */
export async function getAgentLogs(agent: AgentDef, lines = 100): Promise<string> {
  const logDir = agentLogDir(agent.name);
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

/** Symlink every skill in DovePaw/skills/ into ~/.claude/skills/. */
export async function linkSkills(): Promise<void> {
  await mkdir(SKILLS_ROOT, { recursive: true });
  const skills = await readdir(SKILLS_DIR);
  await Promise.all(
    skills.map(async (skill) => {
      const link = join(SKILLS_ROOT, skill);
      await rm(link, { recursive: true, force: true });
      await symlink(join(SKILLS_DIR, skill), link);
    }),
  );
}

/** Remove ~/.claude/skills/ symlinks for every skill in DovePaw/skills/. */
export async function unlinkSkills(): Promise<void> {
  const skills = await readdir(SKILLS_DIR);
  await Promise.all(
    skills.map((skill) => rm(join(SKILLS_ROOT, skill), { recursive: true, force: true })),
  );
}
