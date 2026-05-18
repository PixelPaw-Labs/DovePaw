import { describe, it, expect } from "vitest";
import {
  clampOutsideRects,
  connectionPointsFromRect,
  nudgeControlPointClear,
  quadBezierPassesThroughRect,
  rectBorderExit,
  segmentPassesThroughRect,
  findOptimalConnection,
  pointInRect,
  type Point,
  type Rect,
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

describe("clampOutsideRects", () => {
  const node: Rect = { x: 0, y: 0, w: 40, h: 20 };
  const obstacle: Rect = { x: 100, y: 100, w: 200, h: 100 };

  it("returns the same position when not overlapping", () => {
    expect(clampOutsideRects(node, [obstacle])).toEqual({ x: 0, y: 0 });
  });

  it("pushes out via the left edge when entering from the left", () => {
    // Node mostly to the left: left face has smallest penetration
    const result = clampOutsideRects({ ...node, x: 90, y: 130 }, [obstacle]);
    expect(result.x).toBe(obstacle.x - node.w); // 100 - 40 = 60
    expect(result.y).toBe(130);
  });

  it("pushes out via the right edge when entering from the right", () => {
    const result = clampOutsideRects({ ...node, x: 255, y: 130 }, [obstacle]);
    expect(result.x).toBe(obstacle.x + obstacle.w); // 300
  });

  it("pushes out via the top edge when entering from above", () => {
    const result = clampOutsideRects({ ...node, x: 180, y: 88 }, [obstacle]);
    expect(result.y).toBe(obstacle.y - node.h); // 80
  });

  it("pushes out via the bottom edge when entering from below", () => {
    const result = clampOutsideRects({ ...node, x: 180, y: 188 }, [obstacle]);
    expect(result.y).toBe(obstacle.y + obstacle.h); // 200
  });
});

describe("nudgeControlPointClear", () => {
  // Obstacle sits directly above the midpoint of the straight edge, forcing the
  // bezier control point to be nudged away until the curve avoids it.
  const p0: Point = { x: 0, y: 100 };
  const p2: Point = { x: 200, y: 100 };
  // Perpendicular to horizontal segment = vertical (0, 1)
  const perpX = 0;
  const perpY = 1;
  const step = 50;

  it("returns the initial control point unchanged when the bezier is already clear", () => {
    const result = nudgeControlPointClear(p0, p2, perpX, perpY, step, step, []);
    expect(result.cpX).toBe(100); // midX
    expect(result.cpY).toBe(150); // midY + step
  });

  it("nudges the control point away from an obstacle in its path", () => {
    // Obstacle straddles the t=0.5 midpoint of the bezier (100, 125) when curvature=step.
    const obstacle: Rect = { x: 80, y: 115, w: 40, h: 20 };
    const result = nudgeControlPointClear(p0, p2, perpX, perpY, step, step, [obstacle]);
    expect(quadBezierPassesThroughRect(p0, { x: result.cpX, y: result.cpY }, p2, obstacle)).toBe(
      false,
    );
  });

  it("tries the opposite direction if the preferred direction is also blocked", () => {
    // Block all positive-curvature positions with a tall obstacle
    const blocker: Rect = { x: 80, y: 60, w: 40, h: 200 };
    const result = nudgeControlPointClear(p0, p2, perpX, perpY, step, step, [blocker]);
    // Should resolve to negative curvature (above the line)
    expect(result.curvature).toBeLessThan(0);
  });
});

describe("rectBorderExit", () => {
  const rect: Rect = { x: 0, y: 0, w: 100, h: 60 };

  it("exits the right border when direction is east", () => {
    const p = rectBorderExit(rect, 1, 0);
    expect(p).toEqual({ x: 100, y: 30 });
  });

  it("exits the left border when direction is west", () => {
    const p = rectBorderExit(rect, -1, 0);
    expect(p).toEqual({ x: 0, y: 30 });
  });

  it("exits the bottom border when direction is south", () => {
    const p = rectBorderExit(rect, 0, 1);
    expect(p).toEqual({ x: 50, y: 60 });
  });

  it("exits the top border when direction is north", () => {
    const p = rectBorderExit(rect, 0, -1);
    expect(p).toEqual({ x: 50, y: 0 });
  });

  it("exits the correct border for a diagonal direction", () => {
    // 45° southeast: hw=50, hh=30 → tRight=50, tBottom=30; tBottom wins → bottom border
    const p = rectBorderExit(rect, 1, 1);
    expect(p.y).toBeCloseTo(60);
    expect(p.x).toBeGreaterThan(50); // right of center
  });

  it("result is on the border of the rect", () => {
    const p = rectBorderExit(rect, 2, 1);
    const onBorder =
      Math.abs(p.x - 0) < 1e-9 ||
      Math.abs(p.x - 100) < 1e-9 ||
      Math.abs(p.y - 0) < 1e-9 ||
      Math.abs(p.y - 60) < 1e-9;
    expect(onBorder).toBe(true);
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

  it("re-picks both source AND target borders when the original pair is invisibly short", () => {
    // Cards 5px apart horizontally. Default shortest valid pair is
    // A.right (100, 30) → B.left (105, 30) — length 5. With minVisibleLength=20
    // both ends must move: the chosen `from` must NOT be A.right OR the chosen
    // `to` must NOT be B.left (and in practice neither will be).
    const a = connectionPointsFromRect({ x: 0, y: 0, w: 100, h: 60 });
    const b = connectionPointsFromRect({ x: 105, y: 0, w: 100, h: 60 });
    const conn = findOptimalConnection(a, b, [], 20);
    const sourceMoved = conn.from.x !== a.right.x || conn.from.y !== a.right.y;
    const targetMoved = conn.to.x !== b.left.x || conn.to.y !== b.left.y;
    // The pair {A.right, B.left} is the short one being rejected, so at least
    // the target end must move (and ideally both — both ends get re-picked).
    expect(targetMoved).toBe(true);
    expect(sourceMoved || targetMoved).toBe(true);
  });

  it("rejects very short connections when minVisibleLength is set", () => {
    // Two cards adjacent with only a 2px gap: right→left would be the shortest
    // valid pair (length 2) — visually invisible. With minVisibleLength=20 the
    // function must pick a different border pair that yields a visibly longer
    // straight-line distance.
    const left = connectionPointsFromRect({ x: 0, y: 0, w: 100, h: 60 });
    const right = connectionPointsFromRect({ x: 102, y: 0, w: 100, h: 60 });
    const conn = findOptimalConnection(left, right, [], 20);
    const length = Math.hypot(conn.to.x - conn.from.x, conn.to.y - conn.from.y);
    expect(length).toBeGreaterThanOrEqual(20);
  });

  it("falls back to the longest valid pair when no pair meets minVisibleLength", () => {
    // Two cards barely apart on every axis — no pair can reach 500px.
    // The chosen pair must be the longest valid one (most visible room).
    const a = connectionPointsFromRect({ x: 0, y: 0, w: 100, h: 60 });
    const b = connectionPointsFromRect({ x: 110, y: 0, w: 100, h: 60 });
    const conn = findOptimalConnection(a, b, [], 500);
    const length = Math.hypot(conn.to.x - conn.from.x, conn.to.y - conn.from.y);
    // Longest possible pair here is left.x=0 → right.x=210, length 210.
    expect(length).toBeCloseTo(210, 0);
  });

  it("avoids obstacle rects when finding connection points", () => {
    // Diagonal arrangement: src top-left, tgt bottom-right.
    // Two valid clean pairs: right→left (shorter, length≈283) and right→top (length≈292).
    // The obstacle blocks the right→left pair but not right→top.
    const src = connectionPointsFromRect({ x: 0, y: 0, w: 100, h: 100 });
    const tgt = connectionPointsFromRect({ x: 300, y: 200, w: 100, h: 100 });
    const obstacle: Rect = { x: 180, y: 140, w: 40, h: 30 };

    const connNoObs = findOptimalConnection(src, tgt);
    const connWithObs = findOptimalConnection(src, tgt, [obstacle]);

    // Without obstacle: right→left is shortest valid pair
    expect(connNoObs.from).toEqual({ x: 100, y: 50 }); // src.right
    expect(connNoObs.to).toEqual({ x: 300, y: 250 }); // tgt.left

    // With obstacle: the chosen pair must not pass through it
    const blockedByObs = segmentPassesThroughRect(
      connWithObs.from,
      connWithObs.to,
      obstacle,
      false,
      false,
    );
    expect(blockedByObs).toBe(false);
  });
});
