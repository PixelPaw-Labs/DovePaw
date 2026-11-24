import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, writeFileSync } from "node:fs";
import { cp, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureWorktree } from "./claude-runner.js";
import { withKeepAwake } from "./keep-awake.js";
import type { SecurityMode } from "./security-policy.js";

export interface AntigravityRunOpts {
  /** Working directory for Antigravity execution */
  cwd: string;
  /** Task name for logging/tracking */
  taskName: string;
  /** Model override (e.g. "gemini-3.8-flash"). Omit to use the SDK default model. */
  model?: string;
  /** Timeout in milliseconds (defaults to 30 minutes) */
  timeoutMs?: number;
  /** Additional directories to expose to the agent alongside cwd */
  additionalDirectories?: string[];
  /** Optional API key override for Gemini / Vertex Express */
  apiKey?: string;
  /** Assign a session/conversation ID for later resumption via resumeSession */
  sessionId?: string;
  /** Resume a prior Antigravity conversation by ID */
  resumeSession?: string;
  /** Directory to persist Antigravity conversation state across turns (auto-set when sessionId/resumeSession is used) */
  saveDir?: string;
  /** Git worktree branch name — creates/reuses <cwd>/.claude/worktrees/<branch> just like ClaudeRunner */
  worktree?: string;
  /** Paths to copy into the worktree after it is created. Only used when `worktree` is set. */
  worktreeCopy?: Array<{ src: string; dst: string }>;
  /** Additional system instructions passed to LocalAgentConfig.system_instructions */
  appendSystemPrompt?: string;
  /** Security mode translated from DOVEPAW_SECURITY_MODE */
  securityMode?: SecurityMode;
  /** Allow SEARCH_WEB / READ_URL_CONTENT builtin tools */
  allowWebTools?: boolean;
  /** Enable OS-level terminal sandbox in RunCommandConfig */
  enableSandbox?: boolean;
  /** Allow Antigravity nested subagents (defaults to true) */
  enableSubagents?: boolean;
  /** Directories scanned for Antigravity skills (defaults to ~/.gemini/config/skills if present) */
  skillsPaths?: string[];
  /** Enable Vertex AI backend */
  vertex?: boolean;
  /** GCP project ID (when vertex is true) */
  project?: string;
  /** GCP location (when vertex is true) */
  location?: string;
  /** Override Python interpreter path (defaults to DOVEPAW_ANTIGRAVITY_PYTHON or ~/.dovepaw/antigravity-venv/bin/python) */
  pythonBin?: string;
  /** Override bridge script path (primarily for testing) */
  bridgeScriptPath?: string;
}

export interface AntigravityResult {
  code: number;
  stdout: string;
  sessionId?: string;
}

function defaultDovepawDir(): string {
  return process.env.DOVEPAW_DATA_DIR ?? join(homedir(), ".dovepaw");
}

/** Resolve the Python interpreter with google-antigravity installed. */
export function resolveAntigravityPython(
  override?: string,
  env: Record<string, string | undefined> = process.env,
): string {
  if (override?.trim()) return override.trim();
  if (env.DOVEPAW_ANTIGRAVITY_PYTHON?.trim()) return env.DOVEPAW_ANTIGRAVITY_PYTHON.trim();
  const venvDir = join(env.DOVEPAW_DATA_DIR ?? join(homedir(), ".dovepaw"), "antigravity-venv");
  return process.platform === "win32"
    ? join(venvDir, "Scripts", "python.exe")
    : join(venvDir, "bin", "python");
}

/** Resolve antigravity-bridge.py from beside this module or from deployed ~/.dovepaw/sdk/src/. */
export function resolveAntigravityBridgePath(override?: string): string {
  if (override?.trim()) return override.trim();
  try {
    const localPath = join(dirname(fileURLToPath(import.meta.url)), "antigravity-bridge.py");
    if (existsSync(localPath)) return localPath;
  } catch {
    // Fallback below when bundled
  }
  return join(defaultDovepawDir(), "sdk", "src", "antigravity-bridge.py");
}

/**
 * Antigravity runner that bridges Node.js/TypeScript sub-agent runs to the
 * official Python google-antigravity SDK via an isolated DovePaw Python venv.
 */
export class AntigravityRunner {
  private child: ChildProcess | null = null;
  private timedOut = false;

  constructor(
    private readonly logDir: string,
    private readonly logFile = "",
  ) {}

