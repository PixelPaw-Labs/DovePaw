import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@@/lib/agent-links", () => ({
  readAgentLinks: vi.fn().mockResolvedValue([]),
  resolveLinkedTargets: vi.fn().mockReturnValue([]),
}));

import {
  buildAgentHooks,
  buildDoveCanUseTool,
  buildDoveHooks,
  buildLinksReminder,
  buildSubagentCanUseTool,
  getAwaitStatus,
} from "../hooks";
import { buildSubAgentHooks } from "../subagent-hooks";
import { GROUP_PROMPT_REMINDER } from "@@/lib/subagent-reminder";
import { DOVE_RESPONSE_REMINDER } from "@@/lib/dove-lean-reminder";
import { readAgentLinks, resolveLinkedTargets } from "@@/lib/agent-links";
import type { AgentDef } from "@@/lib/agents";
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
    expect(hooks.PreToolUse).toHaveLength(2);
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

describe("buildAgentHooks — PreToolUse Bash write guard", () => {
  it("no Bash hook when readOnly is not set", () => {
    const hooks = buildAgentHooks(makeConfig());
    const matchers = hooks.PreToolUse?.map((h) => h.matcher) ?? [];
    expect(matchers).not.toContain("Bash");
  });

  it("adds a Bash hook when readOnly is true", () => {
    const hooks = buildAgentHooks({ ...makeConfig(), readOnly: true });
    const matchers = hooks.PreToolUse?.map((h) => h.matcher) ?? [];
    expect(matchers).toContain("Bash");
  });

  it("hook denies Bash write redirect", async () => {
    const hooks = buildAgentHooks({ ...makeConfig(), readOnly: true });
    const fn = hooks.PreToolUse!.find((h) => h.matcher === "Bash")!.hooks[0]!;
    const result = await callHook(
      fn,
      preToolUseInput("Bash", { command: "cat /etc/passwd > /tmp/out.txt" }),
    );
    expect(result.hookSpecificOutput?.permissionDecision).toBe("deny");
  });

  it("hook allows Bash read-only command", async () => {
    const hooks = buildAgentHooks({ ...makeConfig(), readOnly: true });
    const fn = hooks.PreToolUse!.find((h) => h.matcher === "Bash")!.hooks[0]!;
    const result = await callHook(fn, preToolUseInput("Bash", { command: "cat /etc/passwd" }));
    expect(result).toEqual({ continue: true });
  });
});

