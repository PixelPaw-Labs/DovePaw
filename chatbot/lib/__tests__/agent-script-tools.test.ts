import { describe, it, expect } from "vitest";
import { withMemoryReminder } from "../agent-script-tools.js";

describe("withMemoryReminder", () => {
  it("places instruction before <memory_check> block", () => {
    const result = withMemoryReminder("Do the thing", "/state/my-agent", "my_agent");
    expect(result.indexOf("Do the thing")).toBeLessThan(result.indexOf("<memory_check>"));
  });

  it("includes memoryDir path in the memory check block", () => {
    const result = withMemoryReminder("task", "/state/my-agent", "my_agent");
    expect(result).toContain("/state/my-agent/memory/MEMORY.md");
  });

  it("includes the derived start tool name in the memory check block", () => {
    const result = withMemoryReminder("task", "/state/my-agent", "my_agent");
    expect(result).toContain("start_my_agent");
  });
});
