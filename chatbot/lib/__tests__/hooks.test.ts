import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAgentHooks,
  buildDoveCanUseTool,
  buildDoveHooks,
  buildSubagentCanUseTool,
} from "../hooks";
import { buildSubAgentHooks, GROUP_PROMPT_REMINDER } from "../subagent-hooks";
import { SUBAGENT_PROMPT_REMINDER } from "@@/lib/subagent-reminder";
import { DOVE_RESPONSE_REMINDER } from "@@/lib/dove-lean-reminder";
import { PendingRegistry } from "../pending-registry";
import { resolvePendingPermission } from "../pending-permissions";
import { resolvePendingQuestion } from "../pending-questions";
import type { ChatSseEvent, ChatSsePermission, ChatSseQuestion } from "../chat-sse";

const signal = new AbortController().signal;
const callHook = (fn: Function, input: unknown) => fn(input, undefined, { signal });

function makeConfig(overrides?: {
  registry?: PendingRegistry;
  userPromptReminder?: string;
  allowedDirectories?: string[];
}) {
  return {
    postToolUseMatcher: "test_tool",
    registry: overrides?.registry ?? new PendingRegistry(),
    userPromptReminder: overrides?.userPromptReminder,
    allowedDirectories: overrides?.allowedDirectories,
  };
}

function makeRegistry(entries: { awaitTool: string; idKey: string; id: string }[] = []) {
  const r = new PendingRegistry();
  for (const e of entries) r.register(e);
  return r;
}

function preToolUseInput(toolName: string, toolInput: unknown) {
  return {
    hook_event_name: "PreToolUse" as const,
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: "tu-1",
  };
}

function stopInput(overrides?: { stop_hook_active?: boolean; last_assistant_message?: string }) {
  return {
    hook_event_name: "Stop" as const,
    stop_reason: "end_turn" as const,
    stop_hook_active: overrides?.stop_hook_active ?? false,
    ...(overrides?.last_assistant_message !== undefined && {
      last_assistant_message: overrides.last_assistant_message,
    }),
  };
}

function postToolUseInput(structuredContent: unknown) {
  return {
    hook_event_name: "PostToolUse" as const,
    tool_name: "test_tool",
    tool_input: {},
    tool_response: { structuredContent },
  };
}

describe("buildAgentHooks — Stop hook", () => {
  it("allows stop when no pending work", async () => {
    const hooks = buildAgentHooks(makeConfig());
    const fn = hooks.Stop![0]!.hooks[0]!;
    const result = await callHook(fn, stopInput());
    expect(result).toEqual({ continue: true });
  });

  it("blocks stop even when stop_hook_active while pending work exists", async () => {
    const hooks = buildAgentHooks(
      makeConfig({
        registry: makeRegistry([{ awaitTool: "await_run_script", idKey: "runId", id: "abc" }]),
      }),
    );
    const fn = hooks.Stop![0]!.hooks[0]!;
    const result = await callHook(fn, stopInput({ stop_hook_active: true }));
    expect(result).toMatchObject({ decision: "block" });
  });

  it("blocks stop with per-tool instructions when pending work exists", async () => {
    const hooks = buildAgentHooks(
      makeConfig({
        registry: makeRegistry([{ awaitTool: "await_run_script", idKey: "runId", id: "abc-123" }]),
      }),
    );
    const fn = hooks.Stop![0]!.hooks[0]!;
    const result = await callHook(fn, stopInput());
    expect(result).toMatchObject({ decision: "block" });
    expect((result as { reason: string }).reason).toContain("await_run_script");
    expect((result as { reason: string }).reason).toContain("abc-123");
  });

  it("includes polling guidance in the Stop message", async () => {
    const hooks = buildAgentHooks(
      makeConfig({
        registry: makeRegistry([{ awaitTool: "await_run_script", idKey: "runId", id: "abc-123" }]),
      }),
    );
    const fn = hooks.Stop![0]!.hooks[0]!;
    const result = (await callHook(fn, stopInput())) as { reason: string };
    expect(result.reason).toContain("minutes to hours");
    expect(result.reason).toContain("Never give up or stop polling");
  });

  it("lists all pending entries as bullets in the Stop message", async () => {
    const hooks = buildAgentHooks(
      makeConfig({
        registry: makeRegistry([
          { awaitTool: "await_run_script", idKey: "runId", id: "id-1" },
          { awaitTool: "await_chat_to_fixer", idKey: "taskId", id: "id-2" },
        ]),
      }),
    );
    const fn = hooks.Stop![0]!.hooks[0]!;
    const result = (await callHook(fn, stopInput())) as { reason: string };
    expect(result.reason).toContain('- call `await_run_script` with runId: "id-1"');
    expect(result.reason).toContain('- call `await_chat_to_fixer` with taskId: "id-2"');
  });
});

describe("buildAgentHooks — PostToolUse hook", () => {
  it("passes through non-still_running responses", async () => {
    const hooks = buildAgentHooks(makeConfig());
    const fn = hooks.PostToolUse![0]!.hooks[0]!;
    const result = await callHook(fn, postToolUseInput({ status: "complete", data: "done" }));
    expect(result).toEqual({ continue: true });
  });

  it("blocks with pending-entry reason on still_running", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // max = 10, won't release on first call
    const hooks = buildAgentHooks(
      makeConfig({
        registry: makeRegistry([{ awaitTool: "await_run_script", idKey: "runId", id: "run-xyz" }]),
      }),
    );
    const fn = hooks.PostToolUse![0]!.hooks[0]!;
    const result = await callHook(fn, postToolUseInput({ status: "still_running" }));
    const { decision, reason } = result as { decision: string; reason: string };
    expect(decision).toBe("block");
    expect(reason).toContain("await_run_script");
    expect(reason).toContain("run-xyz");
    vi.restoreAllMocks();
  });

  it("includes no-memory guidance in still_running block reason", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const hooks = buildAgentHooks(
      makeConfig({
        registry: makeRegistry([{ awaitTool: "await_run_script", idKey: "runId", id: "run-xyz" }]),
      }),
    );
    const fn = hooks.PostToolUse![0]!.hooks[0]!;
    const result = await callHook(fn, postToolUseInput({ status: "still_running" }));
    const { reason } = result as { reason: string };
    expect(reason).toContain("Never recall any previous run from log or memory");
    vi.restoreAllMocks();
  });
});

