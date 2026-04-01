import { describe, expect, it } from "vitest";
import { buildGraph } from "../workflow-panel";

// buildGraph is tested in isolation — no React rendering required.

describe("buildGraph", () => {
  it("creates a start circle node and one progress node", () => {
    const entries = [
      { message: "Starting", artifacts: {} },
      { message: "Step A", artifacts: {} },
    ];
    const { nodes, edges } = buildGraph(entries);
    expect(nodes).toHaveLength(2);
    expect(nodes[0].type).toBe("circle");
    expect(nodes[1].type).toBe("progress");
    expect(edges).toHaveLength(1);
    expect(edges[0].source).toBe("node-0");
    expect(edges[0].target).toBe("node-1");
  });

  it("deduplicates a repeated progress node and links to existing", () => {
    const entries = [
      { message: "Starting", artifacts: {} },
      { message: "Step A", artifacts: {} },
      { message: "Step A", artifacts: {} }, // duplicate
    ];
    const { nodes, edges } = buildGraph(entries);
    // Only 2 nodes: start circle + Step A (no duplicate)
    expect(nodes).toHaveLength(2);
    // Only 1 edge: start->Step A; the duplicate causes a self-loop which is skipped
    expect(edges).toHaveLength(1);
    expect(edges[0].source).toBe("node-0");
    expect(edges[0].target).toBe("node-1");
  });

  it("deduplicates edge when same source->target appears twice", () => {
    const entries = [
      { message: "Starting", artifacts: {} },
      { message: "Step A", artifacts: {} },
      { message: "Step B", artifacts: {} },
      { message: "Step A", artifacts: {} }, // back to Step A — edge node-2->node-1 is new, but node-1 exists
    ];
    const { nodes, edges } = buildGraph(entries);
    // 3 unique nodes: start, Step A, Step B
    expect(nodes).toHaveLength(3);
    // Edges: start->A, A->B, B->A (new edge, not a duplicate)
    expect(edges).toHaveLength(3);
  });

  it("skips self-loop edges when consecutive duplicates appear", () => {
    const entries = [
      { message: "Starting", artifacts: {} },
      { message: "Step A", artifacts: {} },
      { message: "Step A", artifacts: {} }, // duplicate — self-loop skipped
      { message: "Step A", artifacts: {} }, // same again — self-loop skipped
    ];
    const { nodes, edges } = buildGraph(entries);
    expect(nodes).toHaveLength(2); // start + Step A
    expect(edges).toHaveLength(1); // only start->A once; all self-loops skipped
  });

  it("appends completed circle node without duplication", () => {
    const entries = [
      { message: "Starting", artifacts: {} },
      { message: "Step A", artifacts: {} },
      { message: "Completed", artifacts: {}, isCompleted: true },
    ];
    const { nodes, edges } = buildGraph(entries);
    expect(nodes).toHaveLength(3);
    expect(nodes[2].type).toBe("circle");
    expect(edges).toHaveLength(2);
  });

  it("sets isLast=true on an existing node when its duplicate is the final entry", () => {
    const entries = [
      { message: "Starting", artifacts: {} },
      { message: "Step A", artifacts: {} },
      { message: "Step A", artifacts: {} }, // duplicate is the last entry
    ];
    const { nodes } = buildGraph(entries);
    const stepA = nodes.find((n) => (n.data as { message?: string }).message === "Step A");
    expect(stepA).toBeDefined();
    expect((stepA!.data as { isLast: boolean }).isLast).toBe(true);
  });

  it("treats same message with different artifacts as distinct nodes", () => {
    const entries = [
      { message: "Starting", artifacts: {} as Record<string, string> },
      { message: "Step A", artifacts: { file: "foo.ts" } },
      { message: "Step A", artifacts: { file: "bar.ts" } }, // different artifacts — not a duplicate
    ];
    const { nodes, edges } = buildGraph(entries);
    expect(nodes).toHaveLength(3); // start + Step A (foo) + Step A (bar)
    expect(edges).toHaveLength(2);
  });

  it("treats same message with identical artifacts as a duplicate node", () => {
    const entries = [
      { message: "Starting", artifacts: {} as Record<string, string> },
      { message: "Step A", artifacts: { file: "foo.ts" } },
      { message: "Step A", artifacts: { file: "foo.ts" } }, // same message + same artifacts
    ];
    const { nodes, edges } = buildGraph(entries);
    expect(nodes).toHaveLength(2); // start + Step A (deduplicated)
    expect(edges).toHaveLength(1);
  });

  it("does not mark existing node isLast when duplicate is not the final entry", () => {
    const entries = [
      { message: "Starting", artifacts: {} },
      { message: "Step A", artifacts: {} },
      { message: "Step A", artifacts: {} }, // duplicate but NOT last
      { message: "Step B", artifacts: {} },
    ];
    const { nodes } = buildGraph(entries);
    const stepA = nodes.find((n) => (n.data as { message?: string }).message === "Step A");
    expect(stepA).toBeDefined();
    expect((stepA!.data as { isLast: boolean }).isLast).toBe(false);
  });
});