describe("buildAgentHooks — PreToolUse Edit|Write guard (index 1)", () => {
  it("is absent when allowedDirectories is not set", () => {
    const hooks = buildAgentHooks(makeConfig());
    // ScheduleWakeup guard + Read allow hook — no Edit|Write entry
    expect(hooks.PreToolUse).toHaveLength(2);
  });

  it("is absent when allowedDirectories is empty", () => {
    const hooks = buildAgentHooks(makeConfig({ allowedDirectories: [] }));
    expect(hooks.PreToolUse).toHaveLength(2);
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

// ─── buildDoveHooks — PreToolUse start_* instruction reminder ────────────────

describe("buildDoveHooks — PreToolUse start_* instruction reminder", () => {
  const agents = [
    { name: "test-agent", manifestKey: "test_agent", toolName: "yolo_test_agent" },
  ] as Parameters<typeof buildDoveHooks>[0];

  function findReminderHook(hooks: ReturnType<typeof buildDoveHooks>) {
    return hooks.PreToolUse?.find((h) => h.matcher === "mcp__agents__start_.*");
  }

  it("registers a PreToolUse hook with matcher mcp__agents__start_.*", () => {
    const hooks = buildDoveHooks(agents, new PendingRegistry(), "/cwd", []);
    expect(findReminderHook(hooks)).toBeDefined();
  });

  it("injects additionalContext on start_* tool calls", async () => {
    const hooks = buildDoveHooks(agents, new PendingRegistry(), "/cwd", []);
    const fn = findReminderHook(hooks)!.hooks[0]!;
    const result = await callHook(fn, preToolUseInput("mcp__agents__start_test_agent", {}));
    expect(result).toHaveProperty("hookSpecificOutput");
    const { hookSpecificOutput } = result as { hookSpecificOutput: { additionalContext: string } };
    expect(hookSpecificOutput.additionalContext).toContain("instruction description");
    expect(hookSpecificOutput.additionalContext).toContain("tool description");
  });

  it("injects additionalContext on start_group_* tool calls", async () => {
    const hooks = buildDoveHooks(agents, new PendingRegistry(), "/cwd", []);
    const fn = findReminderHook(hooks)!.hooks[0]!;
    const result = await callHook(
      fn,
      preToolUseInput("mcp__agents__start_group_pixelpaw_labs", {}),
    );
    const { hookSpecificOutput } = result as { hookSpecificOutput: { additionalContext: string } };
    expect(hookSpecificOutput.additionalContext).toContain("instruction description");
  });

  it("passes through non-PreToolUse events", async () => {
    const hooks = buildDoveHooks(agents, new PendingRegistry(), "/cwd", []);
    const fn = findReminderHook(hooks)!.hooks[0]!;
    const result = await callHook(fn, postToolUseInput({}));
    expect(result).toEqual({ continue: true });
  });
});

// ─── buildDoveHooks — groupOrchestrationScore gate ───────────────────────────

describe("buildDoveHooks — groupOrchestrationScore gate (includeGroupReminder)", () => {
  const agents = [
    { name: "test-agent", manifestKey: "test_agent", toolName: "yolo_test_agent" },
  ] as Parameters<typeof buildDoveHooks>[0];

  function findScoreGateHook(hooks: ReturnType<typeof buildDoveHooks>) {
    // The score gate is the second PreToolUse hook with matcher mcp__agents__start_.*
    return hooks.PreToolUse?.filter((h) => h.matcher === "mcp__agents__start_.*")[1];
  }

  it("allows start_* when groupOrchestrationScore is exactly 80", async () => {
    const hooks = buildDoveHooks(agents, new PendingRegistry(), "/cwd", [], {
      includeGroupReminder: true,
    });
    const fn = findScoreGateHook(hooks)!.hooks[0]!;
    const result = await callHook(
      fn,
      preToolUseInput("mcp__agents__start_test_agent", {
        instruction: "go",
        group: { contextId: "ctx", groupOrchestrationScore: 80 },
      }),
    );
    expect(result).toEqual({ continue: true });
  });

  it("allows start_* when groupOrchestrationScore is 90", async () => {
    const hooks = buildDoveHooks(agents, new PendingRegistry(), "/cwd", [], {
      includeGroupReminder: true,
    });
    const fn = findScoreGateHook(hooks)!.hooks[0]!;
    const result = await callHook(
      fn,
      preToolUseInput("mcp__agents__start_test_agent", {
        instruction: "go",
        group: { contextId: "ctx", groupOrchestrationScore: 90 },
      }),
    );
    expect(result).toEqual({ continue: true });
  });

  it("denies start_* when groupOrchestrationScore is 79", async () => {
    const hooks = buildDoveHooks(agents, new PendingRegistry(), "/cwd", [], {
      includeGroupReminder: true,
    });
    const fn = findScoreGateHook(hooks)!.hooks[0]!;
    const result = await callHook(
      fn,
      preToolUseInput("mcp__agents__start_test_agent", {
        instruction: "go",
        group: { contextId: "ctx", groupOrchestrationScore: 79 },
      }),
    );
    const { hookSpecificOutput } = result as {
      hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string };
    };
    expect(hookSpecificOutput.permissionDecision).toBe("deny");
    expect(hookSpecificOutput.permissionDecisionReason).toContain("79");
  });

  it("denies start_* when groupOrchestrationScore is missing with self-reflection prompt", async () => {
    const hooks = buildDoveHooks(agents, new PendingRegistry(), "/cwd", [], {
      includeGroupReminder: true,
    });
    const fn = findScoreGateHook(hooks)!.hooks[0]!;
    const result = await callHook(
      fn,
      preToolUseInput("mcp__agents__start_test_agent", { instruction: "go" }),
    );
    const { hookSpecificOutput } = result as {
      hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string };
    };
    expect(hookSpecificOutput.permissionDecision).toBe("deny");
    expect(hookSpecificOutput.permissionDecisionReason).toContain("missing");
    expect(hookSpecificOutput.permissionDecisionReason).toContain("start_group_*");
    expect(hookSpecificOutput.permissionDecisionReason).toContain("HARD RULE");
  });

  it("denial for low score includes self-reflection prompt, not hard rule", async () => {
    const hooks = buildDoveHooks(agents, new PendingRegistry(), "/cwd", [], {
      includeGroupReminder: true,
    });
    const fn = findScoreGateHook(hooks)!.hooks[0]!;
    const result = await callHook(
      fn,
      preToolUseInput("mcp__agents__start_test_agent", {
        instruction: "go",
        group: { contextId: "ctx", groupOrchestrationScore: 50 },
      }),
    );
    const { hookSpecificOutput } = result as {
      hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string };
    };
    expect(hookSpecificOutput.permissionDecision).toBe("deny");
    expect(hookSpecificOutput.permissionDecisionReason).toContain("50");
    expect(hookSpecificOutput.permissionDecisionReason).toContain("start_group_*");
    expect(hookSpecificOutput.permissionDecisionReason).not.toContain("HARD RULE");
  });

  it("score gate is absent when includeGroupReminder is false", () => {
    const hooks = buildDoveHooks(agents, new PendingRegistry(), "/cwd", [], {
      includeGroupReminder: false,
    });
    expect(findScoreGateHook(hooks)).toBeUndefined();
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

  it("blocks with a links reminder when the completed agent has outgoing links", async () => {
    vi.mocked(readAgentLinks).mockResolvedValueOnce([]);
    vi.mocked(resolveLinkedTargets).mockReturnValueOnce([
      {
        targetName: "fixer",
        strategy: "chat" as const,
        handoffScoreMin: 80,
        handoffScoreMax: 100,
      },
    ]);
    const agents = [
      { name: "support-agent", manifestKey: "support_agent", toolName: "yolo_support" },
      { name: "fixer", manifestKey: "fixer", toolName: "yolo_fixer" },
    ] as Parameters<typeof buildDoveHooks>[0];
    const hooks = buildDoveHooks(agents, makeRegistry(), "/cwd", []);
    const fn = hooks.PostToolUse![1]!.hooks[0]!;
    const result = (await callHook(fn, awaitInput("completed"))) as {
      decision: string;
      reason: string;
    };
    expect(result.decision).toBe("block");
    expect(result.reason).toContain("<links>");
    expect(result.reason).toContain("<scoreKey>fixer</scoreKey>");
    expect(result.reason).toContain("<toolKey>fixer</toolKey>");
    expect(result.reason).toContain('<guidance strategy="');
  });
});

// ─── buildLinksReminder ──────────────────────────────────────────────────────

describe("buildLinksReminder", () => {
  const agents = [
    { name: "alpha", manifestKey: "alpha" },
    { name: "beta", manifestKey: "beta" },
    { name: "gamma", manifestKey: "gamma" },
  ] as AgentDef[];

  beforeEach(() => {
    vi.mocked(readAgentLinks).mockResolvedValue([]);
    vi.mocked(resolveLinkedTargets).mockReturnValue([]);
  });

  it("returns null when the agent has no outgoing links", async () => {
    vi.mocked(resolveLinkedTargets).mockReturnValueOnce([]);
    expect(await buildLinksReminder("alpha", agents)).toBeNull();
  });

  it("includes per-link handoff_range, strategy and tool names", async () => {
    vi.mocked(resolveLinkedTargets).mockReturnValueOnce([
      { targetName: "beta", strategy: "chat" as const, handoffScoreMin: 70, handoffScoreMax: 95 },
      {
        targetName: "gamma",
        strategy: "escalation" as const,
        handoffScoreMin: 50,
        handoffScoreMax: 90,
      },
    ]);
    const reminder = (await buildLinksReminder("alpha", agents))!;
    expect(reminder).toContain("<scoreKey>beta</scoreKey>");
    expect(reminder).toContain("<toolKey>beta</toolKey>");
    expect(reminder).toContain("<strategy>chat</strategy>");
    expect(reminder).toContain("<range>70–95</range>");
    expect(reminder).toContain("<scoreKey>gamma__escalation</scoreKey>");
    expect(reminder).toContain("<toolKey>gamma</toolKey>");
    expect(reminder).toContain("<strategy>escalation</strategy>");
    expect(reminder).toContain("<range>50–90</range>");
    expect(reminder).toContain('<guidance strategy="');
  });

  it("selects per-strategy pattern text", async () => {
    vi.mocked(resolveLinkedTargets).mockReturnValueOnce([
      {
        targetName: "beta",
        strategy: "review" as const,
        handoffScoreMin: 80,
        handoffScoreMax: 100,
      },
    ]);
    const reminder = (await buildLinksReminder("alpha", agents))!;
    expect(reminder).toContain("<scoreKey>beta__review</scoreKey>");
    expect(reminder).toContain("<strategy>review</strategy>");
    expect(reminder).toContain("<range>80–100</range>");
    expect(reminder).toContain('<guidance strategy="');
  });

  it("excludes the current orchestrator agent from the reminder (self-reference via dual back-link)", async () => {
    vi.mocked(resolveLinkedTargets).mockReturnValueOnce([
      { targetName: "beta", strategy: "chat" as const, handoffScoreMin: 0, handoffScoreMax: 100 },
      { targetName: "alpha", strategy: "chat" as const, handoffScoreMin: 0, handoffScoreMax: 100 },
    ]);
    const reminder = (await buildLinksReminder("beta", agents, "alpha"))!;
    expect(reminder).toContain("<toolKey>beta</toolKey>");
    expect(reminder).not.toContain("<toolKey>alpha</toolKey>");
  });

  it("returns null when all outgoing links are excluded", async () => {
    vi.mocked(resolveLinkedTargets).mockReturnValueOnce([
      { targetName: "alpha", strategy: "chat" as const, handoffScoreMin: 0, handoffScoreMax: 100 },
    ]);
    expect(await buildLinksReminder("beta", agents, "alpha")).toBeNull();
  });
});

// ─── buildSubAgentHooks — UserPromptSubmit reminder ──────────────────────────

describe("buildSubAgentHooks — UserPromptSubmit reminder", () => {
  it("always injects SUBAGENT_PROMPT_REMINDER even without behaviorReminder", async () => {
    const hooks = buildSubAgentHooks("/cwd", [], [], makeRegistry(), "test_agent");
    const fn = hooks.UserPromptSubmit![0]!.hooks[0]!;
    const result = await callHook(fn, { hook_event_name: "UserPromptSubmit", prompt: "do it" });
    const { hookSpecificOutput } = result as { hookSpecificOutput: { additionalContext: string } };
    expect(hookSpecificOutput.additionalContext).toContain("Do the work inline");
    expect(hookSpecificOutput.additionalContext).toContain("ALWAYS call `start_*` first");
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
      undefined,
      "",
    );
    const fn = hooks.UserPromptSubmit![0]!.hooks[0]!;
    const result = await callHook(fn, { hook_event_name: "UserPromptSubmit", prompt: "do it" });
    const { hookSpecificOutput } = result as { hookSpecificOutput: { additionalContext: string } };
    expect(hookSpecificOutput.additionalContext).toContain("Do the work inline");
    expect(hookSpecificOutput.additionalContext).toContain("ALWAYS call `start_*` first");
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
      undefined,
      "Check memory before MCP tools.",
    );
    const fn = hooks.UserPromptSubmit![0]!.hooks[0]!;
    const result = await callHook(fn, { hook_event_name: "UserPromptSubmit", prompt: "do it" });
    const { hookSpecificOutput } = result as { hookSpecificOutput: { additionalContext: string } };
    expect(hookSpecificOutput.additionalContext).toContain("ALWAYS call `start_*` first");
    expect(hookSpecificOutput.additionalContext).toContain("Check memory before MCP tools.");
    expect(
      hookSpecificOutput.additionalContext.indexOf("ALWAYS call `start_*` first"),
    ).toBeLessThan(hookSpecificOutput.additionalContext.indexOf("Check memory before MCP tools."));
  });
});

// ─── buildSubAgentHooks — isDirectChat ───────────────────────────────────────

describe("buildSubAgentHooks — isDirectChat", () => {
  it("adds linksReminderHook to PostToolUse when isDirectChat is true", () => {
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
      false,
      true,
    );
    // PostToolUse has: base (1) + linksReminderHook (1)
    expect(hooks.PostToolUse!.length).toBe(2);
  });

  it("omits linksReminderHook from PostToolUse when isDirectChat is false", () => {
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
      false,
      false,
    );
    // PostToolUse has only base hook — no linksReminderHook
    expect(hooks.PostToolUse!.length).toBe(1);
  });

  it("omits linksReminderHook when isDirectChat is undefined (default: not a direct chat)", () => {
    const hooks = buildSubAgentHooks("/cwd", [], [], makeRegistry(), "test_agent");
    expect(hooks.PostToolUse!.length).toBe(1);
  });

  it("adds justification gate to PreToolUse when isDirectChat is true", () => {
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
      false,
      true,
    );
    // PreToolUse has base hooks + justification gate
    const hasGate = hooks.PreToolUse!.some((m) => m.hooks.length > 0);
    expect(hasGate).toBe(true);
    expect(hooks.PreToolUse!.length).toBeGreaterThan(0);
  });

  it("omits justification gate from PreToolUse when isDirectChat is false", () => {
    const hooksWithGate = buildSubAgentHooks(
      "/cwd",
      [],
      [],
      makeRegistry(),
      "test_agent",
      undefined,
      undefined,
      undefined,
      false,
      false,
      true,
    );
    const hooksWithoutGate = buildSubAgentHooks(
      "/cwd",
      [],
      [],
      makeRegistry(),
      "test_agent",
      undefined,
      undefined,
      undefined,
      false,
      false,
      false,
    );
    expect(hooksWithGate.PreToolUse!.length).toBeGreaterThan(hooksWithoutGate.PreToolUse!.length);
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
    expect(hookSpecificOutput.additionalContext).toContain(
      "narration, status updates, or confirmations",
    );
    expect(hookSpecificOutput.additionalContext).not.toContain(
      "tell the user what you've kicked off",
    );
    expect(hookSpecificOutput.additionalContext).not.toContain("{{extra}}");
  });

  it("GROUP_PROMPT_REMINDER suppresses narration", () => {
    expect(GROUP_PROMPT_REMINDER).toMatch(/narration, status updates, or confirmations/i);
  });
});

