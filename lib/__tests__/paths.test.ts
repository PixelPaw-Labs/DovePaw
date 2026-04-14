import { describe, it, expect, vi } from "vitest";

vi.mock("node:fs", () => ({
  mkdirSync: vi.fn(),
}));

describe("agentDistScript", () => {
  it("points to dist/agents/<name>.mjs", async () => {
    const { agentDistScript } = await import("../paths.js");
    const result = agentDistScript("blog-writer");
    expect(result).toMatch(/dist[/\\]agents[/\\]blog-writer\.mjs$/);
  });
});
