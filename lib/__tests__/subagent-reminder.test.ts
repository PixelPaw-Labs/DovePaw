import { describe, it, expect } from "vitest";
import {
  buildSubAgentReminder,
  withMemoryReminder,
  SUBAGENT_PROMPT_REMINDER,
} from "../subagent-reminder.js";

describe("buildSubAgentReminder", () => {
  it("returns base reminder when called with no args", () => {
    expect(buildSubAgentReminder()).toBe(SUBAGENT_PROMPT_REMINDER);
  });

  it("returns base reminder when extra is empty string", () => {
    expect(buildSubAgentReminder("")).toBe(SUBAGENT_PROMPT_REMINDER);
  });

  it("injects extra inside </reminder> when only extra is provided", () => {
    const result = buildSubAgentReminder("do something extra");
    expect(result).toContain("do something extra");
    expect(result.indexOf("do something extra")).toBeLessThan(result.indexOf("</reminder>"));
  });
});

describe("withMemoryReminder", () => {
  it("wraps memory bullet in <reminder> tags", () => {
    const result = withMemoryReminder("task", "/home/.dovepaw/agents/state/.my-agent");
    expect(result).toContain("<reminder>");
    expect(result).toContain("</reminder>");
  });

  it("includes MEMORY.md path and falls back to 'the start tool'", () => {
    const result = withMemoryReminder("task", "/home/.dovepaw/agents/state/.my-agent");
    expect(result).toContain("MEMORY.md");
    expect(result).toContain("the start tool");
  });

  it("includes startToolName when provided", () => {
    const result = withMemoryReminder(
      "task",
      "/home/.dovepaw/agents/state/.my-agent",
      "start_run_my_agent",
    );
    expect(result).toContain("MEMORY.md");
    expect(result).toContain("start_run_my_agent");
  });

  it("returns instruction unchanged when memoryDir is absent", () => {
    expect(withMemoryReminder("do the thing")).toBe("do the thing");
  });
});
