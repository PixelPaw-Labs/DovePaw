import { describe, it, expect } from "vitest";
import { resolveLinkedTargets } from "../agent-links";
import type { AgentLink } from "../agent-links-schemas";
import { agentLinkSchema, AGENT_LINK_STRATEGIES } from "../agent-links-schemas";

// ─── agentLinkSchema ──────────────────────────────────────────────────────────

describe("agentLinkSchema", () => {
  it("defaults strategy to parallel", () => {
    const result = agentLinkSchema.parse({ source: "a", target: "b", direction: "single" });
    expect(result.strategy).toBe("parallel");
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
  strategy: "parallel",
});

describe("resolveLinkedTargets", () => {
  it("returns target for a single link where agent is source", () => {
    const links = [link("a", "b")];
    expect(resolveLinkedTargets("a", links)).toEqual([{ targetName: "b", strategy: "parallel" }]);
  });

  it("does not return target for a single link where agent is target (not source)", () => {
    const links = [link("a", "b")];
    expect(resolveLinkedTargets("b", links)).toEqual([]);
  });

  it("returns source for a dual link where agent is target", () => {
    const links = [link("a", "b", "dual")];
    expect(resolveLinkedTargets("b", links)).toEqual([{ targetName: "a", strategy: "parallel" }]);
  });

  it("returns both directions for a dual link", () => {
    const links = [link("a", "b", "dual")];
    const fromA = resolveLinkedTargets("a", links);
    const fromB = resolveLinkedTargets("b", links);
    expect(fromA).toEqual([{ targetName: "b", strategy: "parallel" }]);
    expect(fromB).toEqual([{ targetName: "a", strategy: "parallel" }]);
  });

  it("preserves strategy on resolved link", () => {
    const links: AgentLink[] = [
      { source: "a", target: "b", direction: "single", strategy: "review" },
    ];
    expect(resolveLinkedTargets("a", links)).toEqual([{ targetName: "b", strategy: "review" }]);
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
