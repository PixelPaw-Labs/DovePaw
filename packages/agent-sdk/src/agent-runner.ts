import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ClaudeRunner, type RunOpts } from "./claude-runner.js";
import { CodexRunner, type CodexRunOpts } from "./codex-runner.js";
import type { WebSearchMode, SandboxMode, CodexOptions } from "@openai/codex-sdk";

interface ClaudeRunOpts {
  permissionMode?: string;
  worktree?: string;
  sessionId?: string;
  agent?: string;
  effort?: string;
  continueSession?: boolean;
}

interface CodexOpts {
  agentRoster?: string;
  config?: CodexOptions["config"];
  skipGitRepoCheck?: boolean;
  webSearchEnabled?: boolean;
  webSearchMode?: WebSearchMode;
  sandboxMode?: SandboxMode;
}

/** Union of all opts supported across runners. Claude-specific fields are ignored for Codex and vice versa. */
export interface AgentRunOpts {
  cwd: string;
  taskName: string;
  timeoutMs?: number;
  /** Model to use. Reads AGENT_SCRIPT_MODEL env var if absent. GPT/codex IDs → CodexRunner; anything else → ClaudeRunner. */
  model?: string;
  /** Extra directories to expose to the agent. Mapped to `repos` for Claude, `additionalDirectories` for Codex. */
  additionalDirectories?: string[];
  /** API key override. Mapped to ANTHROPIC_API_KEY for Claude, apiKey for Codex. */
  apiKey?: string;
  /** Resume a prior session. Uses --resume for Claude, resumeThread() for Codex. */
  resumeSession?: string;
  claudeOpts?: ClaudeRunOpts;
  codexOpts?: CodexOpts;
  /** Called when Codex is the active runner. Return value replaces the prompt sent to Codex. */
  onCodexPrompt?: (prompt: string) => string;
}

function isCodexModel(model: string): boolean {
  const m = model.toLowerCase().trim();
  return m === "codex" || m.startsWith("gpt");
}

function isClaudeModel(model: string): boolean {
  const m = model.toLowerCase().trim();
  return m === "" || m === "claude" || m.startsWith("claude");
}

/**
 * Unified agent runner. Delegates to ClaudeRunner or CodexRunner based on the
 * effective model: opts.model → AGENT_SCRIPT_MODEL env var → default (ClaudeRunner).
 */
export class AgentRunner {
  constructor(
    private readonly logDir: string,
    private readonly logFile?: string,
  ) {}

  async run(prompt: string, opts: AgentRunOpts): Promise<{ code: number; stdout: string }> {
    const model = opts.model ?? (process.env.AGENT_SCRIPT_MODEL ?? "").trim();
    if (isCodexModel(model)) {
      const codexPrompt = opts.onCodexPrompt ? opts.onCodexPrompt(prompt) : prompt;
      return new CodexRunner(this.logDir).run(codexPrompt, {
        cwd: opts.cwd,
        taskName: opts.taskName,
        timeoutMs: opts.timeoutMs,
        ...(model !== "codex" ? { model } : {}),
        apiKey: opts.apiKey,
        additionalDirectories: opts.additionalDirectories,
        resumeSession: opts.resumeSession,
        agentRoster: opts.codexOpts?.agentRoster,
        config: opts.codexOpts?.config,
        skipGitRepoCheck: opts.codexOpts?.skipGitRepoCheck,
        webSearchEnabled: opts.codexOpts?.webSearchEnabled,
        webSearchMode: opts.codexOpts?.webSearchMode,
        sandboxMode: opts.codexOpts?.sandboxMode,
      } satisfies CodexRunOpts);
    }
    if (!isClaudeModel(model)) {
      throw new Error(`Unknown model: "${model}". Expected a Claude or Codex model identifier.`);
    }
    return new ClaudeRunner(this.logDir, this.logFile ?? "").run(prompt, {
      cwd: opts.cwd,
      taskName: opts.taskName,
      timeoutMs: opts.timeoutMs,
      ...(model && model !== "claude" ? { model } : {}),
      repos: opts.additionalDirectories,
      apiKey: opts.apiKey,
      permissionMode: opts.claudeOpts?.permissionMode,
      worktree: opts.claudeOpts?.worktree,
      sessionId: opts.claudeOpts?.sessionId,
      resumeSession: opts.resumeSession,
      agent: opts.claudeOpts?.agent,
      effort: opts.claudeOpts?.effort,
      continueSession: opts.claudeOpts?.continueSession,
    } satisfies RunOpts);
  }

  writeLog(prefix: string, id: string, content: string): string {
    const path = join(this.logDir, `${prefix}-${id}.log`);
    writeFileSync(path, content);
    return path;
  }
}
