import { describe, expect, it, vi } from "vitest";
import { buildAgentHooks } from "../hooks";
import { buildSubAgentHooks } from "../subagent-hooks";

const signal = new AbortController().signal;
const callHook = (fn: Function, input: unknown) => fn(input, undefined, { signal });

function makeConfig(overrides?: {
  hasPendingWork?: () => boolean;
  getPendingIds?: () => string[];
  getStillRunningId?: (s: unknown) => string | undefined;
  userPromptReminder?: string;
  allowedDirectories?: string[];
}) {
  return {
    postToolUseMatcher: "test_tool",
    hasPendingWork: overrides?.hasPendingWork ?? (() => false),
    getPendingIds: overrides?.getPendingIds ?? (() => []),
    getStillRunningId: overrides?.getStillRunningId ?? (() => undefined),
    userPromptReminder: overrides?.userPromptReminder,
    allowedDirectories: overrides?.allowedDirectories,
  };
}

function preToolUseInput(toolName: string, toolInput: unknown) {
  return {
    hook_event_name: "PreToolUse" as const,
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: "tu-1",
  };
}

function stopInput(overrides?: { stop_hook_active?: boolean }) {
  return {
    hook_event_name: "Stop" as const,
    stop_reason: "end_turn" as const,
    stop_hook_active: overrides?.stop_hook_active ?? false,
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
    const hooks = buildAgentHooks(makeConfig({ hasPendingWork: () => false }));
    const fn = hooks.Stop![0]!.hooks[0]!;
    const result = await callHook(fn, stopInput());
    expect(result).toEqual({ continue: true });
  });

  it("allows stop when stop_hook_active", async () => {
    const hooks = buildAgentHooks(makeConfig({ hasPendingWork: () => true }));
    const fn = hooks.Stop![0]!.hooks[0]!;
    const result = await callHook(fn, stopInput({ stop_hook_active: true }));
    expect(result).toEqual({ continue: true });
  });

  it("blocks stop with MUST message when pending work exists", async () => {
    const hooks = buildAgentHooks(
      makeConfig({
        hasPendingWork: () => true,
        getPendingIds: () => ["abc-123"],
      }),
    );
    const fn = hooks.Stop![0]!.hooks[0]!;
    const result = await callHook(fn, stopInput());
    expect(result).toMatchObject({ decision: "block" });
    expect((result as { reason: string }).reason).toContain(
      "You MUST call the await tool yourself with the id",
    );
    expect((result as { reason: string }).reason).toContain("abc-123");
  });

  it("includes polling guidance in the Stop message", async () => {
    const hooks = buildAgentHooks(
      makeConfig({
        hasPendingWork: () => true,
        getPendingIds: () => ["abc-123"],
      }),
    );
    const fn = hooks.Stop![0]!.hooks[0]!;
    const result = (await callHook(fn, stopInput())) as { reason: string };
    expect(result.reason).toContain("minutes to hours");
    expect(result.reason).toContain("Never give up or stop polling");
  });

  it("lists all pending ids in the Stop message", async () => {
    const hooks = buildAgentHooks(
      makeConfig({
        hasPendingWork: () => true,
        getPendingIds: () => ["id-1", "id-2"],
      }),
    );
    const fn = hooks.Stop![0]!.hooks[0]!;
    const result = (await callHook(fn, stopInput())) as { reason: string };
    expect(result.reason).toContain("id-1");
    expect(result.reason).toContain("id-2");
  });
});

describe("buildAgentHooks — PostToolUse hook", () => {
  it("passes through non-still_running responses", async () => {
    const hooks = buildAgentHooks(makeConfig());
    const fn = hooks.PostToolUse![0]!.hooks[0]!;
    const result = await callHook(fn, postToolUseInput({ status: "complete", data: "done" }));
    expect(result).toEqual({ continue: true });
  });

  it("blocks with MUST reason on still_running", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // max = 10, won't release on first call
    const hooks = buildAgentHooks(makeConfig({ getStillRunningId: () => "run-xyz" }));
    const fn = hooks.PostToolUse![0]!.hooks[0]!;
    const result = await callHook(fn, postToolUseInput({ status: "still_running" }));
    const { decision, reason } = result as { decision: string; reason: string };
    expect(decision).toBe("block");
    expect(reason).toContain("You MUST call the await tool again yourself with id");
    expect(reason).toContain("run-xyz");
    vi.restoreAllMocks();
  });

  it("releases (continue: true) when retry counter threshold is hit", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // max = floor(0 * 10) + 6 = 6
    const hooks = buildAgentHooks(makeConfig());
    const fn = hooks.PostToolUse![0]!.hooks[0]!;
    // exhaust 5 forced-retry calls, 6th should release
    for (let i = 0; i < 5; i++) await callHook(fn, postToolUseInput({ status: "still_running" }));
    const result = await callHook(fn, postToolUseInput({ status: "still_running" }));
    expect(result).toMatchObject({ continue: true });
    vi.restoreAllMocks();
  });
});