describe("buildAgentHooks — PreToolUse ScheduleWakeup guard (index 0)", () => {
  it("is always present even without allowedDirectories", () => {
    const hooks = buildAgentHooks(makeConfig());
    expect(hooks.PreToolUse).toHaveLength(1);
    expect(hooks.PreToolUse![0]!.matcher).toBe("ScheduleWakeup");
  });

  it("allows ScheduleWakeup when no pending work", async () => {
    const hooks = buildAgentHooks(makeConfig());
    const fn = hooks.PreToolUse![0]!.hooks[0]!;
    const result = await callHook(fn, preToolUseInput("ScheduleWakeup", { delaySeconds: 90 }));
    expect(result).toEqual({ continue: true });
  });

  it("denies ScheduleWakeup when pending work exists", async () => {
    const hooks = buildAgentHooks(
      makeConfig({
        registry: makeRegistry([{ awaitTool: "await_run_script", idKey: "runId", id: "abc-123" }]),
      }),
    );
    const fn = hooks.PreToolUse![0]!.hooks[0]!;
    const result = await callHook(fn, preToolUseInput("ScheduleWakeup", { delaySeconds: 90 }));
    const { hookSpecificOutput } = result as {
      hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string };
    };
    expect(hookSpecificOutput.permissionDecision).toBe("deny");
    expect(hookSpecificOutput.permissionDecisionReason).toContain("wakeup will not fire");
    expect(hookSpecificOutput.permissionDecisionReason).toContain("await_run_script");
    expect(hookSpecificOutput.permissionDecisionReason).toContain("abc-123");
  });

  it("passes through non-PreToolUse events", async () => {
    const hooks = buildAgentHooks(
      makeConfig({
        registry: makeRegistry([{ awaitTool: "await_run_script", idKey: "runId", id: "x" }]),
      }),
    );
    const fn = hooks.PreToolUse![0]!.hooks[0]!;
    const result = await callHook(fn, { hook_event_name: "Stop" });
    expect(result).toEqual({ continue: true });
  });
});

