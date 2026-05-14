import { describe, expect, it, vi } from "vitest";
import type { PostToolUseHookSpecificOutput } from "@anthropic-ai/claude-agent-sdk";

vi.mock("@/lib/memory", () => ({
  getMemoryProvider: vi.fn(async () => ({
    buildSaveReminder: (_groupContextId: string, _workspacePath: string) =>
      "Save to /ws/moments/ when: decision reached.",
  })),
}));

import { makeGroupMomentSaveHook } from "@/lib/agent-link-hooks";

function postToolUseInput(toolResponse: unknown, toolName = "mcp__agents__await_chat_to_test") {
  return {
    hook_event_name: "PostToolUse" as const,
    tool_name: toolName,
    tool_response: JSON.stringify(toolResponse),
    tool_input: {},
    stop_hook_active: false,
  };
}

// HookCallback signature: (input, toolUseID, options) — pass dummy values for the extra args
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callHook(handler: (...args: any[]) => unknown, input: unknown) {
  return handler(input, undefined, {});
}

describe("makeGroupMomentSaveHook", () => {
  const hook = makeGroupMomentSaveHook("grp-123", "/ws");
  const handler = hook.hooks[0];

  it("returns additionalContext with provider save prompt when status is completed", async () => {
    const result = await callHook(handler, postToolUseInput({ status: "completed" }));
    const out = (result as { hookSpecificOutput: PostToolUseHookSpecificOutput })
      .hookSpecificOutput;
    expect(out.hookEventName).toBe("PostToolUse");
    expect(out.additionalContext).toContain("Save to /ws/moments/");
  });

  it("passes through when status is still_running", async () => {
    const result = await callHook(handler, postToolUseInput({ status: "still_running" }));
    expect(result).toEqual({ continue: true });
  });

  it("passes through when status is missing", async () => {
    const result = await callHook(handler, postToolUseInput({ output: "some text" }));
    expect(result).toEqual({ continue: true });
  });

  it("passes through when hook_event_name is not PostToolUse", async () => {
    const result = await callHook(handler, {
      hook_event_name: "Stop" as const,
      stop_hook_active: false,
      last_assistant_message: "",
    });
    expect(result).toEqual({ continue: true });
  });
});
