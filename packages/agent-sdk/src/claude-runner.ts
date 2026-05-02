import { query } from "@anthropic-ai/claude-agent-sdk";
import { createWriteStream, writeFileSync } from "node:fs";
import { access, mkdir, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { exec } from "./exec.js";
import { claudeSettingsLocalPath } from "./paths.js";

export interface RunOpts {
  repos?: string[];
  taskName: string;
  timeoutMs?: number;
  cwd: string;
  agent?: string;
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  worktree?: string;
  continueSession?: boolean;
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk" | "auto";
  settingSources?: Array<"user" | "project" | "local">;
  /** Assign a session ID for later resumption via resumeSession. */
  sessionId?: string;
  /** Resume a prior session by its ID. */
  resumeSession?: string;
  /** Override ANTHROPIC_API_KEY for this invocation. */
  apiKey?: string;
}

/**
 * Create (or reuse) the git worktree at the canonical path .claude/worktrees/<branch>.
 * Matches claudeWorktreePath() so callers can locate the directory without the return value.
 */
export async function ensureWorktree(repoPath: string, branch: string): Promise<string> {
  const wtPath = join(repoPath, ".claude", "worktrees", branch);
  await mkdir(join(repoPath, ".claude", "worktrees"), { recursive: true });
  // Try creating with a new branch; fall back to checking out an existing one.
  const created = await exec("git", ["worktree", "add", wtPath, "-b", branch], { cwd: repoPath });
  if (!created.ok) {
    await exec("git", ["worktree", "add", wtPath, branch], { cwd: repoPath });
    // If both fail the worktree already exists at wtPath — still valid as cwd.
  }
  // Symlink .claude/settings.local.json from the repo root into the worktree so
  // local permission overrides apply inside the isolated worktree environment.
  const repoSettingsLocal = claudeSettingsLocalPath(repoPath);
  try {
    await access(repoSettingsLocal);
    const wtClaudeDir = join(wtPath, ".claude");
    await mkdir(wtClaudeDir, { recursive: true });
    const wtSettingsLocal = join(wtClaudeDir, "settings.local.json");
    await rm(wtSettingsLocal, { recursive: true, force: true });
    await symlink(repoSettingsLocal, wtSettingsLocal);
  } catch {
    // settings.local.json absent — skip
  }
  return wtPath;
}

export class ClaudeRunner {
  private abortController: AbortController | null = null;

  constructor(
    private readonly logDir: string,
    private readonly logFile: string,
  ) {}

  async run(prompt: string, opts: RunOpts): Promise<{ code: number; stdout: string }> {
    const shutdown = () => {
      this.abortController?.abort();
      process.exit(0);
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

  private async runOnce(prompt: string, opts: RunOpts): Promise<{ code: number; stdout: string }> {
    // When a worktree name is given, pre-create it at the canonical path so that
    // claudeWorktreePath(cwd, name) resolves correctly and retry loops reuse the
    // same branch rather than creating a new auto-named one.
    const cwd = opts.worktree ? await ensureWorktree(opts.cwd, opts.worktree) : opts.cwd;

    this.abortController = new AbortController();
    const timeoutMs = opts.timeoutMs ?? 24 * 60 * 60 * 1000;
    const timeoutId = setTimeout(() => this.abortController?.abort(), timeoutMs);
    const logStream = this.logFile ? createWriteStream(this.logFile, { flags: "a" }) : null;

    try {
      const stream = query({
        prompt,
        options: {
          cwd,
          model: opts.model ?? "claude-sonnet-4-6",
          ...(opts.agent ? { agent: opts.agent } : {}),
          ...(opts.effort ? { effort: opts.effort } : {}),
          ...(opts.permissionMode ? { permissionMode: opts.permissionMode } : {}),
          ...(opts.settingSources ? { settingSources: opts.settingSources } : {}),
          ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
          ...(opts.resumeSession ? { resume: opts.resumeSession } : {}),
          ...(opts.continueSession ? { continue: true } : {}),
          ...(!opts.worktree && opts.repos?.length ? { additionalDirectories: opts.repos } : {}),
          ...(opts.apiKey
            ? {
                env: {
                  ...Object.fromEntries(
                    Object.entries(process.env).filter(
                      (e): e is [string, string] => e[1] !== undefined,
                    ),
                  ),
                  ANTHROPIC_API_KEY: opts.apiKey,
                },
              }
            : {}),
          abortController: this.abortController,
        },
      });

      let result = "";
      let isError = false;

      for await (const message of stream) {
        if (logStream) logStream.write(JSON.stringify(message) + "\n");
        if (message.type === "result") {
          if (message.subtype === "success") {
            result = message.result;
          } else {
            isError = true;
            result = message.errors.join("\n");
          }
        }
      }

      return { code: isError ? 1 : 0, stdout: result };
    } catch (err) {
      if (this.abortController?.signal.aborted) {
        return { code: 1, stdout: "TIMEOUT: Claude execution timed out" };
      }
      const msg = err instanceof Error ? err.message : String(err);
      return { code: 1, stdout: `Error: ${msg}` };
    } finally {
      clearTimeout(timeoutId);
      this.abortController = null;
      logStream?.end();
    }
  }

  writeLog(prefix: string, id: string, content: string): string {
    const path = join(this.logDir, `${prefix}-${id}.log`);
    writeFileSync(path, content);
    return path;
  }
}
