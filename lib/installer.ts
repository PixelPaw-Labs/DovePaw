/**
 * Shared agent installation primitives used by both build.ts (CLI) and
 * agent-scheduler.ts (chatbot).
 *
 * Cross-platform functions live here. Platform-specific functions
 * live in lib/macos/installer.ts and lib/linux/installer.ts.
 */

import { exec } from "node:child_process";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  cp,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AgentDef } from "./agents";
import { agentPersistentLogDir } from "./paths";
import {
  A2A_TRIGGER_SCRIPT,
  AGENT_LOCAL_DIR,
  AGENT_SDK_DIR,
  AGENT_SDK_SRC,
  AGENTS_DIST,
  AGENTS_ROOT,
  CODEX_SKILLS_ROOT,
  DOVEPAW_TMP_DIR,
  PLUGINS_DIR,
  SCHEDULER_ROOT,
  SKILLS_ROOT,
  agentDistScript,
  agentNodeModule,
  schedulerNodeModule,
  schedulerScript,
} from "./paths";

const execAsync = promisify(exec);

/** Deduplicates concurrent deployTriggerScript calls; reset after each run so the next install re-deploys. */
let _deployTriggerScriptOnce: Promise<void> | null = null;

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
 *  Concurrent calls share one run; the promise is cleared after each run. */
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
 * Copy native addon packages from DovePaw/node_modules into ~/.dovepaw/cron/node_modules.
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

/**
 * Copy packages/agent-sdk/ to ~/.dovepaw/sdk/ so plugin repos can reference it
 * as a file: dependency and tsup can bundle it.
 */
export async function deployAgentSdk(): Promise<void> {
  await rm(AGENT_SDK_DIR, { recursive: true, force: true });
  await cp(AGENT_SDK_SRC, AGENT_SDK_DIR, { recursive: true });
  // Symlink SDK peer deps into ~/.dovepaw/sdk/node_modules/ so Node.js resolves
  // them from the real file path (not the symlinked plugin path).
  const sdkNmScope = join(AGENT_SDK_DIR, "node_modules", "@openai");
  await mkdir(sdkNmScope, { recursive: true });
  const codexSdkLink = join(sdkNmScope, "codex-sdk");
  await rm(codexSdkLink, { recursive: true, force: true });
  await symlink(agentNodeModule("@openai/codex-sdk"), codexSdkLink);
  // Ensure ~/.dovepaw/tmp/ is treated as ESM so tsx loads tmp agent scripts
  // in ESM mode. Without this, Node.js defaults to CJS and require()ing the
  // ESM-only @openai/codex-sdk (transitively via the SDK index) fails with
  // ERR_PACKAGE_PATH_NOT_EXPORTED.
  await mkdir(DOVEPAW_TMP_DIR, { recursive: true });
  await writeFile(join(DOVEPAW_TMP_DIR, "package.json"), '{"type":"module"}\n', "utf-8");
}

/**
 * Create <pluginDir>/node_modules/@dovepaw/agent-sdk → ~/.dovepaw/sdk symlink
 * so plugin agents resolve @dovepaw/agent-sdk at both tsx runtime and tsup bundle time.
 */
export async function linkAgentSdkToPlugin(pluginDir: string): Promise<void> {
  const nmScope = join(pluginDir, "node_modules", "@dovepaw");
  await mkdir(nmScope, { recursive: true });
  const link = join(nmScope, "agent-sdk");
  await rm(link, { recursive: true, force: true });
  await symlink(AGENT_SDK_DIR, link);
}

/** Ensure DovePaw/agents -> ~/.dovepaw/plugins symlink exists. */
export async function linkAgents(): Promise<void> {
  await mkdir(PLUGINS_DIR, { recursive: true });
  const link = join(AGENTS_ROOT, "agents");
  try {
    await symlink(PLUGINS_DIR, link);
  } catch (e: unknown) {
    if (e instanceof Error && (e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
}

/** Symlink a plugin's skills into ~/.claude/skills/ and ~/.codex/skills/. */
export async function linkPluginSkills(pluginDir: string, skillNames: string[]): Promise<void> {
  if (skillNames.length === 0) return;
  await Promise.all(
    [SKILLS_ROOT, CODEX_SKILLS_ROOT].flatMap((root) =>
      skillNames.map(async (skill) => {
        await mkdir(root, { recursive: true });
        const link = join(root, skill);
        await rm(link, { recursive: true, force: true });
        await symlink(join(pluginDir, "skills", skill), link);
      }),
    ),
  );
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

/** Remove ~/.claude/skills/ and ~/.codex/skills/ symlinks for a plugin's skills. */
export async function unlinkPluginSkills(skillNames: string[]): Promise<void> {
  await Promise.all(
    [SKILLS_ROOT, CODEX_SKILLS_ROOT].flatMap((root) =>
      skillNames.map((skill) => rm(join(root, skill), { recursive: true, force: true })),
    ),
  );
}

/** Symlink skills from agent-local/<name>/skill/ into ~/.claude/skills/ and ~/.codex/skills/. */
export async function linkLocalAgentSkills(): Promise<void> {
  let entries;
  try {
    entries = await readdir(AGENT_LOCAL_DIR, { withFileTypes: true });
  } catch {
    return; // agent-local/ doesn't exist yet
  }
  await Promise.all(
    entries
      .filter((d) => d.isDirectory())
      .map(async (d) => {
        const skillDir = join(AGENT_LOCAL_DIR, d.name, "skill");
        try {
          await access(skillDir);
        } catch {
          return;
        }
        await Promise.all(
          [SKILLS_ROOT, CODEX_SKILLS_ROOT].map(async (root) => {
            await mkdir(root, { recursive: true });
            const link = join(root, d.name);
            await rm(link, { recursive: true, force: true });
            await symlink(skillDir, link);
          }),
        );
      }),
  );
}
