import { describe, it, expect } from "vitest";
import { ESCALATE_PATTERNS, HANDOFF_PATTERNS, REVIEW_PATTERNS } from "./agent-link-patterns";

describe("HANDOFF_PATTERNS", () => {
  it("includes sequential delegation patterns", () => {
    const text = HANDOFF_PATTERNS();
    expect(text).toContain("Detection → Resolution");
    expect(text).toContain("Aggregation → Action");
    expect(text).toContain("Phase handoff");
    expect(text).toContain("Blocked by gap");
  });

  it("includes Pipeline in sequential delegation section", () => {
    const text = HANDOFF_PATTERNS();
    const sequentialSection = text.slice(0, text.indexOf("Organisational patterns"));
    expect(sequentialSection).toContain("Pipeline");
  });

  it("includes Coordination in organisational patterns section", () => {
    const text = HANDOFF_PATTERNS();
    const organisationalSection = text.slice(text.indexOf("Organisational patterns"));
    expect(organisationalSection).toContain("Coordination");
    expect(organisationalSection).toContain("orchestrator");
  });

  it("includes all organisational patterns", () => {
    const text = HANDOFF_PATTERNS();
    expect(text).toContain("Parallel fan-out");
    expect(text).toContain("Peer review");
    expect(text).toContain("Escalation");
    expect(text).toContain("Expert routing");
  });

  it("interpolates agentName into When/When not sections", () => {
    const text = HANDOFF_PATTERNS("MyAgent");
    expect(text).toContain("MyAgent");
    expect(text).toContain("When:");
    expect(text).toContain("When not:");
  });

  it("uses generic language when no agentName provided", () => {
    const text = HANDOFF_PATTERNS();
    expect(text).toContain("the target agent");
  });
});

describe("ESCALATE_PATTERNS", () => {
  it("has When and When not sections", () => {
    const text = ESCALATE_PATTERNS();
    expect(text).toContain("When:");
    expect(text).toContain("When not:");
  });

  it("interpolates agentName", () => {
    const text = ESCALATE_PATTERNS("Supervisor");
    expect(text).toContain("Supervisor");
  });

  it("includes core escalation triggers", () => {
    const text = ESCALATE_PATTERNS();
    expect(text).toContain("confidence or authority");
    expect(text).toContain("sign-off");
  });
});

describe("REVIEW_PATTERNS", () => {
  it("has When and When not sections", () => {
    const text = REVIEW_PATTERNS();
    expect(text).toContain("When:");
    expect(text).toContain("When not:");
  });

  it("interpolates agentName", () => {
    const text = REVIEW_PATTERNS("Reviewer");
    expect(text).toContain("Reviewer");
  });

  it("requires work to be complete before review", () => {
    const text = REVIEW_PATTERNS();
    expect(text).toContain("fully complete");
  });
});
