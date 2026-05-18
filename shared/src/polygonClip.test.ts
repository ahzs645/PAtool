import { describe, expect, it } from "vitest";

import {
  clipPolygonToRectBounds,
  clipSegmentLiangBarsky,
  pointInPolygonXy,
  pointInRectBounds,
  type Polygon,
  type RectBounds,
} from "./polygonClip";

const BOUNDS: RectBounds = { xMin: 0, yMin: 0, xMax: 10, yMax: 10 };

describe("Liang-Barsky line clipping", () => {
  it("returns the original segment when it lies entirely inside", () => {
    const out = clipSegmentLiangBarsky([1, 1], [4, 4], BOUNDS);
    expect(out).toEqual([[1, 1], [4, 4]]);
  });

  it("returns null when the segment lies entirely outside", () => {
    expect(clipSegmentLiangBarsky([-5, -5], [-1, -1], BOUNDS)).toBeNull();
  });

  it("clips a segment crossing the right edge", () => {
    const out = clipSegmentLiangBarsky([5, 5], [15, 5], BOUNDS);
    expect(out).not.toBeNull();
    expect(out![0]).toEqual([5, 5]);
    expect(out![1][0]).toBeCloseTo(10, 6);
    expect(out![1][1]).toBeCloseTo(5, 6);
  });
});

describe("Sutherland-Hodgman polygon clipping", () => {
  it("clips a square that straddles the right boundary", () => {
    const polygon: Polygon = [[5, 5], [15, 5], [15, 15], [5, 15]];
    const out = clipPolygonToRectBounds(polygon, BOUNDS);
    expect(out.length).toBeGreaterThanOrEqual(4);
    for (const point of out) {
      expect(point[0]).toBeLessThanOrEqual(10);
      expect(point[1]).toBeLessThanOrEqual(10);
    }
  });

  it("returns an empty polygon when the input is fully outside", () => {
    const polygon: Polygon = [[20, 20], [30, 20], [30, 30], [20, 30]];
    expect(clipPolygonToRectBounds(polygon, BOUNDS)).toEqual([]);
  });
});

describe("point-in-bounds / point-in-polygon (XY)", () => {
  it("treats the boundary as inclusive for axis-aligned bounds", () => {
    expect(pointInRectBounds([0, 0], BOUNDS)).toBe(true);
    expect(pointInRectBounds([10, 10], BOUNDS)).toBe(true);
    expect(pointInRectBounds([10.0001, 5], BOUNDS)).toBe(false);
  });

  it("supports the standard even-odd polygon test", () => {
    const triangle: Polygon = [[0, 0], [10, 0], [5, 10]];
    expect(pointInPolygonXy([5, 1], triangle)).toBe(true);
    expect(pointInPolygonXy([0, 5], triangle)).toBe(false);
  });
});
