import { join } from "node:path";

const HOME = process.env.HOME!;
const DOVEPAW_DIR = join(HOME, ".dovepaw");

/** ~/.dovepaw/agents/logs/.<agentName> — persistent per-agent log directory */
export const agentPersistentLogDir = (agentName: string) =>
  join(DOVEPAW_DIR, "agents/logs", `.${agentName}`);

/** ~/.dovepaw/agents/state/.<agentName> — persistent per-agent state directory */
export const agentPersistentStateDir = (agentName: string) =>
  join(DOVEPAW_DIR, "agents/state", `.${agentName}`);

/** ~/.dovepaw/settings.agents/<agentName>/ — per-agent config files directory */
export const agentConfigDir = (agentName: string) =>
  join(DOVEPAW_DIR, "settings.agents", agentName);

/** <repoPath>/.claude/worktrees/<wtName> — Claude Code worktree directory */
export const claudeWorktreePath = (repoPath: string, wtName: string) =>
  join(repoPath, ".claude", "worktrees", wtName);
