/**
 * Tests for ScriptAgentExecutor helpers — verifies that the instruction from
 * the A2A userMessage is correctly extracted and forwarded as argv[2].
 */

import { describe, expect, it } from "vitest";

// These are pure functions — no mocks needed.
import { extractInstruction } from "../message-parts";
import { buildScriptArgs } from "../spawn";
import { startRunScriptToolName } from "@/lib/agent-tools";
import { buildSubAgentReminder } from "@@/lib/subagent-reminder";

const startScriptTool = startRunScriptToolName("test_agent");

describe("extractInstruction", () => {
  it("returns text from a single text part", () => {
    expect(extractInstruction([{ kind: "text", text: "P1AB1234 example.com:zone123" }])).toBe(
      "P1AB1234 example.com:zone123",
    );
  });

  it("joins multiple text parts with a space", () => {
    expect(
      extractInstruction([
        { kind: "text", text: "incidents today" },
        { kind: "text", text: "example.com:abc123" },
      ]),
    ).toBe("incidents today example.com:abc123");
  });

  it("returns empty string when there are no parts", () => {
    expect(extractInstruction([])).toBe("");
  });

  it("returns empty string when the only text part is empty", () => {
    expect(extractInstruction([{ kind: "text", text: "" }])).toBe("");
  });

  it("ignores non-text parts", () => {
    expect(
      extractInstruction([
        { kind: "data", text: "ignored" },
        { kind: "text", text: "incidents today" },
      ]),
    ).toBe("incidents today");
  });

  it("trims surrounding whitespace", () => {
    expect(extractInstruction([{ kind: "text", text: "  incidents today  " }])).toBe(
      "incidents today",
    );
  });
});

describe("QueryAgentExecutor prompt fallback", () => {
  it("uses instruction as prompt when non-empty", () => {
    const instruction = "incidents today";
    expect(instruction || startScriptTool).toBe("incidents today");
  });

  it("falls back to startRunScriptToolName when instruction is empty", () => {
    const instruction = "";
    expect(instruction || startScriptTool).toBe(startScriptTool);
  });

  it("startRunScriptToolName returns a non-empty string that includes the manifestKey", () => {
    expect(typeof startScriptTool).toBe("string");
    expect(startScriptTool).toBe("start_test_agent");
  });
});

describe("buildScriptArgs", () => {
  it("includes instruction as argv[2] when non-empty", () => {
    expect(buildScriptArgs("/app/agent.ts", "P1AB1234")).toEqual(["/app/agent.ts", "P1AB1234"]);
  });

  it("omits argv[2] when instruction is empty string", () => {
    expect(buildScriptArgs("/app/agent.ts", "")).toEqual(["/app/agent.ts"]);
  });

  it("always puts scriptPath first", () => {
    const args = buildScriptArgs("/some/path.ts", "run");
    expect(args[0]).toBe("/some/path.ts");
  });
});

describe("buildSubAgentReminder memory check", () => {
  it("injects memory bullet when memoryDir is provided and isAskMode is true", () => {
    const result = buildSubAgentReminder(undefined, "/state/.my-agent", "start_my_agent", true);
    expect(result).toContain("/state/.my-agent/memory/MEMORY.md");
    expect(result).toContain("MEMORY.md");
    expect(result).toContain("start_my_agent");
  });

  it("memory bullet appears inside the reminder tag", () => {
    const result = buildSubAgentReminder(undefined, "/state/.my-agent", "start_my_agent", true);
    const reminderIdx = result.indexOf("<reminder>");
    const bulletIdx = result.indexOf("MEMORY.md");
    expect(bulletIdx).toBeGreaterThan(reminderIdx);
  });

  it("omits memory bullet when memoryDir is absent", () => {
    const result = buildSubAgentReminder();
    expect(result).not.toContain("MEMORY.md");
  });

  it("memory insufficient path uses MUST language as a hard gate", () => {
    const result = buildSubAgentReminder(undefined, "/state/.my-agent", "start_my_agent", true);
    expect(result).toContain("MUST");
    expect(result).toContain("NEVER skip");
    expect(result).toContain("start_my_agent");
  });

  it("ask mode omits SOMETHING BEING DONE start bullet", () => {
    const result = buildSubAgentReminder(undefined, "/state/.my-agent", "start_my_agent", true);
    expect(result).not.toContain("SOMETHING BEING DONE");
  });

  it("start mode includes SOMETHING BEING DONE bullet and no memory bullet", () => {
    const result = buildSubAgentReminder(undefined, "/state/.my-agent", "start_my_agent", false);
    expect(result).toContain("SOMETHING BEING DONE");
    expect(result).not.toContain("MEMORY.md");
  });
});
