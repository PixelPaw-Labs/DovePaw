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
 * segment does not pass through either card or any obstacle rect, then
 * return the shortest valid one. Falls back to the globally shortest if
 * all pairs intersect a card.
 */
export function findOptimalConnection(
  from: ConnectionPoints,
  to: ConnectionPoints,
  obstacles: Rect[] = [],
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
      !segmentPassesThroughRect(pair.from, pair.to, toRect, false, true) &&
      obstacles.every((obs) => !segmentPassesThroughRect(pair.from, pair.to, obs, false, false)),
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

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * Clamp a rect (given by its top-left corner in `node`) so it does not overlap
 * any rect in `obstacles`. Each overlapping obstacle is resolved via the
 * minimum-penetration axis so the rect slides along the nearest edge.
 * Returns the (possibly adjusted) top-left position.
 */
export function clampOutsideRects(node: Rect, obstacles: Rect[]): { x: number; y: number } {
  let { x, y } = node;
  for (const obs of obstacles) {
    if (!rectsOverlap({ x, y, w: node.w, h: node.h }, obs)) continue;
    const ol = x + node.w - obs.x;
    const or_ = obs.x + obs.w - x;
    const ot = y + node.h - obs.y;
    const ob = obs.y + obs.h - y;
    const min = Math.min(ol, or_, ot, ob);
    if (min === ol) x = obs.x - node.w;
    else if (min === or_) x = obs.x + obs.w;
    else if (min === ot) y = obs.y - node.h;
    else y = obs.y + obs.h;
  }
  return { x, y };
}

/**
 * Given a quadratic bezier from p0 to p2 with its control point positioned by
 * `initialCurvature` along the perpendicular (perpX, perpY), nudge the
 * curvature until the arc no longer passes through any obstacle rect.
 * Tries increasing magnitude in the current direction first (mult 2…6×step),
 * then flips to the opposite direction if still blocked.
 * Returns the resolved control point and curvature (unchanged if already clear).
 */
export function nudgeControlPointClear(
  p0: Point,
  p2: Point,
  perpX: number,
  perpY: number,
  initialCurvature: number,
  step: number,
  obstacles: Rect[],
): { cpX: number; cpY: number; curvature: number } {
  const midX = (p0.x + p2.x) / 2;
  const midY = (p0.y + p2.y) / 2;
  const cp = (c: number) => ({ cpX: midX + perpX * c, cpY: midY + perpY * c });
  const clear = (cx: number, cy: number) =>
    !obstacles.some((r) => quadBezierPassesThroughRect(p0, { x: cx, y: cy }, p2, r));

  let { cpX, cpY } = cp(initialCurvature);
  if (clear(cpX, cpY)) return { cpX, cpY, curvature: initialCurvature };

  const baseSign = initialCurvature >= 0 ? 1 : -1;
  for (let mult = 2; mult <= 6; mult++) {
    const c = baseSign * step * mult;
    ({ cpX, cpY } = cp(c));
    if (clear(cpX, cpY)) return { cpX, cpY, curvature: c };
  }
  for (let mult = 1; mult <= 6; mult++) {
    const c = -baseSign * step * mult;
    ({ cpX, cpY } = cp(c));
    if (clear(cpX, cpY)) return { cpX, cpY, curvature: c };
  }
  // Fallback: return the last tried position (opposite direction, max mult).
  return { cpX, cpY, curvature: -baseSign * step * 6 };
}

/**
 * Sample a quadratic bezier at `steps` interior points and return true if
 * any sample lands inside the given rect. Used to check if a curved edge
 * passes through a node card.
 */
export function quadBezierPassesThroughRect(
  p0: Point,
  cp: Point,
  p2: Point,
  rect: Rect,
  steps = 12,
): boolean {
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const x = mt * mt * p0.x + 2 * mt * t * cp.x + t * t * p2.x;
    const y = mt * mt * p0.y + 2 * mt * t * cp.y + t * t * p2.y;
    if (pointInRect({ x, y }, rect)) return true;
  }
  return false;
}