function postToolUseByName(toolName: string) {
  return {
    hook_event_name: "PostToolUse" as const,
    tool_name: toolName,
    tool_input: {},
    tool_use_id: "tu-1",
    tool_response: "",
  };
}

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

  it("is at index 1 in group mode (after base PostToolUse hooks)", () => {
    const matchers = getGroupPostToolUseHooks();
    expect(matchers).toHaveLength(2);
  });

  it("injects tone additionalContext after await_test_agent completes", async () => {
    const matchers = getGroupPostToolUseHooks();
    const fn = matchers[1]!.hooks[0]!;
    const result = await callHook(fn, postToolUseByName("mcp__agents__await_test_agent"));
    const { hookSpecificOutput } = result as { hookSpecificOutput: { additionalContext: string } };
    expect(hookSpecificOutput.additionalContext).toContain("agent script role");
  });

  it("skips tone hint when script is still_running", async () => {
    const matchers = getGroupPostToolUseHooks();
    const fn = matchers[1]!.hooks[0]!;
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

describe("getAwaitStatus", () => {
  it("returns known status values from a JSON string tool_response", () => {
    expect(getAwaitStatus(JSON.stringify({ status: "completed" }))).toBe("completed");
    expect(getAwaitStatus(JSON.stringify({ status: "still_running" }))).toBe("still_running");
    expect(getAwaitStatus(JSON.stringify({ status: "canceled" }))).toBe("canceled");
    expect(getAwaitStatus(JSON.stringify({ status: "failed" }))).toBe("failed");
    expect(getAwaitStatus(JSON.stringify({ status: "rejected" }))).toBe("rejected");
  });

  it("returns known status from a plain object tool_response", () => {
    expect(getAwaitStatus({ status: "completed" })).toBe("completed");
  });

  it("returns undefined when status is not a known enum value", () => {
    expect(getAwaitStatus(JSON.stringify({ status: "unknown_state" }))).toBeUndefined();
    expect(getAwaitStatus(JSON.stringify({ status: 42 }))).toBeUndefined();
  });

  it("returns undefined when status is missing", () => {
    expect(getAwaitStatus(JSON.stringify({ output: "done" }))).toBeUndefined();
  });

  it("returns undefined for null, undefined, or non-object", () => {
    expect(getAwaitStatus(null)).toBeUndefined();
    expect(getAwaitStatus(undefined)).toBeUndefined();
    expect(getAwaitStatus("not json{")).toBeUndefined();
  });
});
