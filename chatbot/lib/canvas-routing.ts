/**
 * Pure geometry helpers for routing edges between rectangular nodes on a canvas.
 * No framework dependencies — safe to import in any environment.
 */

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

export type ConnectionPoints = {
  top: Point;
  right: Point;
  bottom: Point;
  left: Point;
};

export function connectionPointsFromRect(r: Rect): ConnectionPoints {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  return {
    top: { x: cx, y: r.y },
    right: { x: r.x + r.w, y: cy },
    bottom: { x: cx, y: r.y + r.h },
    left: { x: r.x, y: cy },
  };
}

/**
 * Liang-Barsky line-rectangle intersection test.
 * Returns true if the segment P1→P2 passes through the rect's interior.
 * excludeStart / excludeEnd skip a small epsilon at each endpoint so that a
 * point sitting exactly on the border does not count as "intersecting".
 */
export function segmentPassesThroughRect(
  p1: Point,
  p2: Point,
  rect: Rect,
  excludeStart: boolean,
  excludeEnd: boolean,
): boolean {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  let tMin = 0;
  let tMax = 1;
  const edges: [number, number][] = [
    [-dx, p1.x - rect.x],
    [dx, rect.x + rect.w - p1.x],
    [-dy, p1.y - rect.y],
    [dy, rect.y + rect.h - p1.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) tMin = Math.max(tMin, t);
      else tMax = Math.min(tMax, t);
    }
    if (tMin > tMax) return false;
  }
  const eps = 1e-4;
  return tMax > (excludeStart ? eps : 0) && tMin < (excludeEnd ? 1 - eps : 1);
}

/**
 * From all 16 border-center pairs (4 × 4), filter those whose straight
 * segment does not pass through either card, then return the shortest valid
 * one. Falls back to the globally shortest if all pairs intersect a card.
 */
export function findOptimalConnection(
  from: ConnectionPoints,
  to: ConnectionPoints,
): { from: Point; to: Point } {
  const fromRect: Rect = {
    x: from.left.x,
    y: from.top.y,
    w: from.right.x - from.left.x,
    h: from.bottom.y - from.top.y,
  };
  const toRect: Rect = {
    x: to.left.x,
    y: to.top.y,
    w: to.right.x - to.left.x,
    h: to.bottom.y - to.top.y,
  };

  const fromPts = [from.top, from.right, from.bottom, from.left];
  const toPts = [to.top, to.right, to.bottom, to.left];
  const candidates = fromPts.flatMap((f) => toPts.map((t) => ({ from: f, to: t })));

  const valid = candidates.filter(
    (pair) =>
      !segmentPassesThroughRect(pair.from, pair.to, fromRect, true, false) &&
      !segmentPassesThroughRect(pair.from, pair.to, toRect, false, true),
  );

  const pool = valid.length > 0 ? valid : candidates;
  return pool.reduce((best, pair) =>
    Math.hypot(pair.to.x - pair.from.x, pair.to.y - pair.from.y) <
    Math.hypot(best.to.x - best.from.x, best.to.y - best.from.y)
      ? pair
      : best,
  );
}

export function pointInRect(p: Point, r: Rect): boolean {
  return p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
}
