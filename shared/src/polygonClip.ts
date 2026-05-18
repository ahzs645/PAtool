// ---------------------------------------------------------------------------
// polygonClip — Liang–Barsky line clipping against axis-aligned rectangles,
// plus Sutherland–Hodgman polygon clipping against an arbitrary convex
// rectangular envelope. Used by ASNAT-style state/county/tribe boundary
// subsetting workflows.
//
// All routines are pure functions on plain `[number, number]` (lon, lat or
// x, y) tuples. Coordinate system is assumed Cartesian — for lat/lon you
// should reproject first if precision matters at high latitudes.
// ---------------------------------------------------------------------------

export type Point = readonly [number, number];
export type Polygon = readonly Point[];
export type RectBounds = {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
};

/**
 * Liang–Barsky line clipping. Returns the clipped segment endpoints
 * `[a, b]`, or `null` if the segment lies entirely outside the bounds.
 */
export function clipSegmentLiangBarsky(
  a: Point,
  b: Point,
  bounds: RectBounds,
): [Point, Point] | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const p = [-dx, dx, -dy, dy];
  const q = [a[0] - bounds.xMin, bounds.xMax - a[0], a[1] - bounds.yMin, bounds.yMax - a[1]];
  let tEnter = 0;
  let tExit = 1;
  for (let i = 0; i < 4; i += 1) {
    if (p[i] === 0) {
      if (q[i] < 0) return null;
      continue;
    }
    const t = q[i] / p[i];
    if (p[i] < 0) {
      if (t > tExit) return null;
      if (t > tEnter) tEnter = t;
    } else {
      if (t < tEnter) return null;
      if (t < tExit) tExit = t;
    }
  }
  return [
    [a[0] + tEnter * dx, a[1] + tEnter * dy],
    [a[0] + tExit * dx, a[1] + tExit * dy],
  ];
}

/**
 * Sutherland–Hodgman clip of a polygon against an axis-aligned rectangle.
 * Input polygon may be open or closed; output is open (no repeated last
 * vertex). Handles both ccw and cw winding orders.
 */
export function clipPolygonToRectBounds(polygon: Polygon, bounds: RectBounds): Point[] {
  const edges: Array<(point: Point) => boolean> = [
    (point) => point[0] >= bounds.xMin,
    (point) => point[0] <= bounds.xMax,
    (point) => point[1] >= bounds.yMin,
    (point) => point[1] <= bounds.yMax,
  ];
  const intersectAt: Array<(a: Point, b: Point) => Point> = [
    (a, b) => intersectVertical(a, b, bounds.xMin),
    (a, b) => intersectVertical(a, b, bounds.xMax),
    (a, b) => intersectHorizontal(a, b, bounds.yMin),
    (a, b) => intersectHorizontal(a, b, bounds.yMax),
  ];

  let output: Point[] = stripClosingDuplicate(polygon);
  for (let edgeIdx = 0; edgeIdx < edges.length; edgeIdx += 1) {
    if (output.length === 0) break;
    const inputRing = output;
    output = [];
    const inside = edges[edgeIdx];
    const intersect = intersectAt[edgeIdx];
    for (let i = 0; i < inputRing.length; i += 1) {
      const current = inputRing[i];
      const previous = inputRing[(i - 1 + inputRing.length) % inputRing.length];
      const currentInside = inside(current);
      const previousInside = inside(previous);
      if (currentInside) {
        if (!previousInside) output.push(intersect(previous, current));
        output.push(current);
      } else if (previousInside) {
        output.push(intersect(previous, current));
      }
    }
  }
  return output;
}

function intersectVertical(a: Point, b: Point, x: number): Point {
  const t = (x - a[0]) / (b[0] - a[0]);
  return [x, a[1] + t * (b[1] - a[1])];
}

function intersectHorizontal(a: Point, b: Point, y: number): Point {
  const t = (y - a[1]) / (b[1] - a[1]);
  return [a[0] + t * (b[0] - a[0]), y];
}

function stripClosingDuplicate(polygon: Polygon): Point[] {
  if (polygon.length < 2) return [...polygon];
  const first = polygon[0];
  const last = polygon[polygon.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return polygon.slice(0, -1);
  return [...polygon];
}

/**
 * Returns true if a point lies within an axis-aligned rectangle (inclusive).
 */
export function pointInRectBounds(point: Point, bounds: RectBounds): boolean {
  return (
    point[0] >= bounds.xMin
    && point[0] <= bounds.xMax
    && point[1] >= bounds.yMin
    && point[1] <= bounds.yMax
  );
}

/**
 * Even–odd point-in-polygon test on `[x, y]` tuples (Cartesian).
 * For GeoPoint lon/lat input, use `pointInPolygon` from `./geo`.
 */
export function pointInPolygonXy(point: Point, polygon: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const crosses = ((yi > point[1]) !== (yj > point[1]))
      && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi + 1e-12) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}
