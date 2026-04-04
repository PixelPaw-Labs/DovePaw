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
/** ~/.dovepaw/workspaces/ — isolated execution workspace roots for all agents */
export const WORKSPACES_DIR = join(DOVEPAW_DIR, "workspaces");
/** ~/.dovepaw/workspaces/.{agentName}/ — per-agent workspace root */
export const agentWorkspaceDir = (agentName: string) => join(WORKSPACES_DIR, `.${agentName}`);
/** ~/.dovepaw/agents/state — persistent agent state root */
export const DOVEPAW_AGENT_STATE = join(DOVEPAW_DIR, "agents/state");
/** ~/.dovepaw/agents/state/.<agentName> — persistent per-agent state directory */
export const agentPersistentStateDir = (agentName: string) =>
  join(DOVEPAW_AGENT_STATE, `.${agentName}`);
/** ~/.dovepaw/agents/logs — persistent agent log root */
export const DOVEPAW_AGENT_LOGS = join(DOVEPAW_DIR, "agents/logs");
/** ~/.dovepaw/agents/logs/.<agentName> — persistent per-agent log directory */
export const agentPersistentLogDir = (agentName: string) =>
  join(DOVEPAW_AGENT_LOGS, `.${agentName}`);
/** ~/.dovepaw/settings.agents/<agentName>/ — per-agent config files directory */
export const agentConfigDir = (agentName: string) => join(AGENT_SETTINGS_DIR, agentName);
/** ~/.dovepaw/settings.agents/<agentName>/agent.json — combined definition + runtime settings */
export const agentDefinitionFile = (agentName: string) =>
  join(agentConfigDir(agentName), "agent.json");
/** ~/.dovepaw/settings.agents/<agentName>/<filename> — a specific agent config file */
export const agentConfigFile = (agentName: string, filename: string) =>
  join(agentConfigDir(agentName), filename);
/** ~/.dovepaw/cron — launchd agent scripts and native node_modules */
export const SCHEDULER_ROOT = join(DOVEPAW_DIR, "cron");
/** ~/.claude/skills — user skills directory */
export const SKILLS_ROOT = join(process.env.HOME!, ".claude/skills");
/** DovePaw/skills — project skills directory */
export const SKILLS_DIR = join(resolveAgentsRoot(), "skills");
/** ~/Library/LaunchAgents — macOS launchd user agents directory */
export const LAUNCH_AGENTS_DIR = join(process.env.HOME!, "Library/LaunchAgents");
/** Resolve an agent's entry point to an absolute path under agents/ root */
export const agentEntryPath = (entryPath: string) => join(AGENTS_ROOT, entryPath);
/** DovePaw/node_modules/<pkg> */
export const agentNodeModule = (pkg: string) => join(AGENTS_ROOT, "node_modules", pkg);
/** DovePaw/dist/<agentName>.mjs — compiled agent script */
export const agentDistScript = (agentName: string) => join(AGENTS_DIST, `${agentName}.mjs`);
/** ~/.dovepaw/cron/<agentName>.mjs — deployed agent script */
export const schedulerScript = (agentName: string) => join(SCHEDULER_ROOT, `${agentName}.mjs`);
/** ~/.dovepaw/cron/node_modules/<pkg> */
export const schedulerNodeModule = (pkg: string) => join(SCHEDULER_ROOT, "node_modules", pkg);
/** ~/Library/LaunchAgents/<label>.plist */
export const plistFilePath = (label: string) => join(LAUNCH_AGENTS_DIR, `${label}.plist`);
/** ~/.dovepaw/cron/a2a-trigger.mjs — compiled A2A trigger script used by all launchd plists */
export const A2A_TRIGGER_SCRIPT = join(SCHEDULER_ROOT, "a2a-trigger.mjs");
/** ~/.dovepaw/.ports.<port>.json — runtime port manifest for a specific Next.js port */
export const portsFile = (port: string | number): string =>
  join(DOVEPAW_DIR, `.ports.${port}.json`);
/** ~/.dovepaw/.a2a-servers.pid — PID of the running A2A servers process */
export const A2A_SERVERS_PID_FILE = join(DOVEPAW_DIR, ".a2a-servers.pid");
