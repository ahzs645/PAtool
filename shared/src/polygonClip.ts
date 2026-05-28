/**
 * Liang–Barsky polygon clipping ported from ASNAT_Utilities.cpp /
 * ASNAT_Utilities.R. Clips a subject polyline/polygon to a rectangular
 * window — useful for restricting sensor maps to state/county
 * bounding boxes. Also includes point-in-polygon for arbitrary polygons.
 */

export type Point2D = { x: number; y: number };

export type Rect = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

/** Clip a single segment (p1 → p2) to the rectangle. Returns null if outside. */
export function liangBarskySegment(
  p1: Point2D,
  p2: Point2D,
  rect: Rect,
): { a: Point2D; b: Point2D } | null {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  let t0 = 0;
  let t1 = 1;
  const ps = [-dx, dx, -dy, dy];
  const qs = [p1.x - rect.minX, rect.maxX - p1.x, p1.y - rect.minY, rect.maxY - p1.y];
  for (let i = 0; i < 4; i += 1) {
    const p = ps[i];
    const q = qs[i];
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  return {
    a: { x: p1.x + t0 * dx, y: p1.y + t0 * dy },
    b: { x: p1.x + t1 * dx, y: p1.y + t1 * dy },
  };
}

/** Clip a polyline to the rectangle. Returns one or more output sub-lines. */
export function liangBarskyPolyline(points: ReadonlyArray<Point2D>, rect: Rect): Point2D[][] {
  if (points.length < 2) return [];
  const out: Point2D[][] = [];
  let current: Point2D[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const seg = liangBarskySegment(points[i], points[i + 1], rect);
    if (!seg) {
      if (current.length > 0) {
        out.push(current);
        current = [];
      }
      continue;
    }
    if (current.length === 0 || !pointsEqual(current[current.length - 1], seg.a)) {
      if (current.length > 0) out.push(current);
      current = [seg.a, seg.b];
    } else {
      current.push(seg.b);
    }
  }
  if (current.length > 0) out.push(current);
  return out;
}

function pointsEqual(a: Point2D, b: Point2D): boolean {
  return Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
}

/**
 * Ray-casting point-in-polygon test for closed polygon (first point
 * NOT repeated as last). Returns true on boundary as well.
 */
export function pointInPolygon(point: Point2D, polygon: ReadonlyArray<Point2D>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect = ((yi > point.y) !== (yj > point.y))
      && (point.x < ((xj - xi) * (point.y - yi)) / (yj - yi || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Compute bounding box of a polygon. */
export function polygonBoundingRect(points: ReadonlyArray<Point2D>): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}
