import { describe, it, expect } from "vitest";
import { HANDOFF_PATTERNS } from "./agent-link-patterns";

describe("HANDOFF_PATTERNS", () => {
  it("includes sequential delegation patterns", () => {
    expect(HANDOFF_PATTERNS).toContain("Detection → Resolution");
    expect(HANDOFF_PATTERNS).toContain("Aggregation → Action");
    expect(HANDOFF_PATTERNS).toContain("Phase handoff");
    expect(HANDOFF_PATTERNS).toContain("Blocked by gap");
  });

  it("includes Pipeline in sequential delegation section", () => {
    const sequentialSection = HANDOFF_PATTERNS.slice(
      0,
      HANDOFF_PATTERNS.indexOf("Organisational patterns"),
    );
    expect(sequentialSection).toContain("Pipeline");
  });

  it("includes Coordination in organisational patterns section", () => {
    const organisationalSection = HANDOFF_PATTERNS.slice(
      HANDOFF_PATTERNS.indexOf("Organisational patterns"),
    );
    expect(organisationalSection).toContain("Coordination");
    expect(organisationalSection).toContain("orchestrator");
  });

  it("includes all organisational patterns", () => {
    expect(HANDOFF_PATTERNS).toContain("Parallel fan-out");
    expect(HANDOFF_PATTERNS).toContain("Peer review");
    expect(HANDOFF_PATTERNS).toContain("Escalation");
    expect(HANDOFF_PATTERNS).toContain("Expert routing");
  });
});
