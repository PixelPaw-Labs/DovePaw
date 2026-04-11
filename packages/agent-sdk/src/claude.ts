import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { registerChildPid, unregisterChildPid } from "./lock.js";

const HOME = process.env.HOME!;
const CLAUDE_CLI = join(HOME, ".local/bin/claude");

export const AUTONOMY_PREFIX =
  "Autonomy mode: never use AskUserQuestion tool — explore answers yourself.";

const noopKill: () => Promise<void> = async () => {};

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

interface SpawnClaudeOptions {
  cwd?: string;
  taskName: string;
  timeoutMs?: number;
  stderrToLog?: string; // log file path to write stderr to
  suppressNotify?: boolean; // suppress scheduler notification on session end
}

interface SpawnClaudeResult {
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

export function spawnClaude(args: string[], opts: SpawnClaudeOptions): SpawnClaudeHandle {
  const { cwd, taskName, timeoutMs = 30 * 60 * 1000, stderrToLog } = opts;

  let killFn: () => Promise<void> = noopKill;

  const result = new Promise<SpawnClaudeResult>((resolve) => {
    const child = spawn(CLAUDE_CLI, args, {
      cwd,
      env: buildSpawnEnv(taskName, opts.suppressNotify),
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (child.pid) registerChildPid(child.pid);

    let closed = false;
    const closedPromise = new Promise<void>((r) => child.on("close", () => r()));

    killFn = async () => {
      if (closed) return;
      child.kill("SIGTERM");
      const waited = await Promise.race([
        closedPromise.then(() => "exited" as const),
        new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 5_000)),
      ]);
      if (waited === "timeout") {
        child.kill("SIGKILL");
        await closedPromise;
      }
    };

    const chunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (data: Buffer) => chunks.push(data));
    child.stderr.on("data", (data: Buffer) => {
      if (stderrToLog) appendFileSync(stderrToLog, data);
      else stderrChunks.push(data);
    });

    const timer = setTimeout(() => {
      void killFn();
    }, timeoutMs);

    child.on("close", (code) => {
      closed = true;
      clearTimeout(timer);
      if (child.pid) unregisterChildPid(child.pid);
      const stdout = Buffer.concat(chunks).toString();
      const stderr = Buffer.concat(stderrChunks).toString();
      resolve({
        code: code ?? 1,
        stdout: stderrToLog ? stdout : stdout + stderr,
      });
    });
  });

  return { result, kill: () => killFn() };
}

/**
 * Like spawnClaude but registers SIGTERM/SIGINT handlers that kill the child
 * process before exiting. Cleans up the handlers when the process finishes
 * naturally. Use this in agent main() functions so launchd unload / Ctrl-C
 * doesn't orphan the Claude CLI subprocess.
 */
export async function spawnClaudeWithSignals(
  args: string[],
  opts: SpawnClaudeOptions,
): Promise<SpawnClaudeResult> {
  const handle = spawnClaude(args, opts);
  const shutdown = () => {
    void handle.kill().then(() => process.exit(0));
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  try {
    return await handle.result;
  } finally {
    process.off("SIGTERM", shutdown);
    process.off("SIGINT", shutdown);
  }
}