  async run(prompt: string, opts: AntigravityRunOpts): Promise<AntigravityResult> {
    const shutdown = () => {
      this.killRunningProcess();
      process.exit(0);
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
    try {
      return await withKeepAwake(`antigravity:${opts.taskName}`, () => this.runOnce(prompt, opts));
    } finally {
      process.off("SIGTERM", shutdown);
      process.off("SIGINT", shutdown);
      this.killRunningProcess();
    }
  }

  private async runOnce(prompt: string, opts: AntigravityRunOpts): Promise<AntigravityResult> {
    const pythonBin = resolveAntigravityPython(opts.pythonBin);
    if (!opts.pythonBin && !existsSync(pythonBin)) {
      return {
        code: 1,
        stdout:
          `Error: Antigravity Python SDK venv not found at ${pythonBin}. ` +
          `Run \`npm run build\` (or \`tsx scripts/setup.ts\`) to install google-antigravity.`,
      };
    }

    const bridgePath = resolveAntigravityBridgePath(opts.bridgeScriptPath);
    if (!existsSync(bridgePath)) {
      return {
        code: 1,
        stdout: `Error: Antigravity bridge script not found at ${bridgePath}.`,
      };
    }

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

    const saveDir =
      opts.saveDir ??
      (opts.sessionId || opts.resumeSession
        ? join(defaultDovepawDir(), "agents", "state", ".antigravity-sessions")
        : undefined);

    const payload = {
      prompt,
      cwd,
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.additionalDirectories?.length
        ? { additionalDirectories: opts.additionalDirectories }
        : {}),
      ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
      ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
      ...(opts.resumeSession ? { resumeSession: opts.resumeSession } : {}),
      ...(saveDir ? { saveDir } : {}),
      ...(opts.appendSystemPrompt ? { appendSystemPrompt: opts.appendSystemPrompt } : {}),
      ...(opts.securityMode ? { securityMode: opts.securityMode } : {}),
      ...(opts.allowWebTools !== undefined ? { allowWebTools: opts.allowWebTools } : {}),
      ...(opts.enableSandbox !== undefined ? { enableSandbox: opts.enableSandbox } : {}),
      ...(opts.enableSubagents !== undefined ? { enableSubagents: opts.enableSubagents } : {}),
      ...(opts.skillsPaths !== undefined ? { skillsPaths: opts.skillsPaths } : {}),
      ...(opts.vertex !== undefined ? { vertex: opts.vertex } : {}),
      ...(opts.project ? { project: opts.project } : {}),
      ...(opts.location ? { location: opts.location } : {}),
    };

    const timeoutMs = opts.timeoutMs ?? 30 * 60 * 1000;
    const logStream = this.logFile ? createWriteStream(this.logFile, { flags: "a" }) : null;
    this.timedOut = false;

    return new Promise<AntigravityResult>((resolve) => {
      const child = spawn(pythonBin, ["-u", bridgePath], {
        cwd,
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.child = child;

      const timeoutId = setTimeout(() => {
        this.timedOut = true;
        this.killRunningProcess();
      }, timeoutMs);

      let stdoutBuffer = "";
      let stderrOutput = "";
      let finalText = "";
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

      const processLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        if (logStream) logStream.write(trimmed + "\n");
        try {
          const event: unknown = JSON.parse(trimmed);
          if (typeof event !== "object" || event === null) return;
          const type: unknown = Reflect.get(event, "type");
          const convId: unknown = Reflect.get(event, "conversationId");
          if (typeof convId === "string" && convId) conversationId = convId;
          if (type === "result") {
            const text: unknown = Reflect.get(event, "text");
            if (typeof text === "string") finalText = text;
          } else if (type === "error") {
            const message: unknown = Reflect.get(event, "message");
            if (typeof message === "string") errorMessage = message;
          }
        } catch {
          // Non-JSON stdout line — ignore for structured parsing but keep in logStream above
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
        finish({
          code: 1,
          stdout: `Error: Failed to spawn Antigravity Python SDK: ${err.message}`,
        });
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
            stdout: finalText,
            ...(conversationId ? { sessionId: conversationId } : {}),
          });
          return;
        }
        const detail = errorMessage || stderrOutput.trim() || `exit code ${exitCode ?? "unknown"}`;
        finish({ code: 1, stdout: `Error: ${detail}` });
      });

      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
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
