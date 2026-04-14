import { mkdirSync } from "node:fs";
import { join } from "node:path";

const HOME = process.env.HOME!;
const DOVEPAW_DIR = join(HOME, ".dovepaw");

/** ~/.dovepaw/agents/logs/.<agentName> — persistent per-agent log directory */
export const agentPersistentLogDir = (agentName: string) =>
  join(DOVEPAW_DIR, "agents/logs", `.${agentName}`);

/** ~/.dovepaw/agents/state/.<agentName> — persistent per-agent state directory */
export const agentPersistentStateDir = (agentName: string) =>
  join(DOVEPAW_DIR, "agents/state", `.${agentName}`);

/** ~/.dovepaw/settings.agents/<agentName>/ — per-agent config files directory. Creates the directory if it does not exist. */
export const agentConfigDir = (agentName: string): string => {
  const dir = join(DOVEPAW_DIR, "settings.agents", agentName);
  mkdirSync(dir, { recursive: true });
  return dir;
};

/** <repoPath>/.claude/worktrees/<wtName> — Claude Code worktree directory */
export const claudeWorktreePath = (repoPath: string, wtName: string) =>
  join(repoPath, ".claude", "worktrees", wtName);
