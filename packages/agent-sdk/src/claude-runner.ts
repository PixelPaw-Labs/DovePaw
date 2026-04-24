import { spawn } from "node:child_process";
import { createWriteStream, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CLAUDE_CLI,
  buildSpawnEnv,
  type SpawnClaudeHandle,
  type SpawnClaudeOptions,
  type SpawnClaudeResult,
} from "./claude.js";
import { registerChildPid, unregisterChildPid } from "./lock.js";
import { claudeWorktreePath } from "./paths.js";
import { WorktreeWatchdog } from "./worktree-watchdog.js";

const noopKill: () => Promise<void> = async () => {};

function spawnClaude(args: string[], opts: SpawnClaudeOptions): SpawnClaudeHandle {
  const { cwd, taskName, timeoutMs = 30 * 60 * 1000, stderrToLog } = opts;

  let killFn: () => Promise<void> = noopKill;

  const result = new Promise<SpawnClaudeResult>((resolve) => {
    const child = spawn(CLAUDE_CLI, args, {
      cwd,
      env: buildSpawnEnv(taskName, opts.suppressNotify, opts.apiKey),
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
    const logStream = stderrToLog ? createWriteStream(stderrToLog, { flags: "a" }) : null;

    child.stdout.on("data", (data: Buffer) => chunks.push(data));
    child.stderr.on("data", (data: Buffer) => {
      if (logStream) logStream.write(data);
      else stderrChunks.push(data);
    });

    const timer = setTimeout(() => {
      void killFn();
    }, timeoutMs);

    child.on("close", (code) => {
      closed = true;
      clearTimeout(timer);
      logStream?.end();
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

export interface RunOpts {
  repos?: string[];
  taskName: string;
  timeoutMs?: number;
  cwd: string;
  agent?: string;
  model?: string;
  effort?: string;
  worktree?: string;
  continueSession?: boolean;
  permissionMode?: string;
  /** Assign a session ID for later resumption via resumeSession. */
  sessionId?: string;
  /** Resume a prior session by its ID (--resume <id>). */
  resumeSession?: string;
  /** Override ANTHROPIC_API_KEY for this invocation. */
  apiKey?: string;
}

const WORKTREE_MAX_ATTEMPTS = 2;

/** Build the Claude CLI args for a run. Exported for testing. */
export function buildClaudeArgs(opts: RunOpts): string[] {
  const args = [
    ...(opts.sessionId ? ["--session-id", opts.sessionId] : []),
    ...(opts.resumeSession ? ["--resume", opts.resumeSession] : []),
    ...(opts.permissionMode ? ["--permission-mode", opts.permissionMode] : []),
    ...(opts.agent ? ["--agent", opts.agent] : []),
    "--model",
    opts.model ?? "sonnet",
    ...(opts.effort ? ["--effort", opts.effort] : []),
    ...(opts.worktree ? ["-w", opts.worktree] : []),
    ...(opts.continueSession ? ["-c"] : []),
  ];
  if (!opts.worktree && opts.repos?.length) args.push("--add-dir", ...opts.repos);
  return args;
}

/**
 * Higher-level Claude runner with worktree watchdog support.
 * Wraps spawnClaude and retries once if the worktree directory never appears
 * (which indicates a hung Claude CLI process).
 */
export class ClaudeRunner {
  private readonly watchdog = new WorktreeWatchdog();
  private currentHandle: SpawnClaudeHandle | null = null;

  constructor(
    private readonly logDir: string,
    private readonly logFile: string,
  ) {}

  async run(prompt: string, opts: RunOpts): Promise<{ code: number; stdout: string }> {
    const shutdown = () => {
      void this.currentHandle?.kill().then(() => process.exit(0));
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
    try {
      return await this.runOnce(prompt, opts);
    } finally {
      process.off("SIGTERM", shutdown);
      process.off("SIGINT", shutdown);
    }
  }

  private async runOnce(
    prompt: string,
    opts: RunOpts,
    attempt = 1,
  ): Promise<{ code: number; stdout: string }> {
    const args = buildClaudeArgs(opts);
    args.push("-p", prompt);

    // Suppress notifications on non-final attempts (will be killed and retried)
    const canRetry = opts.worktree && attempt < WORKTREE_MAX_ATTEMPTS;
    const handle = spawnClaude(args, {
      cwd: opts.cwd,
      taskName: opts.taskName,
      timeoutMs: opts.timeoutMs ?? 24 * 60 * 60 * 1000,
      stderrToLog: this.logFile,
      suppressNotify: canRetry || false,
      apiKey: opts.apiKey,
    });
    this.currentHandle = handle;

    // When using a worktree, race against a watchdog that detects hung CLI processes.
    // If the worktree directory never appears, the CLI is stuck — kill and retry once.
    if (opts.worktree) {
      const wtPath = claudeWorktreePath(opts.cwd, opts.worktree);
      const wd = this.watchdog.watch(wtPath);
      const result = await Promise.race([
        handle.result.then((r) => ({ kind: "done" as const, ...r })),
        wd.hung.then((kind) => ({ kind })),
      ]);

      wd.cancel();

      if (result.kind === "hung") {
        await handle.kill();
        if (attempt < WORKTREE_MAX_ATTEMPTS) {
          return this.runOnce(prompt, opts, attempt + 1);
        }
        return {
          code: 1,
          stdout: `HUNG: worktree never created after ${WORKTREE_MAX_ATTEMPTS} attempts`,
        };
      }
      return { code: result.code, stdout: result.stdout };
    }

    return handle.result;
  }

  writeLog(prefix: string, id: string, content: string): string {
    const path = join(this.logDir, `${prefix}-${id}.log`);
    writeFileSync(path, content);
    return path;
  }
}
