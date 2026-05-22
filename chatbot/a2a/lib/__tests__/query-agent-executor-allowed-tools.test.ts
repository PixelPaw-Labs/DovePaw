// @vitest-environment node
/**
 * Unit tests for buildAllowedTools().
 *
 * Invariant: start_script_* must always appear in allowedTools regardless of
 * whether the executor is in ask mode. Previously it was gated behind !isAskMode,
 * which incorrectly excluded it during ask-mode invocations.
 */
import { describe, it, expect } from "vitest";
import { buildAllowedTools } from "../query-agent-executor.js";

const MANIFEST_KEY = "my_agent";
const START_TOOL = `mcp__agents__start_script_${MANIFEST_KEY}`;
const AWAIT_TOOL = `mcp__agents__await_script_${MANIFEST_KEY}`;

describe("buildAllowedTools()", () => {
  it("includes start_script tool in ask mode", () => {
    const tools = buildAllowedTools(MANIFEST_KEY, true, null);
    expect(tools).toContain(START_TOOL);
  });

  it("includes start_script tool in non-ask mode", () => {
    const tools = buildAllowedTools(MANIFEST_KEY, false, null);
    expect(tools).toContain(START_TOOL);
  });

  it("always includes await_script tool", () => {
    expect(buildAllowedTools(MANIFEST_KEY, true, null)).toContain(AWAIT_TOOL);
    expect(buildAllowedTools(MANIFEST_KEY, false, null)).toContain(AWAIT_TOOL);
  });

  it("includes linked agent tools only in non-ask mode", () => {
    const linked = [{ name: "linked_agent_tool" }];
    const askMode = buildAllowedTools(MANIFEST_KEY, true, linked);
    const nonAskMode = buildAllowedTools(MANIFEST_KEY, false, linked);

    expect(askMode).not.toContain("mcp__agents__linked_agent_tool");
    expect(nonAskMode).toContain("mcp__agents__linked_agent_tool");
  });
});