describe("buildAgentHooks — PreToolUse hook", () => {
  it("is absent when allowedDirectories is not set", () => {
    const hooks = buildAgentHooks(makeConfig());
    expect(hooks.PreToolUse).toBeUndefined();
  });

  it("is absent when allowedDirectories is empty", () => {
    const hooks = buildAgentHooks(makeConfig({ allowedDirectories: [] }));
    expect(hooks.PreToolUse).toBeUndefined();
  });

  it("has matcher Edit|Write", () => {
    const hooks = buildAgentHooks(makeConfig({ allowedDirectories: ["/tmp"] }));
    expect(hooks.PreToolUse![0]!.matcher).toBe("Edit|Write");
  });

  it("allows when file_path is directly inside an allowed directory", async () => {
    const hooks = buildAgentHooks(makeConfig({ allowedDirectories: ["/tmp/workspace"] }));
    const fn = hooks.PreToolUse![0]!.hooks[0]!;
    const result = await callHook(
      fn,
      preToolUseInput("Edit", { file_path: "/tmp/workspace/foo.ts" }),
    );
    const { hookSpecificOutput } = result as { hookSpecificOutput: { permissionDecision: string } };
    expect(hookSpecificOutput.permissionDecision).toBe("allow");
  });

  it("allows when file_path equals an allowed directory exactly", async () => {
    const hooks = buildAgentHooks(makeConfig({ allowedDirectories: ["/tmp/workspace"] }));
    const fn = hooks.PreToolUse![0]!.hooks[0]!;
    const result = await callHook(fn, preToolUseInput("Edit", { file_path: "/tmp/workspace" }));
    const { hookSpecificOutput } = result as { hookSpecificOutput: { permissionDecision: string } };
    expect(hookSpecificOutput.permissionDecision).toBe("allow");
  });

  it("allows when file_path is nested deeply inside an allowed directory", async () => {
    const hooks = buildAgentHooks(makeConfig({ allowedDirectories: ["/tmp/workspace"] }));
    const fn = hooks.PreToolUse![0]!.hooks[0]!;
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
    const fn = hooks.PreToolUse![0]!.hooks[0]!;
    const result = await callHook(
      fn,
      preToolUseInput("Edit", { file_path: "/home/agents/logs/out.log" }),
    );
    const { hookSpecificOutput } = result as { hookSpecificOutput: { permissionDecision: string } };
    expect(hookSpecificOutput.permissionDecision).toBe("allow");
  });

  it("denies when file_path is outside all allowed directories", async () => {
    const hooks = buildAgentHooks(makeConfig({ allowedDirectories: ["/tmp/workspace"] }));
    const fn = hooks.PreToolUse![0]!.hooks[0]!;
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
    const fn = hooks.PreToolUse![0]!.hooks[0]!;
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
    const fn = hooks.PreToolUse![0]!.hooks[0]!;
    const result = await callHook(fn, preToolUseInput("Edit", { content: "hello" }));
    expect(result).toEqual({ continue: true });
  });

  it("passes through when tool_input is not an object", async () => {
    const hooks = buildAgentHooks(makeConfig({ allowedDirectories: ["/tmp/workspace"] }));
    const fn = hooks.PreToolUse![0]!.hooks[0]!;
    const result = await callHook(fn, preToolUseInput("Edit", null));
    expect(result).toEqual({ continue: true });
  });

  it("passes through non-PreToolUse events", async () => {
    const hooks = buildAgentHooks(makeConfig({ allowedDirectories: ["/tmp/workspace"] }));
    const fn = hooks.PreToolUse![0]!.hooks[0]!;
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

// ─── buildSubAgentHooks — self-reflection gate ────────────────────────────────

vi.mock("@/a2a/lib/spawn", () => ({
  hasPendingScripts: () => false,
  getPendingRunIds: () => [],
}));

describe("buildSubAgentHooks — chat_to reflection gate", () => {
  function getReflectionHook() {
    const hooks = buildSubAgentHooks("/cwd", []);
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
        justification: { pattern: "Detection → Resolution", handoff: "3 errors found" },
      }),
    );
    expect(result.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(result.hookSpecificOutput?.permissionDecisionReason).toContain("confidence");
  });

  it("denies when confidence is below threshold", async () => {
    const fn = getReflectionHook();
    const result = await callHook(
      fn,
      chatToInput({
        instruction: "fix it",
        justification: {
          pattern: "Detection → Resolution",
          handoff: "3 errors found",
          confidence: 85,
        },
      }),
    );
    expect(result.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(result.hookSpecificOutput?.permissionDecisionReason).toContain("85");
  });

  it("allows when confidence meets threshold", async () => {
    const fn = getReflectionHook();
    const result = await callHook(
      fn,
      chatToInput({
        instruction: "fix it",
        justification: {
          pattern: "Detection → Resolution",
          handoff: "3 errors found",
          confidence: 90,
        },
      }),
    );
    expect(result.hookSpecificOutput?.permissionDecision).toBe("allow");
  });

  it("allows when confidence exceeds threshold", async () => {
    const fn = getReflectionHook();
    const result = await callHook(
      fn,
      chatToInput({
        instruction: "fix it",
        justification: { pattern: "Phase handoff", handoff: "report complete", confidence: 98 },
      }),
    );
    expect(result.hookSpecificOutput?.permissionDecision).toBe("allow");
  });
});
