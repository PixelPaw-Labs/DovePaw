import { describe, expect, it } from "vitest";
import { readAgentsConfig } from "@@/lib/agents-config";

describe("agents.json — doveCard", () => {
  it("every agent has a doveCard with non-empty title and prompt", async () => {
    for (const agent of await readAgentsConfig()) {
      expect(agent.doveCard, `${agent.name}: missing doveCard`).toBeDefined();
      expect(agent.doveCard.title, `${agent.name}: doveCard.title empty`).toBeTruthy();
      expect(agent.doveCard.prompt, `${agent.name}: doveCard.prompt empty`).toBeTruthy();
    }
  });

  it("all doveCard titles are unique", async () => {
    const agents = await readAgentsConfig();
    const titles = agents.map((a) => a.doveCard.title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe("agents.json — suggestions", () => {
  it("every suggestion has non-empty title and prompt", async () => {
    for (const agent of await readAgentsConfig()) {
      for (const s of agent.suggestions) {
        expect(s.title, `${agent.name}: suggestion title empty`).toBeTruthy();
        expect(s.prompt, `${agent.name}: suggestion prompt empty`).toBeTruthy();
      }
    }
  });

  it("suggestion titles within each agent are unique", async () => {
    for (const agent of await readAgentsConfig()) {
      const titles = agent.suggestions.map((s) => s.title);
      expect(new Set(titles).size, `${agent.name}: duplicate suggestion titles`).toBe(
        titles.length,
      );
    }
  });
});
