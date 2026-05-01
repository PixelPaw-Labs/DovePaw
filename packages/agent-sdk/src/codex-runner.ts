import { Codex } from "@openai/codex-sdk";
import type { Thread, WebSearchMode, SandboxMode, CodexOptions } from "@openai/codex-sdk";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export interface CodexRunOpts {
  /** Working directory for codex execution */
  cwd: string;
  /** Task name for logging/tracking */
  taskName: string;
  /** OpenAI API key (defaults to OPENAI_API_KEY env var) */
  apiKey?: string;
  /** Codex model to use (defaults to gpt-5.4) */
  model?: string;
  /** Agent roster/developer instructions */
  agentRoster?: string;
  /** Generic Codex CLI config overrides passed to `new Codex({ config })` */
  config?: CodexOptions["config"];
  /** Timeout in milliseconds */
  timeoutMs?: number;
  /** Whether to skip git repo validation */
  skipGitRepoCheck?: boolean;
  /** Additional directories to grant write access alongside the workspace */
  additionalDirectories?: string[];
  /** Resume an existing Codex thread by its ID instead of starting a new one. */
  resumeSession?: string;
  webSearchEnabled?: boolean;
  webSearchMode?: WebSearchMode;
  sandboxMode?: SandboxMode;
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
   * scheduler unload / Ctrl-C / killProc() all kill the Codex subprocess cleanly.
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
    const config = {
      ...opts.config,
      ...(opts.agentRoster ? { developer_instructions: opts.agentRoster } : {}),
    };

    this.codex = new Codex({
      ...(apiKey ? { apiKey } : {}),
      ...(Object.keys(config).length ? { config } : {}),
    });

    const threadOptions = {
      model: opts.model || "gpt-5.4-mini",
      workingDirectory: opts.cwd || process.cwd(),
      skipGitRepoCheck: opts.skipGitRepoCheck ?? true,
      approvalPolicy: "never" as const,
      ...(opts.additionalDirectories?.length
        ? { additionalDirectories: opts.additionalDirectories }
        : {}),
      ...(opts.webSearchEnabled !== undefined ? { webSearchEnabled: opts.webSearchEnabled } : {}),
      ...(opts.webSearchMode !== undefined ? { webSearchMode: opts.webSearchMode } : {}),
      ...(opts.sandboxMode !== undefined ? { sandboxMode: opts.sandboxMode } : {}),
    };
    this.thread = opts.resumeSession
      ? this.codex.resumeThread(opts.resumeSession, threadOptions)
      : this.codex.startThread(threadOptions);
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
