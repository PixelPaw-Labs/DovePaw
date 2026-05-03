import { mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export * from "./plugin-paths";
export * from "./group-paths";

function resolveAgentsRoot(): string {
  try {
    // Native ESM (Node.js / tsx / Electron tsup bundle): derive from this file's location.
    // lib/paths.ts → lib/ → DovePaw/
    return join(dirname(fileURLToPath(import.meta.url)), "..");
  } catch {
    // webpack/Next.js bundle: import.meta.url is a webpack:/// URL that fileURLToPath rejects.
    // Next.js is invoked from the DovePaw root, so process.cwd() IS DovePaw.
    return process.cwd();
  }
}

/** DovePaw/ — root of the DovePaw monorepo */
export const AGENTS_ROOT = resolveAgentsRoot();
/** DovePaw/chatbot/public — Next.js static assets directory */
export const CHATBOT_PUBLIC_DIR = join(AGENTS_ROOT, "chatbot", "public");
/** ~/.dovepaw/ — user-scoped DovePaw data directory (outside the repo). Override with DOVEPAW_DATA_DIR for server deployments. */
export const DOVEPAW_DIR = process.env.DOVEPAW_DATA_DIR ?? join(process.env.HOME!, ".dovepaw");
/** ~/.dovepaw/settings.json — global settings (watched repositories, etc.) */
export const SETTINGS_FILE = join(DOVEPAW_DIR, "settings.json");
/** ~/.dovepaw/agent-links.json — global agent communication link topology */
export const AGENT_LINKS_FILE = join(DOVEPAW_DIR, "agent-links.json");
/** ~/.dovepaw/settings.agents/ — per-agent settings directory */
export const AGENT_SETTINGS_DIR = join(DOVEPAW_DIR, "settings.agents");
/** ~/.dovepaw/workspaces/ — isolated execution workspace roots for all agents */
export const WORKSPACES_DIR = join(DOVEPAW_DIR, "workspaces");
/** ~/.dovepaw/workspaces/.{agentName}/ — per-agent workspace root */
export const agentWorkspaceDir = (agentName: string): string => {
  const dir = join(WORKSPACES_DIR, `.${agentName}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};
/** {workspaceRoot ?? agentWorkspaceDir}/{alias}-{shortId} — single agent execution workspace. Creates the directory. */
export const agentWorkspacePath = (
  agentName: string,
  alias: string,
  shortId: string,
  workspaceRoot?: string,
): string => {
  const root = workspaceRoot ?? agentWorkspaceDir(agentName);
  const path = join(root, `${alias}-${shortId}`);
  mkdirSync(path, { recursive: true });
  return path;
};
/** ~/.dovepaw/agents/state — persistent agent state root */
export const DOVEPAW_AGENT_STATE = join(DOVEPAW_DIR, "agents/state");
/** ~/.dovepaw/agents/state/.<agentName> — persistent per-agent state directory */
export const agentPersistentStateDir = (agentName: string) =>
  join(DOVEPAW_AGENT_STATE, `.${agentName}`);
/** ~/.dovepaw/logs — Electron process log directory */
export const DOVEPAW_LOGS_DIR = join(DOVEPAW_DIR, "logs");
/** ~/.dovepaw/agents/logs — persistent agent log root */
export const DOVEPAW_AGENT_LOGS = join(DOVEPAW_DIR, "agents/logs");
/** ~/.dovepaw/agents/logs/.<agentName> — persistent per-agent log directory */
export const agentPersistentLogDir = (agentName: string) =>
  join(DOVEPAW_AGENT_LOGS, `.${agentName}`);
/** ~/.dovepaw/settings.agents/<agentName>/ — per-agent config files directory */
export const agentConfigDir = (agentName: string): string => join(AGENT_SETTINGS_DIR, agentName);
/** ~/.dovepaw/settings.agents/<agentName>/agent.json — combined definition + runtime settings */
export const agentDefinitionFile = (agentName: string) =>
  join(agentConfigDir(agentName), "agent.json");
/** ~/.dovepaw/settings.agents/<agentName>/<filename> — a specific agent config file */
export const agentConfigFile = (agentName: string, filename: string) =>
  join(agentConfigDir(agentName), filename);
/** ~/.claude/rules — user Claude rules directory */
export const CLAUDE_RULES_ROOT = join(process.env.HOME!, ".claude/rules");
/** ~/.claude/skills — user skills directory */
export const SKILLS_ROOT = join(process.env.HOME!, ".claude/skills");
/** ~/.codex/skills — Codex skills directory */
export const CODEX_SKILLS_ROOT = join(process.env.HOME!, ".codex/skills");
/** Resolve an agent's entry point to an absolute path under agents/ root */
export const agentEntryPath = (entryPath: string) => join(AGENTS_ROOT, entryPath);
/** DovePaw/agent-local/ — locally developed agents (auto-linked on install/electron:dev) */
export const AGENT_LOCAL_DIR = join(AGENTS_ROOT, "agent-local");
/** DovePaw/node_modules/<pkg> */
export const agentNodeModule = (pkg: string) => join(AGENTS_ROOT, "node_modules", pkg);
/** <repoPath>/.claude/worktrees/<wtName> — Claude Code worktree directory for a named worktree */
export const claudeWorktreePath = (repoPath: string, wtName: string) =>
  join(repoPath, ".claude", "worktrees", wtName);
/** ~/.dovepaw/.ports.<port>.json — runtime port manifest for a specific Next.js port */
export const portsFile = (port: string | number): string =>
  join(DOVEPAW_DIR, `.ports.${port}.json`);
/** ~/.dovepaw/.a2a-servers.pid — PID of the running A2A servers process */
export const A2A_SERVERS_PID_FILE = join(DOVEPAW_DIR, ".a2a-servers.pid");
/** ~/.dovepaw/tmp/ — dynamically created session agent configs (written by Dove at runtime) */
export const DOVEPAW_TMP_DIR = join(DOVEPAW_DIR, "tmp");
/** ~/.dovepaw/tmp/<agentName>/agent.json — session agent definition */
export const tmpAgentDefinitionFile = (agentName: string) =>
  join(DOVEPAW_TMP_DIR, agentName, "agent.json");
/**
 * Resolve a non-plugin agent's main.ts entry point.
 * Checks agent-local/ first (locally developed agents), then falls back to
 * ~/.dovepaw/tmp/ (session agents created by Dove at runtime).
 */
export const resolveLocalAgentScript = (agentName: string): string => {
  const localPath = join(AGENT_LOCAL_DIR, agentName, "main.ts");
  return existsSync(localPath) ? localPath : join(DOVEPAW_TMP_DIR, agentName, "main.ts");
};
/** DovePaw/.claude/hooks/karpathy-guidelines.sh — UserPromptSubmit hook injected into agent workspaces */
export const KARPATHY_HOOK_SRC = join(AGENTS_ROOT, ".claude/hooks/karpathy-guidelines.sh");

// ─── Scheduler paths (cross-platform) ────────────────────────────────────────

/** DovePaw/dist — compiled agent scripts */
export const AGENTS_DIST = join(AGENTS_ROOT, "dist");
/** ~/.dovepaw/cron — deployed agent scripts and native node_modules */
export const SCHEDULER_ROOT = join(DOVEPAW_DIR, "cron");
/** ~/.dovepaw/cron/a2a-trigger.mjs — A2A trigger script used by all scheduled jobs */
export const A2A_TRIGGER_SCRIPT = join(SCHEDULER_ROOT, "a2a-trigger.mjs");
/** DovePaw/dist/agents/<agentName>.mjs — compiled agent script */
export const agentDistScript = (agentName: string) =>
  join(AGENTS_DIST, "agents", `${agentName}.mjs`);
/** ~/.dovepaw/cron/<agentName>.mjs — deployed agent script */
export const schedulerScript = (agentName: string) => join(SCHEDULER_ROOT, `${agentName}.mjs`);
/** ~/.dovepaw/cron/node_modules/<pkg> */
export const schedulerNodeModule = (pkg: string) => join(SCHEDULER_ROOT, "node_modules", pkg);
