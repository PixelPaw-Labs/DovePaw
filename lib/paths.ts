import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function resolveAgentsRoot(): string {
  try {
    // Native ESM (Node.js / tsx): derive from this file's location
    return join(dirname(fileURLToPath(import.meta.url)), "..");
  } catch {
    // webpack/bundler context: chatbot/ is cwd, DovePaw/ is one level up
    return resolve(process.cwd(), "..");
  }
}

/** DovePaw/ — root of the DovePaw monorepo */
export const AGENTS_ROOT = resolveAgentsRoot();
/** DovePaw/dist — compiled agent scripts */
export const AGENTS_DIST = join(AGENTS_ROOT, "dist");
/** ~/.dovepaw/ — user-scoped DovePaw data directory (outside the repo) */
export const DOVEPAW_DIR = join(process.env.HOME!, ".dovepaw");
/** ~/.dovepaw/settings.json — global settings (watched repositories, etc.) */
export const SETTINGS_FILE = join(DOVEPAW_DIR, "settings.json");
/** ~/.dovepaw/settings.agents/ — per-agent settings directory */
export const AGENT_SETTINGS_DIR = join(DOVEPAW_DIR, "settings.agents");
/** ~/.dovepaw/settings.agents/<agentName>.json — per-agent settings file */
export const agentSettingsFile = (agentName: string) =>
  join(AGENT_SETTINGS_DIR, `${agentName}.json`);
/** ~/.claude/scheduler — launchd agent scripts, logs, and state */
export const SCHEDULER_ROOT = join(process.env.HOME!, ".claude/scheduler");
/** ~/.claude/skills — user skills directory */
export const SKILLS_ROOT = join(process.env.HOME!, ".claude/skills");
/** DovePaw/skills — project skills directory */
export const SKILLS_DIR = join(resolveAgentsRoot(), "skills");
/** ~/.claude/scheduler/logs */
export const SCHEDULER_LOGS = join(SCHEDULER_ROOT, "logs");
/** ~/.claude/scheduler/state */
export const SCHEDULER_STATE = join(SCHEDULER_ROOT, "state");
/** ~/Library/LaunchAgents — macOS launchd user agents directory */
export const LAUNCH_AGENTS_DIR = join(process.env.HOME!, "Library/LaunchAgents");
/** Resolve an agent's entry point to an absolute path under agents/ root */
export const agentEntryPath = (entryPath: string) => join(AGENTS_ROOT, entryPath);
/** DovePaw/node_modules/<pkg> */
export const agentNodeModule = (pkg: string) => join(AGENTS_ROOT, "node_modules", pkg);
/** DovePaw/dist/<agentName>.mjs — compiled agent script */
export const agentDistScript = (agentName: string) => join(AGENTS_DIST, `${agentName}.mjs`);
/** ~/.claude/scheduler/<agentName>.mjs — deployed agent script */
export const schedulerScript = (agentName: string) => join(SCHEDULER_ROOT, `${agentName}.mjs`);
/** ~/.claude/scheduler/node_modules/<pkg> */
export const schedulerNodeModule = (pkg: string) => join(SCHEDULER_ROOT, "node_modules", pkg);
/** ~/.claude/scheduler/logs/.<agentName> — agent log directory */
export const agentLogDir = (agentName: string) => join(SCHEDULER_LOGS, `.${agentName}`);
/** ~/.claude/scheduler/state/.<agentName> — agent state directory */
export const agentStateDir = (agentName: string) => join(SCHEDULER_STATE, `.${agentName}`);
/** ~/Library/LaunchAgents/<label>.plist */
export const plistFilePath = (label: string) => join(LAUNCH_AGENTS_DIR, `${label}.plist`);
/** ~/.claude/scheduler/<agentName>.env.sh — env bootstrap script sourced by launchd before the agent starts */
export const agentEnvScript = (agentName: string) => join(SCHEDULER_ROOT, `${agentName}.env.sh`);
/** ~/.claude/scheduler/a2a-trigger.mjs — compiled A2A trigger script used by all launchd plists */
export const A2A_TRIGGER_SCRIPT = join(SCHEDULER_ROOT, "a2a-trigger.mjs");
