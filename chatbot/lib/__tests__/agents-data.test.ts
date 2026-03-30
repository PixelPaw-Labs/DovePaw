import { describe, expect, it } from "vitest";
import { AGENTS } from "@@/lib/agents";

describe("AGENTS — doveCard", () => {
  it("every agent has a doveCard with non-empty title and prompt", () => {
    for (const agent of AGENTS) {
      expect(agent.doveCard, `${agent.name}: missing doveCard`).toBeDefined();
      expect(agent.doveCard.title, `${agent.name}: doveCard.title empty`).toBeTruthy();
      expect(agent.doveCard.prompt, `${agent.name}: doveCard.prompt empty`).toBeTruthy();
    }
  });

  it("all doveCard titles are unique", () => {
    const titles = AGENTS.map((a) => a.doveCard.title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe("AGENTS — suggestions", () => {
  it("every agent has exactly 6 suggestions", () => {
    for (const agent of AGENTS) {
      expect(agent.suggestions, `${agent.name}: suggestions`).toHaveLength(6);
    }
  });

  it("every suggestion has non-empty title and prompt", () => {
    for (const agent of AGENTS) {
      for (const s of agent.suggestions) {
        expect(s.title, `${agent.name}: suggestion title empty`).toBeTruthy();
        expect(s.prompt, `${agent.name}: suggestion prompt empty`).toBeTruthy();
      }
    }
  });

  it("suggestion titles within each agent are unique", () => {
    for (const agent of AGENTS) {
      const titles = agent.suggestions.map((s) => s.title);
      expect(new Set(titles).size, `${agent.name}: duplicate suggestion titles`).toBe(
        titles.length,
      );
    }
  });
});
