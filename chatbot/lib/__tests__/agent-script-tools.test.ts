import { describe, it, expect } from "vitest";
import { withMemoryReminder } from "@@/lib/subagent-reminder";

describe("withMemoryReminder", () => {
  it("places instruction before <reminder> block", () => {
    const result = withMemoryReminder("Do the thing", "/state/my-agent", "start_my_agent");
    expect(result.indexOf("Do the thing")).toBeLessThan(result.indexOf("<reminder>"));
  });

  it("includes memoryDir path in the reminder block", () => {
    const result = withMemoryReminder("task", "/state/my-agent", "start_my_agent");
    expect(result).toContain("/state/my-agent/memory/MEMORY.md");
  });

  it("includes the start tool name in the reminder block", () => {
    const result = withMemoryReminder("task", "/state/my-agent", "start_my_agent");
    expect(result).toContain("start_my_agent");
  });

  it("uses hard-gate MUST language", () => {
    const result = withMemoryReminder("task", "/state/my-agent", "start_my_agent");
    expect(result).toContain("MUST");
    expect(result).toContain("NEVER skip");
  });
});
