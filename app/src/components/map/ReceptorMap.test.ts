import { describe, expect, it } from "vitest";
import { haversineKm } from "@pgmaps/geo-toolkit/calculations";

import { circlePolygon } from "./ReceptorMap";

describe("circlePolygon", () => {
  it("draws a closed ring at the requested distance", () => {
    const polygon = circlePolygon(-122.33, 47.6, 5, 32);
    const ring = polygon.coordinates[0];
    expect(ring).toHaveLength(33);
    expect(ring[0][0]).toBeCloseTo(ring[32][0], 9);
    expect(ring[0][1]).toBeCloseTo(ring[32][1], 9);
    for (const [lon, lat] of ring) {
      expect(haversineKm(47.6, -122.33, lat, lon)).toBeCloseTo(5, 3);
    }
  });
});
