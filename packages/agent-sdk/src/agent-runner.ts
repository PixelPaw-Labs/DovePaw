import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ClaudeRunner, type RunOpts } from "./claude-runner.js";
import { CodexRunner, type CodexRunOpts } from "./codex-runner.js";
import type { WebSearchMode, SandboxMode, CodexOptions, ApprovalMode } from "@openai/codex-sdk";
import type {
  HookEvent,
  HookCallbackMatcher,
  PreToolUseHookSpecificOutput,
} from "@anthropic-ai/claude-agent-sdk";
import { bashHasWriteOperation, getSecurityModeStrategy } from "./security-policy.js";

interface ClaudeRunOpts {
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk" | "auto";
  disallowedTools?: string[];
  worktree?: string;
  sessionId?: string;
  agent?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  continueSession?: boolean;
  settingSources?: Array<"user" | "project" | "local">;
}

export function resolveCodexSandboxMode(
  codexOpts: CodexOpts | undefined,
  env: Record<string, string | undefined> = process.env,
): SandboxMode | undefined {
  if (env.DOVEPAW_SECURITY_MODE === "read-only") return "read-only";
  return codexOpts?.sandboxMode;
}

export function resolveCodexWebSearchEnabled(
  codexOpts: CodexOpts | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.DOVEPAW_ALLOW_WEB_TOOLS === "1") return true;
  return codexOpts?.webSearchEnabled ?? false;
}

export function resolveCodexApprovalPolicy(
  env: Record<string, string | undefined> = process.env,
): ApprovalMode {
  // read-only / supervised: "on-request" lets Codex operate within the sandbox freely
  // and ask only when crossing the boundary (write ops). "never" would skip all prompts,
  // defeating the security constraint. autonomous has no restrictions → "never".
  const mode = env.DOVEPAW_SECURITY_MODE;
  if (mode === "read-only" || mode === "supervised") return "on-request";
  return "never";
}

export function resolveClaudeSecurityOpts(
  claudeOpts: ClaudeRunOpts | undefined,
  env: Record<string, string | undefined> = process.env,
): {
  permissionMode: ClaudeRunOpts["permissionMode"];
  disallowedTools: string[];
  hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
} {
  const envMode = env.DOVEPAW_SECURITY_MODE;
  const strategy =
    envMode === "read-only" || envMode === "supervised" || envMode === "autonomous"
      ? getSecurityModeStrategy(envMode)
      : null;

  const permissionMode = strategy?.permissionMode ?? claudeOpts?.permissionMode;
  const modeTools = strategy?.disallowedTools ?? [];
  const webTools = env.DOVEPAW_ALLOW_WEB_TOOLS === "1" ? [] : ["WebFetch", "WebSearch"];
  const disallowedTools = [...modeTools, ...webTools, ...(claudeOpts?.disallowedTools ?? [])];

  const hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {};
  if (strategy?.readOnly) {
    hooks.PreToolUse = [
      {
        matcher: "Bash",
        hooks: [
          async (input) => {
            if (input.hook_event_name !== "PreToolUse") return { continue: true };
            if (typeof input.tool_input !== "object" || input.tool_input === null)
              return { continue: true };
            const rawCommand: unknown = Reflect.get(input.tool_input, "command");
            const command = typeof rawCommand === "string" ? rawCommand : "";
            if (!bashHasWriteOperation(command)) return { continue: true };
            const hookSpecificOutput: PreToolUseHookSpecificOutput = {
              hookEventName: "PreToolUse",
              permissionDecision: "deny",
              permissionDecisionReason: "Read-only mode: Bash write operations are not allowed.",
            };
            return { hookSpecificOutput };
          },
        ],
      },
    ];
  }

  return { permissionMode, disallowedTools, hooks };
}

interface CodexOpts {
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
  /** Additional instructions appended to the system prompt (claude_code preset append / Codex developer_instructions). */
  appendSystemPrompt?: string;
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
        appendSystemPrompt: opts.appendSystemPrompt,
        config: opts.codexOpts?.config,
        skipGitRepoCheck: opts.codexOpts?.skipGitRepoCheck,
        webSearchMode: opts.codexOpts?.webSearchMode,
        sandboxMode: resolveCodexSandboxMode(opts.codexOpts),
        approvalPolicy: resolveCodexApprovalPolicy(),
        webSearchEnabled: resolveCodexWebSearchEnabled(opts.codexOpts),
      } satisfies CodexRunOpts);
    }
    if (!isClaudeModel(model)) {
      throw new Error(`Unknown model: "${model}". Expected a Claude or Codex model identifier.`);
    }
    const { permissionMode, disallowedTools, hooks } = resolveClaudeSecurityOpts(opts.claudeOpts);
    return new ClaudeRunner(this.logDir, this.logFile ?? "").run(prompt, {
      cwd: opts.cwd,
      taskName: opts.taskName,
      timeoutMs: opts.timeoutMs,
      ...(model && model !== "claude" ? { model } : {}),
      repos: opts.additionalDirectories,
      apiKey: opts.apiKey,
      permissionMode,
      ...(disallowedTools.length > 0 ? { disallowedTools } : {}),
      ...(Object.keys(hooks).length > 0 ? { hooks } : {}),
      worktree: opts.claudeOpts?.worktree,
      sessionId: opts.claudeOpts?.sessionId,
      resumeSession: opts.resumeSession,
      agent: opts.claudeOpts?.agent,
      effort: opts.claudeOpts?.effort,
      continueSession: opts.claudeOpts?.continueSession,
      settingSources: opts.claudeOpts?.settingSources,
      appendSystemPrompt: opts.appendSystemPrompt,
    } satisfies RunOpts);
  }

  writeLog(prefix: string, id: string, content: string): string {
    const path = join(this.logDir, `${prefix}-${id}.log`);
    writeFileSync(path, content);
    return path;
  }
}