describe("buildAgentHooks — PreToolUse Edit|Write guard (index 1)", () => {
  it("is absent when allowedDirectories is not set", () => {
    const hooks = buildAgentHooks(makeConfig());
    // Only ScheduleWakeup guard — no Edit|Write entry
    expect(hooks.PreToolUse).toHaveLength(1);
  });

  it("is absent when allowedDirectories is empty", () => {
    const hooks = buildAgentHooks(makeConfig({ allowedDirectories: [] }));
    expect(hooks.PreToolUse).toHaveLength(1);
  });

  it("has matcher Edit|Write at index 1", () => {
    const hooks = buildAgentHooks(makeConfig({ allowedDirectories: ["/tmp"] }));
    expect(hooks.PreToolUse![1]!.matcher).toBe("Edit|Write");
  });

  it("allows when file_path is directly inside an allowed directory", async () => {
    const hooks = buildAgentHooks(makeConfig({ allowedDirectories: ["/tmp/workspace"] }));
    const fn = hooks.PreToolUse![1]!.hooks[0]!;
    const result = await callHook(
      fn,
      preToolUseInput("Edit", { file_path: "/tmp/workspace/foo.ts" }),
    );
    const { hookSpecificOutput } = result as { hookSpecificOutput: { permissionDecision: string } };
    expect(hookSpecificOutput.permissionDecision).toBe("allow");
  });

  it("allows when file_path equals an allowed directory exactly", async () => {
    const hooks = buildAgentHooks(makeConfig({ allowedDirectories: ["/tmp/workspace"] }));
    const fn = hooks.PreToolUse![1]!.hooks[0]!;
    const result = await callHook(fn, preToolUseInput("Edit", { file_path: "/tmp/workspace" }));
    const { hookSpecificOutput } = result as { hookSpecificOutput: { permissionDecision: string } };
    expect(hookSpecificOutput.permissionDecision).toBe("allow");
  });

  it("allows when file_path is nested deeply inside an allowed directory", async () => {
    const hooks = buildAgentHooks(makeConfig({ allowedDirectories: ["/tmp/workspace"] }));
    const fn = hooks.PreToolUse![1]!.hooks[0]!;
    const result = await callHook(
      fn,
      preToolUseInput("Write", { file_path: "/tmp/workspace/a/b/c.ts" }),
    );
    const { hookSpecificOutput } = result as { hookSpecificOutput: { permissionDecision: string } };
    expect(hookSpecificOutput.permissionDecision).toBe("allow");
  });

  it("allows when file_path is inside any one of multiple allowed directories", async () => {
    const hooks = buildAgentHooks(
      makeConfig({ allowedDirectories: ["/tmp/workspace", "/home/agents/logs"] }),
    );
    const fn = hooks.PreToolUse![1]!.hooks[0]!;
    const result = await callHook(
      fn,
      preToolUseInput("Edit", { file_path: "/home/agents/logs/out.log" }),
    );
    const { hookSpecificOutput } = result as { hookSpecificOutput: { permissionDecision: string } };
    expect(hookSpecificOutput.permissionDecision).toBe("allow");
  });

  it("denies when file_path is outside all allowed directories", async () => {
    const hooks = buildAgentHooks(makeConfig({ allowedDirectories: ["/tmp/workspace"] }));
    const fn = hooks.PreToolUse![1]!.hooks[0]!;
    const result = await callHook(fn, preToolUseInput("Edit", { file_path: "/etc/passwd" }));
    const { hookSpecificOutput } = result as {
      hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string };
    };
    expect(hookSpecificOutput.permissionDecision).toBe("deny");
    expect(hookSpecificOutput.permissionDecisionReason).toContain("/etc/passwd");
    expect(hookSpecificOutput.permissionDecisionReason).toContain("/tmp/workspace");
  });

  it("denies a path that shares a prefix but is not a subpath", async () => {
    const hooks = buildAgentHooks(makeConfig({ allowedDirectories: ["/tmp/work"] }));
    const fn = hooks.PreToolUse![1]!.hooks[0]!;
    // /tmp/workspace starts with /tmp/work but is NOT inside /tmp/work/
    const result = await callHook(
      fn,
      preToolUseInput("Write", { file_path: "/tmp/workspace/secret.ts" }),
    );
    const { hookSpecificOutput } = result as { hookSpecificOutput: { permissionDecision: string } };
    expect(hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("passes through when tool_input has no file_path", async () => {
    const hooks = buildAgentHooks(makeConfig({ allowedDirectories: ["/tmp/workspace"] }));
    const fn = hooks.PreToolUse![1]!.hooks[0]!;
    const result = await callHook(fn, preToolUseInput("Edit", { content: "hello" }));
    expect(result).toEqual({ continue: true });
  });

  it("passes through when tool_input is not an object", async () => {
    const hooks = buildAgentHooks(makeConfig({ allowedDirectories: ["/tmp/workspace"] }));
    const fn = hooks.PreToolUse![1]!.hooks[0]!;
    const result = await callHook(fn, preToolUseInput("Edit", null));
    expect(result).toEqual({ continue: true });
  });

  it("passes through non-PreToolUse events", async () => {
    const hooks = buildAgentHooks(makeConfig({ allowedDirectories: ["/tmp/workspace"] }));
    const fn = hooks.PreToolUse![1]!.hooks[0]!;
    const result = await callHook(fn, { hook_event_name: "Stop" });
    expect(result).toEqual({ continue: true });
  });
});

describe("buildAgentHooks — UserPromptSubmit hook", () => {
  it("is absent when userPromptReminder is not set", () => {
    const hooks = buildAgentHooks(makeConfig());
    expect(hooks.UserPromptSubmit).toBeUndefined();
  });

  it("appends reminder as additionalContext", async () => {
    const hooks = buildAgentHooks(makeConfig({ userPromptReminder: "my reminder" }));
    const fn = hooks.UserPromptSubmit![0]!.hooks[0]!;
    const result = await callHook(fn, {
      hook_event_name: "UserPromptSubmit",
      prompt: "hello",
    });
    const { hookSpecificOutput } = result as { hookSpecificOutput: { additionalContext: string } };
    expect(hookSpecificOutput.additionalContext).toBe("my reminder");
  });

  it("passes through non-UserPromptSubmit events", async () => {
    const hooks = buildAgentHooks(makeConfig({ userPromptReminder: "reminder" }));
    const fn = hooks.UserPromptSubmit![0]!.hooks[0]!;
    const result = await callHook(fn, { hook_event_name: "Stop" });
    expect(result).toEqual({ continue: true });
  });
});

// ─── buildDoveHooks — allowed directories ─────────────────────────────────────

describe("buildDoveHooks — PreToolUse allowed directories", () => {
  const cwd = "/repo/dovepaw";
  const tmpDir = "/home/user/.dovepaw/tmp";

  function getPreToolUseHook() {
    const hooks = buildDoveHooks([], new PendingRegistry(), cwd, [tmpDir]);
    // index 0 = ScheduleWakeup guard, index 1 = Edit|Write directory guard
    return hooks.PreToolUse![1]!.hooks[0]!;
  }

  it("allows writes inside cwd", async () => {
    const fn = getPreToolUseHook();
    const result = await callHook(fn, preToolUseInput("Write", { file_path: `${cwd}/src/foo.ts` }));
    const { hookSpecificOutput } = result as { hookSpecificOutput: { permissionDecision: string } };
    expect(hookSpecificOutput.permissionDecision).toBe("allow");
  });

  it("allows writes inside an additional directory (e.g. tmp agent files)", async () => {
    const fn = getPreToolUseHook();
    const result = await callHook(
      fn,
      preToolUseInput("Write", { file_path: `${tmpDir}/vibe-checker/main.ts` }),
    );
    const { hookSpecificOutput } = result as { hookSpecificOutput: { permissionDecision: string } };
    expect(hookSpecificOutput.permissionDecision).toBe("allow");
  });

  it("denies writes outside all allowed directories", async () => {
    const fn = getPreToolUseHook();
    const result = await callHook(fn, preToolUseInput("Write", { file_path: "/etc/passwd" }));
    const { hookSpecificOutput } = result as { hookSpecificOutput: { permissionDecision: string } };
    expect(hookSpecificOutput.permissionDecision).toBe("deny");
  });
});

// ─── buildDoveHooks — PostToolUse await_* response reminder ──────────────────

describe("buildDoveHooks — PostToolUse await_* response reminder", () => {
  const minimalAgents = [
    {
      name: "support-agent",
      manifestKey: "support_agent",
      toolName: "yolo_support_agent",
    },
  ] as Parameters<typeof buildDoveHooks>[0];

  function awaitInput(status: string) {
    return {
      hook_event_name: "PostToolUse" as const,
      tool_name: "mcp__agents__await_support_agent",
      tool_input: {},
      tool_response: JSON.stringify({ status }),
    };
  }

  it("injects DOVE_RESPONSE_REMINDER as additionalContext when status is completed", async () => {
    const hooks = buildDoveHooks(minimalAgents, makeRegistry(), "/cwd", []);
    const fn = hooks.PostToolUse![1]!.hooks[0]!;
    const result = await callHook(fn, awaitInput("completed"));
    const { hookSpecificOutput } = result as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(hookSpecificOutput.hookEventName).toBe("PostToolUse");
    expect(hookSpecificOutput.additionalContext).toContain(DOVE_RESPONSE_REMINDER);
  });

  it("passes through when status is not completed", async () => {
    const hooks = buildDoveHooks(minimalAgents, makeRegistry(), "/cwd", []);
    const fn = hooks.PostToolUse![1]!.hooks[0]!;
    const result = await callHook(fn, awaitInput("still_running"));
    expect(result).toEqual({ continue: true });
  });
});

// ─── buildSubAgentHooks — self-reflection gate ────────────────────────────────

describe("buildSubAgentHooks — chat_to reflection gate", () => {
  function getReflectionHook() {
    const hooks = buildSubAgentHooks(
      "/cwd",
      [],
      [{ name: "chat_to_fixer", description: "Send a message to Fixer." }],
      makeRegistry(),
      "test_agent",
    );
    // The reflection matcher is the last PreToolUse matcher
    const matchers = hooks.PreToolUse!;
    const reflectionMatcher = matchers[matchers.length - 1]!;
    return reflectionMatcher.hooks[0]!;
  }

  function chatToInput(toolInput: unknown) {
    return {
      hook_event_name: "PreToolUse" as const,
      tool_name: "mcp__agents__chat_to_fixer",
      tool_input: toolInput,
      tool_use_id: "tu-1",
    };
  }

  function justification(overrides: Record<string, unknown> = {}) {
    return {
      impact: "medium",
      pattern: "Detection → Resolution",
      handoff: "3 errors found",
      confidence: 0.9,
      ...overrides,
    };
  }

  it("denies when justification is absent", async () => {
    const fn = getReflectionHook();
    const result = await callHook(fn, chatToInput({ instruction: "fix it" }));
    expect(result.hookSpecificOutput?.permissionDecision).toBe("deny");
  });

  it("denies when justification is not an object", async () => {
    const fn = getReflectionHook();
    const result = await callHook(
      fn,
      chatToInput({ instruction: "fix it", justification: "some string" }),
    );
    expect(result.hookSpecificOutput?.permissionDecision).toBe("deny");
  });

  it("denies when confidence is missing", async () => {
    const fn = getReflectionHook();
    const result = await callHook(
      fn,
      chatToInput({
        instruction: "fix it",
        justification: justification({ confidence: undefined }),
      }),
    );
    expect(result.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(result.hookSpecificOutput?.permissionDecisionReason).toContain("confidence");
  });

  it("denies when impact is missing", async () => {
    const fn = getReflectionHook();
    const result = await callHook(
      fn,
      chatToInput({ instruction: "fix it", justification: justification({ impact: undefined }) }),
    );
    expect(result.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(result.hookSpecificOutput?.permissionDecisionReason).toContain("impact");
  });

  it("denies when impact is invalid", async () => {
    const fn = getReflectionHook();
    const result = await callHook(
      fn,
      chatToInput({ instruction: "fix it", justification: justification({ impact: "critical" }) }),
    );
    expect(result.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(result.hookSpecificOutput?.permissionDecisionReason).toContain("impact");
  });

  it("always denies low impact regardless of confidence", async () => {
    const fn = getReflectionHook();
    const result = await callHook(
      fn,
      chatToInput({
        instruction: "fix it",
        justification: justification({ impact: "low", confidence: 1 }),
      }),
    );
    expect(result.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(result.hookSpecificOutput?.permissionDecisionReason).toContain("Low-impact");
  });

  it("denies high impact when confidence is below 0.7", async () => {
    const fn = getReflectionHook();
    const result = await callHook(
      fn,
      chatToInput({
        instruction: "fix it",
        justification: justification({ impact: "high", confidence: 0.69 }),
      }),
    );
    expect(result.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(result.hookSpecificOutput?.permissionDecisionReason).toContain("0.69");
  });

  it("allows high impact when confidence meets 0.7", async () => {
    const fn = getReflectionHook();
    const result = await callHook(
      fn,
      chatToInput({
        instruction: "fix it",
        justification: justification({ impact: "high", confidence: 0.7 }),
      }),
    );
    expect(result.hookSpecificOutput?.permissionDecision).toBe("allow");
  });

  it("denies medium impact when confidence is below 0.85", async () => {
    const fn = getReflectionHook();
    const result = await callHook(
      fn,
      chatToInput({
        instruction: "fix it",
        justification: justification({ impact: "medium", confidence: 0.84 }),
      }),
    );
    expect(result.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(result.hookSpecificOutput?.permissionDecisionReason).toContain("0.84");
  });

  it("allows medium impact when confidence meets 0.85", async () => {
    const fn = getReflectionHook();
    const result = await callHook(
      fn,
      chatToInput({
        instruction: "fix it",
        justification: justification({ impact: "medium", confidence: 0.85 }),
      }),
    );
    expect(result.hookSpecificOutput?.permissionDecision).toBe("allow");
  });

  it("allows medium impact when confidence exceeds threshold", async () => {
    const fn = getReflectionHook();
    const result = await callHook(
      fn,
      chatToInput({
        instruction: "fix it",
        justification: justification({ impact: "medium", confidence: 0.98 }),
      }),
    );
    expect(result.hookSpecificOutput?.permissionDecision).toBe("allow");
  });
});

// ─── buildSubAgentHooks — UserPromptSubmit reminder ──────────────────────────

describe("buildSubAgentHooks — UserPromptSubmit reminder", () => {
  it("always injects SUBAGENT_PROMPT_REMINDER even without behaviorReminder", async () => {
    const hooks = buildSubAgentHooks("/cwd", [], [], makeRegistry(), "test_agent");
    const fn = hooks.UserPromptSubmit![0]!.hooks[0]!;
    const result = await callHook(fn, { hook_event_name: "UserPromptSubmit", prompt: "do it" });
    const { hookSpecificOutput } = result as { hookSpecificOutput: { additionalContext: string } };
    expect(hookSpecificOutput.additionalContext).toContain("SOMETHING BEING DONE");
    expect(hookSpecificOutput.additionalContext).toContain("ALWAYS START yourself first");
  });

  it("always injects SUBAGENT_PROMPT_REMINDER when behaviorReminder is empty", async () => {
    const hooks = buildSubAgentHooks(
      "/cwd",
      [],
      [],
      makeRegistry(),
      "test_agent",
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      "",
    );
    const fn = hooks.UserPromptSubmit![0]!.hooks[0]!;
    const result = await callHook(fn, { hook_event_name: "UserPromptSubmit", prompt: "do it" });
    const { hookSpecificOutput } = result as { hookSpecificOutput: { additionalContext: string } };
    expect(hookSpecificOutput.additionalContext).toContain("SOMETHING BEING DONE");
    expect(hookSpecificOutput.additionalContext).toContain("ALWAYS START yourself first");
  });

  it("injects SUBAGENT_PROMPT_REMINDER with behaviorReminder inside <reminder> tag", async () => {
    const hooks = buildSubAgentHooks(
      "/cwd",
      [],
      [],
      makeRegistry(),
      "test_agent",
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      "Check memory before MCP tools.",
    );
    const fn = hooks.UserPromptSubmit![0]!.hooks[0]!;
    const result = await callHook(fn, { hook_event_name: "UserPromptSubmit", prompt: "do it" });
    const { hookSpecificOutput } = result as { hookSpecificOutput: { additionalContext: string } };
    expect(hookSpecificOutput.additionalContext).toContain("ALWAYS START yourself first");
    expect(hookSpecificOutput.additionalContext).toContain("Check memory before MCP tools.");
    expect(
      hookSpecificOutput.additionalContext.indexOf("ALWAYS START yourself first"),
    ).toBeLessThan(hookSpecificOutput.additionalContext.indexOf("Check memory before MCP tools."));
  });
});

describe("buildSubAgentHooks — reflection gate (group mode)", () => {
  function getGroupReflectionHook() {
    const hooks = buildSubAgentHooks(
      "/cwd",
      [],
      [{ name: "chat_to_fixer", description: "Send a message to Fixer." }],
      makeRegistry(),
      "test_agent",
      undefined,
      undefined,
      undefined,
      true,
    );
    const matchers = hooks.PreToolUse!;
    const reflectionMatcher = matchers[matchers.length - 1]!;
    return reflectionMatcher.hooks[0]!;
  }

  it("includes DO NOT output rule in denial reason when in group mode", async () => {
    const fn = getGroupReflectionHook();
    const result = await callHook(fn, {
      hook_event_name: "PreToolUse" as const,
      tool_name: "mcp__agents__chat_to_fixer",
      tool_input: { instruction: "fix it" },
      tool_use_id: "tu-1",
    });
    expect(result.hookSpecificOutput?.permissionDecisionReason).toMatch(/DO NOT output/i);
  });

  it("does not include DO NOT output rule when not in group mode", async () => {
    const hooks = buildSubAgentHooks(
      "/cwd",
      [],
      [{ name: "chat_to_fixer", description: "Send a message to Fixer." }],
      makeRegistry(),
      "test_agent",
    );
    const matchers = hooks.PreToolUse!;
    const fn = matchers[matchers.length - 1]!.hooks[0]!;
    const result = await callHook(fn, {
      hook_event_name: "PreToolUse" as const,
      tool_name: "mcp__agents__chat_to_fixer",
      tool_input: { instruction: "fix it" },
      tool_use_id: "tu-1",
    });
    expect(result.hookSpecificOutput?.permissionDecisionReason).not.toMatch(/DO NOT output/i);
  });
});

describe("buildSubAgentHooks — UserPromptSubmit reminder (group mode)", () => {
  it("injects GROUP_PROMPT_REMINDER instead of SUBAGENT_PROMPT_REMINDER", async () => {
    const hooks = buildSubAgentHooks(
      "/cwd",
      [],
      [],
      makeRegistry(),
      "test_agent",
      undefined,
      undefined,
      undefined,
      true,
    );
    const fn = hooks.UserPromptSubmit![0]!.hooks[0]!;
    const result = await callHook(fn, {
      hook_event_name: "UserPromptSubmit",
      prompt: "do something",
    });
    const { hookSpecificOutput } = result as { hookSpecificOutput: { additionalContext: string } };
    expect(hookSpecificOutput.additionalContext).toBe(GROUP_PROMPT_REMINDER);
    expect(hookSpecificOutput.additionalContext).not.toBe(SUBAGENT_PROMPT_REMINDER);
  });

  it("GROUP_PROMPT_REMINDER suppresses narration", () => {
    expect(GROUP_PROMPT_REMINDER).toMatch(/DO NOT output/i);
  });
});

// ─── buildSubAgentHooks — handoff consideration stop hook ─────────────────────

describe("buildSubAgentHooks — handoff consideration stop hook", () => {
  function getHandoffStopHook(registry = makeRegistry()) {
    const hooks = buildSubAgentHooks(
      "/cwd",
      [],
      [{ name: "chat_to_fixer", description: "Send a message to Fixer." }],
      registry,
      "test_agent",
    );
    // The handoff hook is the last Stop matcher (base pending-work hook is first)
    const matchers = hooks.Stop!;
    return matchers[matchers.length - 1]!.hooks[0]!;
  }

  it("blocks on first stop with handoff reminder when registry is empty", async () => {
    const fn = getHandoffStopHook();
    const result = await callHook(fn, stopInput());
    expect(result).toMatchObject({ decision: "block" });
    expect((result as { reason: string }).reason).toContain("hand off");
  });

  it("allows on second stop when stop_hook_active is true", async () => {
    const fn = getHandoffStopHook();
    const result = await callHook(fn, stopInput({ stop_hook_active: true }));
    expect(result).toEqual({ continue: true });
  });

  it("allows when registry has pending entries (defers to base stop hook)", async () => {
    const registry = makeRegistry([{ awaitTool: "await_run_script", idKey: "runId", id: "run-1" }]);
    const fn = getHandoffStopHook(registry);
    const result = await callHook(fn, stopInput());
    expect(result).toEqual({ continue: true });
  });

  it("passes through non-Stop events", async () => {
    const fn = getHandoffStopHook();
    const result = await callHook(fn, {
      hook_event_name: "PreToolUse",
      tool_name: "foo",
      tool_input: {},
      tool_use_id: "t1",
    });
    expect(result).toEqual({ continue: true });
  });

  it("is absent when no agent link tools are provided", () => {
    const hooks = buildSubAgentHooks("/cwd", [], [], makeRegistry(), "test_agent");
    // Stop array should only contain the base pending-work hook, not the handoff hook
    expect(hooks.Stop).toHaveLength(1);
  });

  it("includes DO NOT output rule in block reason when in group mode", async () => {
    const hooks = buildSubAgentHooks(
      "/cwd",
      [],
      [{ name: "chat_to_fixer", description: "Send a message to Fixer." }],
      makeRegistry(),
      "test_agent",
      undefined,
      undefined,
      undefined,
      true,
    );
    const matchers = hooks.Stop!;
    const fn = matchers[matchers.length - 1]!.hooks[0]!;
    const result = await callHook(fn, stopInput());
    expect((result as { reason: string }).reason).toMatch(/DO NOT output/i);
  });

  it("does not include DO NOT output rule when not in group mode", async () => {
    const fn = getHandoffStopHook();
    const result = await callHook(fn, stopInput());
    expect((result as { reason: string }).reason).not.toMatch(/DO NOT output/i);
  });

  it("embeds last_assistant_message in block reason when not in group mode", async () => {
    const fn = getHandoffStopHook();
    const result = await callHook(
      fn,
      stopInput({ last_assistant_message: "Here are the results." }),
    );
    expect((result as { reason: string }).reason).toContain("Here are the results.");
  });

  it("uses empty string in block reason when last_assistant_message is absent", async () => {
    const fn = getHandoffStopHook();
    const result = await callHook(fn, stopInput());
    expect((result as { reason: string }).reason).toContain("respond with exactly:");
  });
});

// ─── buildSubAgentHooks — ask mode (no linked agent tools) ───────────────────

describe("buildSubAgentHooks — ask mode", () => {
  const LINK_TOOLS = [{ name: "chat_to_fixer", description: "Send a message to Fixer." }];

  it("has no Stop hook in ask mode even when link tools are provided", () => {
    const hooks = buildSubAgentHooks(
      "/cwd",
      [],
      LINK_TOOLS,
      makeRegistry(),
      "test_agent",
      undefined,
      undefined,
      undefined,
      false,
      true, // isAskMode
    );
    expect(hooks.Stop).toHaveLength(1); // only the base pending-work hook
  });

  it("has no reflection matchers in PreToolUse in ask mode", () => {
    const hooks = buildSubAgentHooks(
      "/cwd",
      [],
      LINK_TOOLS,
      makeRegistry(),
      "test_agent",
      undefined,
      undefined,
      undefined,
      false,
      true, // isAskMode
    );
    // In ask mode: only the base PreToolUse hooks (no reflection matchers for chat_to/etc.)
    const hooksWithoutAskMode = buildSubAgentHooks(
      "/cwd",
      [],
      LINK_TOOLS,
      makeRegistry(),
      "test_agent",
    );
    expect(hooks.PreToolUse!.length).toBeLessThan(hooksWithoutAskMode.PreToolUse!.length);
  });

  it("stop hook still fires in start mode (default) with link tools", async () => {
    const hooks = buildSubAgentHooks("/cwd", [], LINK_TOOLS, makeRegistry(), "test_agent");
    const matchers = hooks.Stop!;
    const fn = matchers[matchers.length - 1]!.hooks[0]!;
    const result = await callHook(fn, stopInput());
    expect(result).toMatchObject({ decision: "block" });
  });
});

// ─── buildSubAgentHooks — group handoff silence hooks ────────────────────────

function postToolUseByName(toolName: string) {
  return {
    hook_event_name: "PostToolUse" as const,
    tool_name: toolName,
    tool_input: {},
    tool_use_id: "tu-1",
    tool_response: "",
  };
}

describe("buildSubAgentHooks — group handoff silence hooks", () => {
  function getGroupPostToolUseHooks() {
    const hooks = buildSubAgentHooks(
      "/cwd",
      [],
      [],
      makeRegistry(),
      "test_agent",
      undefined,
      undefined,
      undefined,
      true,
    );
    // base hook is [0]; group hooks are appended after
    return hooks.PostToolUse!;
  }

  it("is absent when isGroupMode is false", () => {
    const hooks = buildSubAgentHooks("/cwd", [], [], makeRegistry(), "test_agent");
    // only the base still_running hook should be present
    expect(hooks.PostToolUse).toHaveLength(1);
  });

  it("injects additionalContext after start_* handoff tools", async () => {
    const matchers = getGroupPostToolUseHooks();
    // start matcher is second (index 1)
    const fn = matchers[1]!.hooks[0]!;
    const result = await callHook(fn, postToolUseByName("mcp__agents__start_chat_to_agent_b"));
    const { hookSpecificOutput } = result as { hookSpecificOutput: { additionalContext: string } };
    expect(hookSpecificOutput.additionalContext).toBeTruthy();
    expect(hookSpecificOutput.additionalContext).toContain("await");
    expect(hookSpecificOutput.additionalContext).toContain("Do NOT output");
    expect(hookSpecificOutput.additionalContext).toContain("narration");
  });

  it("injects additionalContext after await_* handoff tools", async () => {
    const matchers = getGroupPostToolUseHooks();
    // await matcher is third (index 2)
    const fn = matchers[2]!.hooks[0]!;
    const result = await callHook(fn, postToolUseByName("mcp__agents__await_chat_to_agent_b"));
    const { hookSpecificOutput } = result as { hookSpecificOutput: { additionalContext: string } };
    expect(hookSpecificOutput.additionalContext).toBeTruthy();
  });

  it("passes through non-PostToolUse events", async () => {
    const matchers = getGroupPostToolUseHooks();
    const fn = matchers[1]!.hooks[0]!;
    const result = await callHook(fn, {
      hook_event_name: "PreToolUse" as const,
      tool_name: "foo",
      tool_input: {},
      tool_use_id: "t1",
    });
    expect(result).toEqual({ continue: true });
  });
});

// ─── buildSubAgentHooks — group script await tone hook ───────────────────────

describe("buildSubAgentHooks — group script await tone hook", () => {
  function getGroupPostToolUseHooks() {
    const hooks = buildSubAgentHooks(
      "/cwd",
      [],
      [],
      makeRegistry(),
      "test_agent",
      undefined,
      undefined,
      undefined,
      true,
    );
    return hooks.PostToolUse!;
  }

  it("is at index 3 in group mode (after base, start-silence, await-silence)", () => {
    const matchers = getGroupPostToolUseHooks();
    expect(matchers).toHaveLength(4);
  });

  it("injects tone additionalContext after await_test_agent completes", async () => {
    const matchers = getGroupPostToolUseHooks();
    const fn = matchers[3]!.hooks[0]!;
    const result = await callHook(fn, postToolUseByName("mcp__agents__await_test_agent"));
    const { hookSpecificOutput } = result as { hookSpecificOutput: { additionalContext: string } };
    expect(hookSpecificOutput.additionalContext).toContain("agent script role");
  });

  it("skips tone hint when script is still_running", async () => {
    const matchers = getGroupPostToolUseHooks();
    const fn = matchers[3]!.hooks[0]!;
    const input = {
      hook_event_name: "PostToolUse" as const,
      tool_name: "mcp__agents__await_test_agent",
      tool_input: {},
      tool_use_id: "tu-1",
      tool_response: JSON.stringify({ status: "still_running" }),
    };
    const result = await callHook(fn, input);
    expect(result).toEqual({ continue: true });
  });

  it("passes through non-PostToolUse events", async () => {
    const matchers = getGroupPostToolUseHooks();
    const fn = matchers[3]!.hooks[0]!;
    const result = await callHook(fn, {
      hook_event_name: "PreToolUse" as const,
      tool_name: "foo",
      tool_input: {},
      tool_use_id: "t1",
    });
    expect(result).toEqual({ continue: true });
  });
});

// ─── buildDoveCanUseTool ──────────────────────────────────────────────────────

function makeCanUseToolCtx(overrides?: { signal?: AbortSignal }) {
  return {
    signal: overrides?.signal ?? new AbortController().signal,
    title: undefined,
    displayName: undefined,
    blockedPath: undefined,
    toolUseID: "tu-mock",
  };
}

const sampleQuestion = {
  question: "Which approach?",
  header: "Approach",
  options: [
    { label: "Fast", description: "Quick and dirty" },
    { label: "Clean", description: "Proper solution" },
  ],
  multiSelect: false,
};

describe("buildDoveCanUseTool — AskUserQuestion", () => {
  it("sends a question SSE event with the questions from input", async () => {
    const sent: ChatSseEvent[] = [];
    const { canUseTool } = buildDoveCanUseTool((e) => sent.push(e));

    const resultPromise = canUseTool(
      "AskUserQuestion",
      { questions: [sampleQuestion] },
      makeCanUseToolCtx(),
    );

    expect(sent).toHaveLength(1);
    const event = sent[0] as ChatSseQuestion;
    expect(event.type).toBe("question");
    expect(event.requestId).toBeTruthy();
    expect(event.questions).toEqual([sampleQuestion]);

    // Resolve so the promise settles (avoids unhandled-promise warnings)
    resolvePendingQuestion(event.requestId, { "Which approach?": "Fast" });
    await resultPromise;
  });

  it("returns allow with answers merged into updatedInput", async () => {
    const sent: ChatSseEvent[] = [];
    const { canUseTool } = buildDoveCanUseTool((e) => sent.push(e));
    const answers = { "Which approach?": "Clean" };

    const resultPromise = canUseTool(
      "AskUserQuestion",
      { questions: [sampleQuestion] },
      makeCanUseToolCtx(),
    );

    const event = sent[0] as ChatSseQuestion;
    resolvePendingQuestion(event.requestId, answers);
    const result = await resultPromise;

    expect(result.behavior).toBe("allow");
    expect((result as { updatedInput: unknown }).updatedInput).toMatchObject({ answers });
  });

  it("returns allow with empty answers when the signal aborts", async () => {
    const sent: ChatSseEvent[] = [];
    const { canUseTool } = buildDoveCanUseTool((e) => sent.push(e));
    const ctrl = new AbortController();

    const resultPromise = canUseTool(
      "AskUserQuestion",
      { questions: [sampleQuestion] },
      makeCanUseToolCtx({ signal: ctrl.signal }),
    );

    ctrl.abort();
    const result = await resultPromise;
    expect(result.behavior).toBe("allow");
    expect((result as { updatedInput: Record<string, unknown> }).updatedInput.answers).toEqual({});
  });

  it("handles missing questions key gracefully (sends empty array)", async () => {
    const sent: ChatSseEvent[] = [];
    const { canUseTool } = buildDoveCanUseTool((e) => sent.push(e));

    const resultPromise = canUseTool("AskUserQuestion", {}, makeCanUseToolCtx());

    const event = sent[0] as ChatSseQuestion;
    expect(event.questions).toEqual([]);
    resolvePendingQuestion(event.requestId, {});
    await resultPromise;
  });
});

describe("buildDoveCanUseTool — permission flow", () => {
  it("sends a permission SSE event for non-AskUserQuestion tools", async () => {
    const sent: ChatSseEvent[] = [];
    const { canUseTool } = buildDoveCanUseTool((e) => sent.push(e));

    const resultPromise = canUseTool("Bash", { command: "ls" }, makeCanUseToolCtx());

    expect(sent).toHaveLength(1);
    const event = sent[0] as ChatSsePermission;
    expect(event.type).toBe("permission");
    expect(event.requestId).toBeTruthy();

    resolvePendingPermission(event.requestId, true);
    const result = await resultPromise;
    expect(result.behavior).toBe("allow");
  });

  it("returns deny when user denies the permission", async () => {
    const sent: ChatSseEvent[] = [];
    const { canUseTool } = buildDoveCanUseTool((e) => sent.push(e));

    const resultPromise = canUseTool("Write", { file_path: "/tmp/x" }, makeCanUseToolCtx());
    const event = sent[0] as ChatSsePermission;
    resolvePendingPermission(event.requestId, false);
    const result = await resultPromise;
    expect(result.behavior).toBe("deny");
  });
});

describe("buildDoveCanUseTool — abortPermissions", () => {
  it("denies all in-flight permission requests on abort", async () => {
    const sent: ChatSseEvent[] = [];
    const { canUseTool, abortPermissions } = buildDoveCanUseTool((e) => sent.push(e));

    const p1 = canUseTool("Bash", { command: "ls" }, makeCanUseToolCtx());
    const p2 = canUseTool("Write", { file_path: "/tmp/x" }, makeCanUseToolCtx());

    abortPermissions();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.behavior).toBe("deny");
    expect(r2.behavior).toBe("deny");
  });

  it("resolves in-flight AskUserQuestion requests with empty answers on abort", async () => {
    const sent: ChatSseEvent[] = [];
    const { canUseTool, abortPermissions } = buildDoveCanUseTool((e) => sent.push(e));

    const p = canUseTool("AskUserQuestion", { questions: [sampleQuestion] }, makeCanUseToolCtx());
    abortPermissions();
    const result = await p;
    expect(result.behavior).toBe("allow");
    expect((result as { updatedInput: Record<string, unknown> }).updatedInput.answers).toEqual({});
  });
});

// ─── buildSubagentCanUseTool ──────────────────────────────────────────────────

function makeOkResponse(ok: boolean): Response {
  return { ok } as unknown as Response;
}

describe("buildSubagentCanUseTool", () => {
  const mockFetch = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    mockFetch.mockReset();
  });

  it("returns allow when fetch responds ok", async () => {
    mockFetch.mockResolvedValue(makeOkResponse(true));
    const canUseTool = buildSubagentCanUseTool("ctx-1", "7473");
    const result = await canUseTool("Bash", { command: "ls" }, makeCanUseToolCtx());
    expect(result.behavior).toBe("allow");
  });

  it("returns deny when fetch responds not ok", async () => {
    mockFetch.mockResolvedValue(makeOkResponse(false));
    const canUseTool = buildSubagentCanUseTool("ctx-1", "7473");
    const result = await canUseTool("Bash", { command: "ls" }, makeCanUseToolCtx());
    expect(result.behavior).toBe("deny");
  });

  it("returns deny when fetch rejects", async () => {
    mockFetch.mockRejectedValue(new Error("network error"));
    const canUseTool = buildSubagentCanUseTool("ctx-1", "7473");
    const result = await canUseTool("Bash", { command: "ls" }, makeCanUseToolCtx());
    expect(result.behavior).toBe("deny");
  });

  it("returns deny immediately when per-tool signal aborts", async () => {
    const ac = new AbortController();
    // Fetch never resolves
    mockFetch.mockReturnValue(new Promise(() => {}));
    const canUseTool = buildSubagentCanUseTool("ctx-1", "7473");
    const resultPromise = canUseTool(
      "Bash",
      { command: "ls" },
      makeCanUseToolCtx({ signal: ac.signal }),
    );
    ac.abort();
    const result = await resultPromise;
    expect(result.behavior).toBe("deny");
  });

  it("POSTs to the correct endpoint with contextId, requestId, toolName, toolInput", async () => {
    mockFetch.mockResolvedValue(makeOkResponse(true));
    const canUseTool = buildSubagentCanUseTool("ctx-42", "9000");
    await canUseTool("Write", { file_path: "/tmp/x" }, makeCanUseToolCtx());

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:9000/api/internal/subagent-permission");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.contextId).toBe("ctx-42");
    expect(body.toolName).toBe("Write");
    expect(body.toolInput).toEqual({ file_path: "/tmp/x" });
    expect(typeof body.requestId).toBe("string");
  });

  it("uses displayName over toolName in the payload", async () => {
    mockFetch.mockResolvedValue(makeOkResponse(true));
    const canUseTool = buildSubagentCanUseTool("ctx-1", "7473");
    await canUseTool("Write", {}, { ...makeCanUseToolCtx(), displayName: "Write file" });

    const body = JSON.parse(
      (mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string,
    ) as Record<string, unknown>;
    expect(body.toolName).toBe("Write file");
  });

  it("merges blockedPath into toolInput as file_path", async () => {
    mockFetch.mockResolvedValue(makeOkResponse(true));
    const canUseTool = buildSubagentCanUseTool("ctx-1", "7473");
    await canUseTool(
      "Write",
      { content: "hello" },
      { ...makeCanUseToolCtx(), blockedPath: "/etc/hosts" },
    );

    const body = JSON.parse(
      (mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string,
    ) as Record<string, unknown>;
    expect(body.toolInput).toEqual({ content: "hello", file_path: "/etc/hosts" });
  });
});
