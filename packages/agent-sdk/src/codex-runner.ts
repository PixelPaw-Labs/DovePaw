import { Codex } from "@openai/codex-sdk";
import type { Thread } from "@openai/codex-sdk";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export interface CodexRunOpts {
  /** Working directory for codex execution */
  cwd: string;
  /** Task name for logging/tracking */
  taskName: string;
  /** OpenAI API key (defaults to OPENAI_API_KEY env var) */
  apiKey?: string;
  /** Codex model to use (defaults to gpt-5.2) */
  model?: string;
  /** Agent roster/developer instructions */
  agentRoster?: string;
  /** Timeout in milliseconds */
  timeoutMs?: number;
  /** Whether to skip git repo validation */
  skipGitRepoCheck?: boolean;
}

interface CodexResult {
  code: number;
  stdout: string;
}

/**
 * Codex runner with proper abort/cancellation support.
 * Manages a Codex thread and ensures processes can be terminated cleanly.
 */
export class CodexRunner {
  private codex: Codex | null = null;
  private thread: Thread | null = null;
  private abortController: AbortController | null = null;

  constructor(private readonly logDir: string) {}

  /**
   * Run a prompt through Codex and return the result.
   * Registers SIGTERM/SIGINT handlers for the duration of the run so
   * launchd unload / Ctrl-C / killProc() all kill the Codex subprocess cleanly.
   */
  async run(prompt: string, opts: CodexRunOpts): Promise<CodexResult> {
    const shutdown = () => {
      this.killRunningProcess();
      process.exit(0);
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
    try {
      await this.connect(opts);
      return await this.execute(prompt, opts.timeoutMs ?? 30 * 60 * 1000);
    } finally {
      process.off("SIGTERM", shutdown);
      process.off("SIGINT", shutdown);
      await this.disconnect();
    }
  }

  private async connect(opts: CodexRunOpts): Promise<void> {
    const apiKey = opts.apiKey || process.env.OPENAI_API_KEY;

    this.codex = new Codex({
      ...(apiKey ? { apiKey } : {}),
      ...(opts.agentRoster ? { config: { developer_instructions: opts.agentRoster } } : {}),
    });

    this.thread = this.codex.startThread({
      model: opts.model || "gpt-5.4",
      workingDirectory: opts.cwd || process.cwd(),
      skipGitRepoCheck: opts.skipGitRepoCheck ?? true,
      sandboxMode: "workspace-write",
      approvalPolicy: "on-request",
    });
  }

  private async execute(prompt: string, timeoutMs: number): Promise<CodexResult> {
    if (!this.thread) {
      return {
        code: 1,
        stdout: "Error: Not connected to Codex",
      };
    }

    // Set up abort controller and timeout
    this.abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      this.abortController?.abort();
    }, timeoutMs);

    try {
      const turnOptions = {
        signal: this.abortController.signal,
      };

      const turn = await this.thread.run(prompt, turnOptions);

      return {
        code: 0,
        stdout: turn.finalResponse || "",
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      // Check if aborted due to timeout or explicit cancellation
      if (this.abortController?.signal.aborted) {
        return {
          code: 1,
          stdout: `Error: Codex execution aborted (${message || "timeout"})`,
        };
      }

      return {
        code: 1,
        stdout: `Error: ${message || "Unknown error"}`,
      };
    } finally {
      clearTimeout(timeoutId);
      this.abortController = null;
    }
  }

  private async disconnect(): Promise<void> {
    this.killRunningProcess();
    this.thread = null;
    this.codex = null;
  }

  /**
   * Abort any running Codex execution via AbortSignal.
   */
  killRunningProcess(): void {
    if (this.abortController && !this.abortController.signal.aborted) {
      this.abortController.abort();
    }
    this.abortController = null;
  }

  /**
   * Write output to a log file.
   */
  writeLog(prefix: string, id: string, content: string): string {
    const path = join(this.logDir, `${prefix}-${id}.log`);
    writeFileSync(path, content);
    return path;
  }
}
