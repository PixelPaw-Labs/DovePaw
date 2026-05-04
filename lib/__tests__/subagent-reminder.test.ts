import { describe, it, expect } from "vitest";
import { buildSubAgentReminder, SUBAGENT_PROMPT_REMINDER } from "../subagent-reminder.js";

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

  it("injects memory bullet when memoryDir is provided without startToolName", () => {
    const result = buildSubAgentReminder(
      undefined,
      "/home/.dovepaw/agents/state/.my-agent",
      undefined,
      true,
    );
    expect(result).toContain("MEMORY.md");
    expect(result).toContain("the start tool");
    expect(result.indexOf("MEMORY.md")).toBeLessThan(result.indexOf("</reminder>"));
  });

  it("injects memory bullet with start tool reference when both memoryDir and startToolName are provided", () => {
    const result = buildSubAgentReminder(
      undefined,
      "/home/.dovepaw/agents/state/.my-agent",
      "start_run_my_agent",
      true,
    );
    expect(result).toContain("MEMORY.md");
    expect(result).toContain("start_run_my_agent");
    expect(result).not.toContain("say memory is insufficient");
  });

  it("injects both extra and memory bullet when all args are provided", () => {
    const result = buildSubAgentReminder(
      "extra instruction",
      "/home/.dovepaw/agents/state/.my-agent",
      "start_run_my_agent",
      true,
    );
    expect(result).toContain("extra instruction");
    expect(result).toContain("MEMORY.md");
    expect(result).toContain("start_run_my_agent");
  });
});
