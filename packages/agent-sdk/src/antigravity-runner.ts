import { spawn, type ChildProcess } from "node:child_process";
import { accessSync, constants, createWriteStream, writeFileSync } from "node:fs";
import { cp, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { ensureWorktree } from "./claude-runner.js";
import { withKeepAwake } from "./keep-awake.js";
import type { SecurityMode } from "./security-policy.js";

export const DEFAULT_ANTIGRAVITY_MODEL = "gemini-4-neon";

export interface AntigravityRunOpts {
  /** Working directory for Antigravity execution */
  cwd: string;
  /** Task name for logging/tracking */
  taskName: string;
  /** Gemini model ID (defaults to "gemini-4-neon") */
  model?: string;
  /** Reasoning effort passed to `agy --effort` */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** Timeout in milliseconds (defaults to 30 minutes) */
  timeoutMs?: number;
  /** Additional directories to expose via repeatable `--add-dir` flags */
  additionalDirectories?: string[];
  /** Resume a prior Antigravity conversation by ID (`--conversation`) */
  resumeSession?: string;
  /** Continue the most recent conversation (`--continue`) */
  continueSession?: boolean;
  /** Git worktree branch name — creates/reuses <cwd>/.claude/worktrees/<branch> just like ClaudeRunner */
  worktree?: string;
  /** Paths to copy into the worktree after it is created. Only used when `worktree` is set. */
  worktreeCopy?: Array<{ src: string; dst: string }>;
  /** Additional instructions prepended to the prompt in <system-instructions> tags */
  appendSystemPrompt?: string;
  /** Security mode translated from DOVEPAW_SECURITY_MODE */
  securityMode?: SecurityMode;
  /** Enable OS-level terminal sandbox (`--sandbox`) */
  enableSandbox?: boolean;
  /** Override `agy` CLI binary path (defaults to DOVEPAW_AGY_BIN, PATH lookup, or ~/.local/bin/agy) */
  agyBin?: string;
}

export interface AntigravityResult {
  code: number;
  stdout: string;
  sessionId?: string;
}

function toFieldMap(value: unknown): Map<string, unknown> | null {
  return typeof value === "object" && value !== null ? new Map(Object.entries(value)) : null;
}

function isExecutable(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Locate the `agy` CLI binary. Throws an Error if `agy` is not installed.
 * Checks explicit override, `DOVEPAW_AGY_BIN`, `PATH` entries, and `~/.local/bin/agy`
 * (important for launchd daemons whose minimal PATH omits ~/.local/bin).
 */
export function resolveAgyBin(
  override?: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const explicit = override?.trim() || env.DOVEPAW_AGY_BIN?.trim();
  if (explicit) {
    if (explicit.includes("/") || explicit.includes("\\")) {
      if (!isExecutable(explicit)) {
        throw new Error(
          `Antigravity CLI (agy) not found or not executable at "${explicit}". Install \`agy\` and sign in first.`,
        );
      }
    }
    return explicit;
  }

  const binName = process.platform === "win32" ? "agy.exe" : "agy";
  const pathDirs = (env.PATH ?? "").split(delimiter).filter(Boolean);
  const home = env.HOME ?? homedir();
  const candidates = [
    ...pathDirs.map((dir) => join(dir, binName)),
    join(home, ".local", "bin", binName),
  ];

  for (const candidate of candidates) {
    if (isExecutable(candidate)) return candidate;
  }

  throw new Error(
    "Antigravity CLI (`agy`) is not installed or not found on PATH. Install `agy` and sign in before running Gemini sub-agents.",
  );
}

/** Build the CLI argument vector for `agy --output-format stream-json --print=...`. */
export function buildAgyArgs(prompt: string, opts: AntigravityRunOpts): string[] {
  const model = opts.model?.trim() || DEFAULT_ANTIGRAVITY_MODEL;
  const fullPrompt = opts.appendSystemPrompt?.trim()
    ? `<system-instructions>\n${opts.appendSystemPrompt.trim()}\n</system-instructions>\n\n${prompt}`
    : prompt;

  const args: string[] = ["--output-format", "stream-json", "--model", model];

  if (opts.effort) {
    args.push("--effort", opts.effort);
  }

  if (opts.securityMode === "read-only") {
    args.push("--mode", "plan", "--sandbox");
  } else if (opts.securityMode === "supervised") {
    args.push("--mode", "auto", "--sandbox");
  } else {
    args.push("--dangerously-skip-permissions");
    if (opts.enableSandbox) args.push("--sandbox");
  }

  if (opts.resumeSession?.trim()) {
    args.push("--conversation", opts.resumeSession.trim());
  } else if (opts.continueSession) {
    args.push("--continue");
  }

  if (opts.additionalDirectories?.length) {
    for (const dir of opts.additionalDirectories) {
      if (dir.trim()) args.push("--add-dir", dir.trim());
    }
  }

  if (opts.timeoutMs && opts.timeoutMs > 0) {
    const secs = Math.max(1, Math.ceil(opts.timeoutMs / 1000));
    args.push("--print-timeout", `${secs}s`);
  }

  args.push(`--print=${fullPrompt}`);
  return args;
}

/**
 * Antigravity runner powered by the `agy` CLI (`--output-format stream-json`),
 * using your existing Antigravity login without requiring GEMINI_API_KEY.
 * Throws immediately if `agy` is not installed.
 */
export class AntigravityRunner {
  private child: ChildProcess | null = null;
  private timedOut = false;

  constructor(
    private readonly logDir: string,
    private readonly logFile = "",
  ) {}

  async run(prompt: string, opts: AntigravityRunOpts): Promise<AntigravityResult> {
    // Fail fast if `agy` is not installed (before creating worktrees or wake locks)
    const agyBin = resolveAgyBin(opts.agyBin);

    const shutdown = () => {
      this.killRunningProcess();
      process.exit(0);
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
    try {
      return await withKeepAwake(`antigravity:${opts.taskName}`, () =>
        this.runOnce(agyBin, prompt, opts),
      );
    } finally {
      process.off("SIGTERM", shutdown);
      process.off("SIGINT", shutdown);
      this.killRunningProcess();
    }
  }

  private async runOnce(
    agyBin: string,
    prompt: string,
    opts: AntigravityRunOpts,
  ): Promise<AntigravityResult> {
    const cwd = opts.worktree
      ? await ensureWorktree(opts.cwd, opts.worktree)
      : opts.cwd || process.cwd();
    if (opts.worktreeCopy?.length) {
      await Promise.all(
        opts.worktreeCopy.map(async ({ src, dst }) => {
          await mkdir(dirname(dst), { recursive: true });
          await cp(src, dst, { recursive: true, force: true }).catch(() => {});
        }),
      );
    }

    const args = buildAgyArgs(prompt, opts);
    const timeoutMs = opts.timeoutMs ?? 30 * 60 * 1000;
    const logStream = this.logFile ? createWriteStream(this.logFile, { flags: "a" }) : null;
    this.timedOut = false;

    return new Promise<AntigravityResult>((resolve, reject) => {
      const child = spawn(agyBin, args, {
        cwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.child = child;

      const timeoutId = setTimeout(() => {
        this.timedOut = true;
        this.killRunningProcess();
      }, timeoutMs);

      let stdoutBuffer = "";
      let stderrOutput = "";
      let resultResponse: string | undefined;
      let streamedText = "";
      let conversationId: string | undefined;
      let errorMessage = "";
      let settled = false;

      const finish = (result: AntigravityResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        this.child = null;
        logStream?.end();
        resolve(result);
      };

      const failSpawn = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        this.child = null;
        logStream?.end();
        reject(err);
      };

      const processLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        if (logStream) logStream.write(trimmed + "\n");
        try {
          const parsed = toFieldMap(JSON.parse(trimmed));
          if (!parsed) return;

          const topConvId = parsed.get("conversation_id");
          if (typeof topConvId === "string" && topConvId) conversationId = topConvId;

          const eventName = parsed.get("event");
          if (eventName === "step_update") {
            const stepUpdate = toFieldMap(parsed.get("step_update"));
            if (stepUpdate) {
              const stepConvId = stepUpdate.get("conversation_id");
              if (typeof stepConvId === "string" && stepConvId) conversationId = stepConvId;
              const delta = stepUpdate.get("text_delta");
              if (typeof delta === "string") streamedText += delta;
            }
          } else if (eventName === "result") {
            const resObj = toFieldMap(parsed.get("result"));
            if (resObj) {
              const resConvId = resObj.get("conversation_id");
              if (typeof resConvId === "string" && resConvId) conversationId = resConvId;
              const responseText = resObj.get("response");
              if (typeof responseText === "string") resultResponse = responseText;
              const status = resObj.get("status");
              if (typeof status === "string" && status !== "SUCCESS") {
                const errField = resObj.get("error");
                errorMessage =
                  typeof errField === "string" && errField
                    ? errField
                    : `Antigravity returned status ${status}`;
              }
            }
          } else if (eventName === "error") {
            const msg = parsed.get("message") ?? parsed.get("error");
            if (typeof msg === "string" && msg) errorMessage = msg;
          }
        } catch {
          // Non-JSON line (e.g. startup notice) — already written to logStream
        }
      };

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBuffer += chunk.toString("utf-8");
        const lines = stdoutBuffer.split("\n");
        stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) processLine(line);
      });

      child.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf-8");
        stderrOutput += text;
        if (logStream) logStream.write(text);
      });

      child.on("error", (err) => {
        const enoent = (err as NodeJS.ErrnoException).code === "ENOENT";
        if (enoent) {
          failSpawn(
            new Error(
              `Antigravity CLI (\`agy\`) is not installed or could not be executed (${agyBin}).`,
            ),
          );
          return;
        }
        finish({ code: 1, stdout: `Error: Failed to spawn agy CLI: ${err.message}` });
      });

      child.on("close", (exitCode) => {
        if (stdoutBuffer) processLine(stdoutBuffer);

        if (this.timedOut) {
          finish({ code: 1, stdout: "TIMEOUT: Antigravity execution timed out" });
          return;
        }
        if (exitCode === 0 && !errorMessage) {
          finish({
            code: 0,
            stdout: resultResponse ?? streamedText,
            ...(conversationId ? { sessionId: conversationId } : {}),
          });
          return;
        }
        const detail = errorMessage || stderrOutput.trim() || `exit code ${exitCode ?? "unknown"}`;
        finish({ code: 1, stdout: `Error: ${detail}` });
      });
    });
  }

  killRunningProcess(): void {
    if (this.child && !this.child.killed) {
      this.child.kill("SIGTERM");
    }
    this.child = null;
  }

  writeLog(prefix: string, id: string, content: string): string {
    const path = join(this.logDir, `${prefix}-${id}.log`);
    writeFileSync(path, content);
    return path;
  }
}
