import { describe, expect, it, vi } from "vitest";
import { buildAgentHooks } from "../hooks";

const signal = new AbortController().signal;
const callHook = (fn: Function, input: unknown) => fn(input, undefined, { signal });

function makeConfig(overrides?: {
  hasPendingWork?: () => boolean;
  getPendingIds?: () => string[];
  getStillRunningId?: (s: unknown) => string | undefined;
  userPromptReminder?: string;
}) {
  return {
    postToolUseMatcher: "test_tool",
    hasPendingWork: overrides?.hasPendingWork ?? (() => false),
    getPendingIds: overrides?.getPendingIds ?? (() => []),
    getStillRunningId: overrides?.getStillRunningId ?? (() => undefined),
    userPromptReminder: overrides?.userPromptReminder,
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
