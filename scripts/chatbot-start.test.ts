import { describe, it, expect } from "vitest";
import { buildConcurrentlyCommand } from "./chatbot-start.js";

describe("buildConcurrentlyCommand", () => {
  it("returns a single string (not an array) to avoid Node 24 DEP0190", () => {
    const cmd = buildConcurrentlyCommand(7473);
    expect(typeof cmd).toBe("string");
  });

  it("includes the port in the Next.js command", () => {
    const cmd = buildConcurrentlyCommand(12345);
    expect(cmd).toContain("-p 12345");
  });

  it("quotes the [{name}] prefix so the shell does not expand it", () => {
    const cmd = buildConcurrentlyCommand(7473);
    // The prefix must appear as "[{name}]" in quotes, not bare [{name}]
    expect(cmd).toContain('"[{name}]"');
  });

  it("includes both a2a and next process names", () => {
    const cmd = buildConcurrentlyCommand(7473);
    expect(cmd).toContain('"a2a,next"');
  });
});
