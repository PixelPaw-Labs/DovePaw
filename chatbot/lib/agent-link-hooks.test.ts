import { describe, it, expect } from "vitest";
import { buildHandoffConsiderationPrompt } from "./agent-link-hooks";

const tools = [
  {
    name: "start_chat_to_reviewer",
    description: "Hand off to the reviewer agent",
    handoffScoreMin: 80,
    handoffScoreMax: 100,
  },
  {
    name: "start_escalate_to_admin",
    description: "Escalate to admin",
    handoffScoreMin: 0,
    handoffScoreMax: 100,
  },
];

describe("buildHandoffConsiderationPrompt", () => {
  it("includes tool names, descriptions, and handoff_range as XML", () => {
    const prompt = buildHandoffConsiderationPrompt(tools);
    expect(prompt).toContain("<name>start_chat_to_reviewer</name>");
    expect(prompt).toContain("<description>Hand off to the reviewer agent</description>");
    expect(prompt).toContain("<handoff_range>[80, 100]</handoff_range>");
    expect(prompt).toContain("<name>start_escalate_to_admin</name>");
    expect(prompt).toContain("<handoff_range>[0, 100]</handoff_range>");
  });

  it("defaults to [80, 100] when range is absent", () => {
    const prompt = buildHandoffConsiderationPrompt([
      { name: "start_chat_to_x", description: "desc" },
    ]);
    expect(prompt).toContain("<handoff_range>[80, 100]</handoff_range>");
  });

  it("includes the RULE referencing handoff_range", () => {
    const prompt = buildHandoffConsiderationPrompt(tools);
    expect(prompt).toContain("score falls within its handoff_range");
    expect(prompt).toContain("you MUST call it now");
  });

  it("non-group mode: ifNoMatch instructs to respond with lastAssistantMessage", () => {
    const prompt = buildHandoffConsiderationPrompt(tools, false, "Here are your results.");
    expect(prompt).toContain(
      `If no tool's score falls within its handoff_range: respond with exactly:\n"Here are your results."`,
    );
    expect(prompt).not.toContain("DO NOT explain your reasoning");
  });

  it("non-group mode: falls back to empty string when lastAssistantMessage is undefined", () => {
    const prompt = buildHandoffConsiderationPrompt(tools, false, undefined);
    expect(prompt).toContain(`respond with exactly:\n""`);
  });

  it("group mode: ifNoMatch instructs to stop silently", () => {
    const prompt = buildHandoffConsiderationPrompt(tools, true);
    expect(prompt).toContain(
      `If no tool's score falls within its handoff_range: stop immediately and DO NOT explain your reasoning.`,
    );
  });

  it("group mode: includes narration suppression reminder", () => {
    const prompt = buildHandoffConsiderationPrompt(tools, true);
    expect(prompt).toContain("Do NOT output and respond with any text");
  });

  it("non-group mode: does not include group narration suppression", () => {
    const prompt = buildHandoffConsiderationPrompt(tools, false);
    expect(prompt).not.toContain("Do NOT output and respond with any text");
  });
});
