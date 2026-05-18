import { describe, expect, it } from "vitest";

import { decomposeReu, gaussianKdeDensity } from "./reuDecomposition";

describe("decomposeReu", () => {
  it("returns zeros for fewer than 3 pairs", () => {
    expect(decomposeReu([{ reference: 10, sensor: 12 }]).n).toBe(1);
    expect(decomposeReu([]).points).toHaveLength(0);
  });

  it("attributes positive systematic variance when the slope is biased", () => {
    const pairs = Array.from({ length: 30 }, (_, i) => ({ reference: i + 1, sensor: 2 * (i + 1) }));
    const out = decomposeReu(pairs);
    expect(out.slope).toBeCloseTo(2, 6);
    for (const point of out.points) {
      expect(point.systematic).toBeGreaterThan(0);
      expect(point.random).toBeGreaterThanOrEqual(0);
    }
  });

  it("counts points below the DQO threshold when one is supplied", () => {
    const pairs = Array.from({ length: 20 }, (_, i) => ({ reference: i + 1, sensor: i + 1 + (i % 2 === 0 ? 0.01 : -0.01) }));
    const out = decomposeReu(pairs, { dqoThresholdPercent: 30 });
    expect(out.pointsBelowDqo).toBeGreaterThan(0);
  });
});

describe("gaussianKdeDensity", () => {
  it("returns equal density at every point on a uniform grid", () => {
    const points = [
      { x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 0 }, { x: 1, y: 1 },
    ];
    const out = gaussianKdeDensity(points);
    expect(out).toHaveLength(4);
    const first = out[0].density;
    for (const point of out) expect(Math.abs(point.density - first)).toBeLessThan(1e-9);
  });

  it("returns higher density near a cluster than at an outlier", () => {
    const cluster = Array.from({ length: 30 }, (_, i) => ({ x: i % 5, y: Math.floor(i / 5) }));
    const points = [...cluster, { x: 100, y: 100 }];
    const out = gaussianKdeDensity(points);
    const outlier = out[out.length - 1];
    const insider = out[Math.floor(cluster.length / 2)];
    expect(insider.density).toBeGreaterThan(outlier.density);
  });
});
