import { describe, it, expect } from "vitest";
import { buildHandoffConsiderationPrompt } from "./agent-link-hooks";
import { HANDOFF_SCORE_THRESHOLD } from "./agent-link-tools";

const tools = [
  { name: "start_chat_to_reviewer", description: "Hand off to the reviewer agent" },
  { name: "start_escalate_to_admin", description: "Escalate to admin" },
];

describe("HANDOFF_SCORE_THRESHOLD", () => {
  it("is 80", () => {
    expect(HANDOFF_SCORE_THRESHOLD).toBe(80);
  });
});

describe("buildHandoffConsiderationPrompt", () => {
  it("includes tool names and descriptions as XML", () => {
    const prompt = buildHandoffConsiderationPrompt(tools);
    expect(prompt).toContain("<name>start_chat_to_reviewer</name>");
    expect(prompt).toContain("<description>Hand off to the reviewer agent</description>");
    expect(prompt).toContain("<name>start_escalate_to_admin</name>");
  });

  it("embeds HANDOFF_SCORE_THRESHOLD in the scoring guide", () => {
    const prompt = buildHandoffConsiderationPrompt(tools);
    expect(prompt).toContain(`${HANDOFF_SCORE_THRESHOLD}–100`);
    expect(prompt).toContain(`1–${HANDOFF_SCORE_THRESHOLD - 1}`);
  });

  it("includes the RULE forcing handoff when score >= threshold", () => {
    const prompt = buildHandoffConsiderationPrompt(tools);
    expect(prompt).toContain(
      `If any tool scores ≥ ${HANDOFF_SCORE_THRESHOLD}, you MUST call it now`,
    );
  });

  it("non-group mode: ifBelow instructs to respond with lastAssistantMessage", () => {
    const prompt = buildHandoffConsiderationPrompt(tools, false, "Here are your results.");
    expect(prompt).toContain(
      `If no tool scores ≥ ${HANDOFF_SCORE_THRESHOLD}: respond with exactly:\n"Here are your results."`,
    );
    expect(prompt).not.toContain("DO NOT explain your reasoning");
  });

  it("non-group mode: falls back to empty string when lastAssistantMessage is undefined", () => {
    const prompt = buildHandoffConsiderationPrompt(tools, false, undefined);
    expect(prompt).toContain(`respond with exactly:\n""`);
  });

  it("group mode: ifBelow instructs to stop silently", () => {
    const prompt = buildHandoffConsiderationPrompt(tools, true);
    expect(prompt).toContain(
      `If no tool scores ≥ ${HANDOFF_SCORE_THRESHOLD}: stop immediately and DO NOT explain your reasoning.`,
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
