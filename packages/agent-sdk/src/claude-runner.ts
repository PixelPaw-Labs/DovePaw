import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnClaude } from "./claude.js";
import { claudeWorktreePath } from "./paths.js";
import { WorktreeWatchdog } from "./worktree-watchdog.js";

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
  /** Assign a session ID for later resumption via resumeSession. */
  sessionId?: string;
  /** Resume a prior session by its ID (--resume <id>). */
  resumeSession?: string;
}

const WORKTREE_MAX_ATTEMPTS = 2;

/** Build the Claude CLI args for a run. Exported for testing. */
export function buildClaudeArgs(opts: RunOpts): string[] {
  const args = [
    ...(opts.sessionId ? ["--session-id", opts.sessionId] : []),
    ...(opts.resumeSession ? ["--resume", opts.resumeSession] : []),
    ...(opts.agent ? ["--agent", opts.agent] : []),
    ...(opts.model ? ["--model", opts.model] : []),
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

  constructor(
    private readonly logDir: string,
    private readonly logFile: string,
  ) {}

  async run(prompt: string, opts: RunOpts): Promise<{ code: number; stdout: string }> {
    return this.runOnce(prompt, opts);
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
    });

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
