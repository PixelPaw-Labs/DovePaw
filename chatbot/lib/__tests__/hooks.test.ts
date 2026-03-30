import { describe, expect, it, vi } from "vitest";
import { buildAgentHooks } from "../hooks";

const signal = new AbortController().signal;
const callHook = (fn: Function, input: unknown) => fn(input, undefined, { signal });

function makeConfig(overrides?: {
  hasPendingWork?: () => boolean;
  getPendingIds?: () => string[];
  getStillRunningId?: (s: unknown) => string | undefined;
}) {
  return {
    postToolUseMatcher: "test_tool",
    hasPendingWork: overrides?.hasPendingWork ?? (() => false),
    getPendingIds: overrides?.getPendingIds ?? (() => []),
    getStillRunningId: overrides?.getStillRunningId ?? (() => undefined),
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
    expect(result).toMatchObject({ continue: false });
    expect((result as { systemMessage: string }).systemMessage).toContain(
      "You MUST call the await tool yourself with the id",
    );
    expect((result as { systemMessage: string }).systemMessage).toContain("abc-123");
  });

  it("lists all pending ids in the Stop message", async () => {
    const hooks = buildAgentHooks(
      makeConfig({
        hasPendingWork: () => true,
        getPendingIds: () => ["id-1", "id-2"],
      }),
    );
    const fn = hooks.Stop![0]!.hooks[0]!;
    const result = (await callHook(fn, stopInput())) as { systemMessage: string };
    expect(result.systemMessage).toContain("id-1");
    expect(result.systemMessage).toContain("id-2");
  });
});

describe("buildAgentHooks — PostToolUse hook", () => {
  it("passes through non-still_running responses", async () => {
    const hooks = buildAgentHooks(makeConfig());
    const fn = hooks.PostToolUse![0]!.hooks[0]!;
    const result = await callHook(fn, postToolUseInput({ status: "complete", data: "done" }));
    expect(result).toEqual({ continue: true });
  });

  it("injects additionalContext with MUST message on still_running", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.8); // max = 5, won't release on first call
    const hooks = buildAgentHooks(makeConfig({ getStillRunningId: () => "run-xyz" }));
    const fn = hooks.PostToolUse![0]!.hooks[0]!;
    const result = await callHook(fn, postToolUseInput({ status: "still_running" }));
    const output = (result as { hookSpecificOutput: { additionalContext: string } })
      .hookSpecificOutput;
    expect(output.additionalContext).toContain(
      "You MUST call the await tool again yourself with id",
    );
    expect(output.additionalContext).toContain("run-xyz");
    vi.restoreAllMocks();
  });

  it("releases (continue: true) when retry counter threshold is hit", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // max = 1, releases immediately
    const hooks = buildAgentHooks(makeConfig());
    const fn = hooks.PostToolUse![0]!.hooks[0]!;
    const result = await callHook(fn, postToolUseInput({ status: "still_running" }));
    expect(result).toEqual({ continue: true });
    vi.restoreAllMocks();
  });
});
