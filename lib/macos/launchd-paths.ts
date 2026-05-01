import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function resolveAgentsRoot(): string {
  try {
    return join(dirname(fileURLToPath(import.meta.url)), "..");
  } catch {
    return process.cwd();
  }
}

const _AGENTS_ROOT = resolveAgentsRoot();
const _DOVEPAW_DIR = join(process.env.HOME!, ".dovepaw");

/** DovePaw/dist — compiled agent scripts */
export const AGENTS_DIST = join(_AGENTS_ROOT, "dist");
/** ~/.dovepaw/cron — launchd agent scripts and native node_modules */
export const SCHEDULER_ROOT = join(_DOVEPAW_DIR, "cron");
/** ~/Library/LaunchAgents — macOS launchd user agents directory */
export const LAUNCH_AGENTS_DIR = join(process.env.HOME!, "Library/LaunchAgents");
/** DovePaw/dist/agents/<agentName>.mjs — compiled agent script */
export const agentDistScript = (agentName: string) =>
  join(AGENTS_DIST, "agents", `${agentName}.mjs`);
/** ~/.dovepaw/cron/<agentName>.mjs — deployed agent script */
export const schedulerScript = (agentName: string) => join(SCHEDULER_ROOT, `${agentName}.mjs`);
/** ~/.dovepaw/cron/node_modules/<pkg> */
export const schedulerNodeModule = (pkg: string) => join(SCHEDULER_ROOT, "node_modules", pkg);
/** ~/Library/LaunchAgents/<label>.plist */
export const plistFilePath = (label: string) => join(LAUNCH_AGENTS_DIR, `${label}.plist`);
/** ~/.dovepaw/cron/a2a-trigger.mjs — compiled A2A trigger script used by all launchd plists */
export const A2A_TRIGGER_SCRIPT = join(SCHEDULER_ROOT, "a2a-trigger.mjs");
