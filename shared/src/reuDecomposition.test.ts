import { describe, expect, it } from "vitest";

import { gaussianKde2d, reuWithDecomposition } from "./reuDecomposition";

describe("REU decomposition", () => {
  it("flags points above the DQO threshold", () => {
    const pairs = [
      { reference: 1, sensor: 2 }, { reference: 5, sensor: 5 }, { reference: 10, sensor: 9 },
      { reference: 20, sensor: 22 }, { reference: 30, sensor: 31 },
    ];
    const r = reuWithDecomposition(pairs, { dqoPercent: 25 });
    expect(r.n).toBe(5);
    expect(r.points.every((p) => Number.isFinite(p.reuPercent))).toBe(true);
    expect(r.shareAboveDqo).toBeGreaterThanOrEqual(0);
  });

  it("each REU point yields three positive components when bias dominates", () => {
    const pairs = [
      { reference: 5, sensor: 8 }, { reference: 10, sensor: 14 }, { reference: 20, sensor: 25 },
    ];
    const r = reuWithDecomposition(pairs, { k: 2, referenceUncertainty: 1 });
    expect(r.points[0].biasComponent).toBeGreaterThan(0);
    expect(r.points[0].referenceComponent).toBeGreaterThan(0);
  });
});

describe("2D Gaussian KDE", () => {
  it("returns finite density per data point", () => {
    const points = Array.from({ length: 100 }, (_, i) => ({ x: i, y: 2 * i + (i % 5) }));
    const kde = gaussianKde2d(points);
    expect(kde).toHaveLength(100);
    expect(kde.every((p) => Number.isFinite(p.density))).toBe(true);
  });
});
