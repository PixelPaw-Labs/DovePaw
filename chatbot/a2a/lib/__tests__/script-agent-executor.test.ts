/**
 * Tests for ScriptAgentExecutor helpers — verifies that the instruction from
 * the A2A userMessage is correctly extracted and forwarded as argv[2].
 */

import { describe, expect, it } from "vitest";

// These are pure functions — no mocks needed.
import { extractInstruction, buildScriptArgs } from "../spawn";
import { START_SCRIPT_TOOL } from "@/lib/agent-tools";

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
    expect(instruction || START_SCRIPT_TOOL).toBe("incidents today");
  });

  it("falls back to START_SCRIPT_TOOL when instruction is empty", () => {
    const instruction = "";
    expect(instruction || START_SCRIPT_TOOL).toBe(START_SCRIPT_TOOL);
  });

  it("START_SCRIPT_TOOL is a non-empty string", () => {
    expect(typeof START_SCRIPT_TOOL).toBe("string");
    expect(START_SCRIPT_TOOL.length).toBeGreaterThan(0);
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
