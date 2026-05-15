import { describe, it, expect } from "vitest";
import { resolveLinkedTargets } from "../agent-links";
import type { AgentLink } from "../agent-links-schemas";
import {
  agentLinkSchema,
  agentLinksFileSchema,
  AGENT_LINK_STRATEGIES,
} from "../agent-links-schemas";

// ─── agentLinkSchema ──────────────────────────────────────────────────────────

describe("agentLinkSchema", () => {
  it("defaults strategy to chat", () => {
    const result = agentLinkSchema.parse({ source: "a", target: "b", direction: "single" });
    expect(result.strategy).toBe("chat");
  });

  it("accepts all valid strategies", () => {
    for (const strategy of AGENT_LINK_STRATEGIES) {
      const result = agentLinkSchema.parse({
        source: "a",
        target: "b",
        direction: "single",
        strategy,
      });
      expect(result.strategy).toBe(strategy);
    }
  });

  it("rejects unknown strategy", () => {
    const result = agentLinkSchema.safeParse({
      source: "a",
      target: "b",
      direction: "single",
      strategy: "sequential",
    });
    expect(result.success).toBe(false);
  });

  it("accepts optional group field", () => {
    const result = agentLinkSchema.parse({
      source: "a",
      target: "b",
      direction: "single",
      group: "Data Pipeline",
    });
    expect(result.group).toBe("Data Pipeline");
  });

  it("omits group when not provided", () => {
    const result = agentLinkSchema.parse({ source: "a", target: "b", direction: "single" });
    expect(result.group).toBeUndefined();
  });
});

// ─── agentLinksFileSchema ─────────────────────────────────────────────────────

describe("agentLinksFileSchema", () => {
  it("defaults groups to empty array when absent", () => {
    const result = agentLinksFileSchema.parse({ version: 1, links: [] });
    expect(result.groups).toEqual([]);
  });

  it("parses groups as {name, members} objects", () => {
    const result = agentLinksFileSchema.parse({
      version: 1,
      groups: [
        { name: "Review Chain", members: ["a", "b"] },
        { name: "Data Pipeline", members: [] },
      ],
      links: [],
    });
    expect(result.groups).toEqual([
      { name: "Review Chain", members: ["a", "b"], description: "" },
      { name: "Data Pipeline", members: [], description: "" },
    ]);
  });

  it("migrates legacy string-form groups to {name, members:[]} objects", () => {
    const result = agentLinksFileSchema.parse({
      version: 1,
      groups: ["Review Chain", "Data Pipeline"],
      links: [],
    });
    expect(result.groups).toEqual([
      { name: "Review Chain", members: [], description: "" },
      { name: "Data Pipeline", members: [], description: "" },
    ]);
  });

  it("parses old files without groups field (backward compat)", () => {
    const oldFile = JSON.parse(JSON.stringify({ version: 1, links: [] }));
    const result = agentLinksFileSchema.safeParse(oldFile);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.groups).toEqual([]);
  });

  it("parses links with group field", () => {
    const result = agentLinksFileSchema.parse({
      version: 1,
      groups: ["G1"],
      links: [{ source: "a", target: "b", direction: "single", group: "G1" }],
    });
    expect(result.links[0]?.group).toBe("G1");
  });
});

// ─── resolveLinkedTargets ─────────────────────────────────────────────────────

const link = (
  source: string,
  target: string,
  direction: "single" | "dual" = "single",
): AgentLink => ({
  source,
  target,
  direction,
  strategy: "chat",
  handoffScoreMin: 80,
  handoffScoreMax: 100,
});

describe("resolveLinkedTargets", () => {
  it("returns target for a single link where agent is source", () => {
    const links = [link("a", "b")];
    expect(resolveLinkedTargets("a", links)).toEqual([
      { targetName: "b", strategy: "chat", handoffScoreMin: 80, handoffScoreMax: 100 },
    ]);
  });

  it("does not return target for a single link where agent is target (not source)", () => {
    const links = [link("a", "b")];
    expect(resolveLinkedTargets("b", links)).toEqual([]);
  });

  it("returns source for a dual link where agent is target", () => {
    const links = [link("a", "b", "dual")];
    expect(resolveLinkedTargets("b", links)).toEqual([
      { targetName: "a", strategy: "chat", handoffScoreMin: 80, handoffScoreMax: 100 },
    ]);
  });

  it("returns both directions for a dual link", () => {
    const links = [link("a", "b", "dual")];
    const fromA = resolveLinkedTargets("a", links);
    const fromB = resolveLinkedTargets("b", links);
    expect(fromA).toEqual([
      { targetName: "b", strategy: "chat", handoffScoreMin: 80, handoffScoreMax: 100 },
    ]);
    expect(fromB).toEqual([
      { targetName: "a", strategy: "chat", handoffScoreMin: 80, handoffScoreMax: 100 },
    ]);
  });

  it("preserves strategy on resolved link", () => {
    const links: AgentLink[] = [
      {
        source: "a",
        target: "b",
        direction: "single",
        strategy: "review",
        handoffScoreMin: 80,
        handoffScoreMax: 100,
      },
    ];
    expect(resolveLinkedTargets("a", links)).toEqual([
      { targetName: "b", strategy: "review", handoffScoreMin: 80, handoffScoreMax: 100 },
    ]);
  });

  it("returns empty when agent has no links", () => {
    expect(resolveLinkedTargets("c", [link("a", "b")])).toEqual([]);
  });

  it("handles multiple links from the same agent", () => {
    const links = [link("a", "b"), link("a", "c")];
    const result = resolveLinkedTargets("a", links);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.targetName)).toEqual(["b", "c"]);
  });
});
