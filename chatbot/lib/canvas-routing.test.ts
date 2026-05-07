import { describe, it, expect } from "vitest";
import {
  connectionPointsFromRect,
  segmentPassesThroughRect,
  findOptimalConnection,
  pointInRect,
} from "./canvas-routing";

describe("connectionPointsFromRect", () => {
  it("computes correct midpoints for each side", () => {
    const pts = connectionPointsFromRect({ x: 0, y: 0, w: 100, h: 60 });
    expect(pts.top).toEqual({ x: 50, y: 0 });
    expect(pts.right).toEqual({ x: 100, y: 30 });
    expect(pts.bottom).toEqual({ x: 50, y: 60 });
    expect(pts.left).toEqual({ x: 0, y: 30 });
  });

  it("handles non-zero origin", () => {
    const pts = connectionPointsFromRect({ x: 10, y: 20, w: 80, h: 40 });
    expect(pts.top).toEqual({ x: 50, y: 20 });
    expect(pts.left).toEqual({ x: 10, y: 40 });
    expect(pts.right).toEqual({ x: 90, y: 40 });
    expect(pts.bottom).toEqual({ x: 50, y: 60 });
  });
});

describe("pointInRect", () => {
  const r = { x: 10, y: 10, w: 80, h: 60 };

  it("returns true for interior points", () => {
    expect(pointInRect({ x: 50, y: 40 }, r)).toBe(true);
  });

  it("returns false for points on the border", () => {
    expect(pointInRect({ x: 10, y: 40 }, r)).toBe(false);
    expect(pointInRect({ x: 90, y: 40 }, r)).toBe(false);
  });

  it("returns false for exterior points", () => {
    expect(pointInRect({ x: 0, y: 0 }, r)).toBe(false);
    expect(pointInRect({ x: 200, y: 200 }, r)).toBe(false);
  });
});

describe("segmentPassesThroughRect", () => {
  const rect = { x: 40, y: 40, w: 20, h: 20 }; // 40–60 × 40–60

  it("detects a segment passing through rect interior", () => {
    expect(segmentPassesThroughRect({ x: 0, y: 50 }, { x: 100, y: 50 }, rect, false, false)).toBe(
      true,
    );
  });

  it("returns false for segment entirely outside", () => {
    expect(segmentPassesThroughRect({ x: 0, y: 0 }, { x: 10, y: 10 }, rect, false, false)).toBe(
      false,
    );
  });

  it("respects excludeStart epsilon so a segment starting on border does not count", () => {
    // segment starts exactly at left border midpoint (40, 50) and goes right
    const result = segmentPassesThroughRect({ x: 40, y: 50 }, { x: 100, y: 50 }, rect, true, false);
    // with excludeStart=true the tiny eps at start is excluded; still passes through interior
    expect(result).toBe(true);
  });
});

describe("findOptimalConnection", () => {
  it("returns a pair of points whose source and target are on the correct sides", () => {
    // Two rects side by side: left at (0,0 100×60), right at (200,0 100×60)
    const left = connectionPointsFromRect({ x: 0, y: 0, w: 100, h: 60 });
    const right = connectionPointsFromRect({ x: 200, y: 0, w: 100, h: 60 });

    const conn = findOptimalConnection(left, right);
    // Optimal path should exit the left rect on its right side (x=100)
    // and enter the right rect on its left side (x=200)
    expect(conn.from.x).toBe(100); // right edge of left node
    expect(conn.to.x).toBe(200); // left edge of right node
  });

  it("returns shortest valid pair", () => {
    const top = connectionPointsFromRect({ x: 50, y: 0, w: 100, h: 60 });
    const bottom = connectionPointsFromRect({ x: 50, y: 160, w: 100, h: 60 });
    const conn = findOptimalConnection(top, bottom);
    // Vertical arrangement: exit bottom of top node, enter top of bottom node
    expect(conn.from.y).toBe(60);
    expect(conn.to.y).toBe(160);
  });
});
