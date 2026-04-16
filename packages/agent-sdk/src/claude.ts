import { join } from "node:path";

const HOME = process.env.HOME!;
export const CLAUDE_CLI = join(HOME, ".local/bin/claude");

export const AUTONOMY_PREFIX =
  "Autonomy mode: never use AskUserQuestion tool — explore answers yourself.";

// Unset nested session guard so Claude CLI can launch
delete (process.env as Record<string, unknown>).CLAUDECODE;

// Strip direct asdf install paths (e.g. ~/.asdf/installs/nodejs/22.22.0/bin)
// so only ~/.asdf/shims remains. The session-setup.sh hook handles this too via
// CLAUDE_ENV_FILE, but this is a safety net for the initial PATH passed to Claude CLI.
function buildClaudePath(): string {
  return (process.env.PATH || "")
    .split(":")
    .filter((p) => !p.includes(`${HOME}/.asdf/installs/`))
    .join(":");
}

export interface SpawnClaudeOptions {
  cwd?: string;
  taskName: string;
  timeoutMs?: number;
  stderrToLog?: string; // log file path to write stderr to
  suppressNotify?: boolean; // suppress scheduler notification on session end
}

export interface SpawnClaudeResult {
  code: number;
  stdout: string;
}

export interface SpawnClaudeHandle {
  result: Promise<SpawnClaudeResult>;
  /** Send SIGTERM, wait up to 5s for exit, then SIGKILL. Resolves when the process is dead. */
  kill: () => Promise<void>;
}

/** Build the env object for a spawned Claude process. Exported for testing. */
export function buildSpawnEnv(taskName: string, suppressNotify?: boolean): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CLAUDECODE: undefined,
    CLAUDE_SCHEDULER_TASK: taskName,
    CLAUDE_SCHEDULER_SUPPRESS_NOTIFY: suppressNotify ? "1" : "",
    SHELL: process.env.SHELL || "/bin/zsh",
    TERM: process.env.TERM || "xterm-256color",
    PATH: buildClaudePath(),
  };
}
