import { describe, expect, it } from "vitest";

import { liangBarskyPolyline, liangBarskySegment, pointInPolygon, polygonBoundingRect } from "./polygonClip";

const window = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

describe("polygon clipping", () => {
  it("clips a partially-inside segment", () => {
    const seg = liangBarskySegment({ x: -2, y: 5 }, { x: 12, y: 5 }, window);
    expect(seg).not.toBeNull();
    expect(seg!.a.x).toBeCloseTo(0);
    expect(seg!.b.x).toBeCloseTo(10);
  });

  it("returns null for a segment outside the window", () => {
    const seg = liangBarskySegment({ x: -5, y: -5 }, { x: -1, y: -1 }, window);
    expect(seg).toBeNull();
  });

  it("clips a polyline crossing the window edges into segments", () => {
    const out = liangBarskyPolyline(
      [{ x: -5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: -5 }, { x: 15, y: 5 }],
      window,
    );
    expect(out.length).toBeGreaterThan(0);
  });

  it("pointInPolygon works for a triangle", () => {
    const tri = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }];
    expect(pointInPolygon({ x: 5, y: 2 }, tri)).toBe(true);
    expect(pointInPolygon({ x: 20, y: 20 }, tri)).toBe(false);
  });

  it("polygonBoundingRect returns extremes", () => {
    const rect = polygonBoundingRect([{ x: -1, y: -2 }, { x: 5, y: 6 }, { x: 3, y: -3 }]);
    expect(rect).toEqual({ minX: -1, minY: -3, maxX: 5, maxY: 6 });
  });
});
