import { describe, expect, it } from "vitest";

import {
  applyLinearBiasCorrection,
  blandAltman,
  densityPoints,
  linearFit,
  relativeExpandedUncertainty,
  type MeasurementPair,
} from "./measurementError";

const pairs: MeasurementPair[] = [
  { reference: 10, sensor: 12 },
  { reference: 20, sensor: 23 },
  { reference: 30, sensor: 34 },
  { reference: 40, sensor: 45 },
  { reference: Number.NaN, sensor: 50 },
];

describe("measurement error diagnostics", () => {
  it("fits sensor values against reference measurements", () => {
    const fit = linearFit(pairs);
    expect(fit.n).toBe(4);
    expect(fit.slope).toBeCloseTo(1.1, 6);
    expect(fit.intercept).toBeCloseTo(1, 6);
    expect(fit.r2).toBeCloseTo(1, 6);
    expect(fit.rmse).toBeGreaterThan(0);
    expect(fit.mae).toBeGreaterThan(0);
  });

  it("summarizes Bland-Altman agreement limits", () => {
    const summary = blandAltman(pairs);
    expect(summary.n).toBe(4);
    expect(summary.points[0]).toMatchObject({ average: 11, difference: 2 });
    expect(summary.meanDifference).toBeCloseTo(3.5, 6);
    expect(summary.upperLimit).toBeGreaterThan(summary.meanDifference);
    expect(summary.lowerLimit).toBeLessThan(summary.meanDifference);
  });

  it("computes REU using regression residual variance and one-to-one deviation", () => {
    const result = relativeExpandedUncertainty(pairs, { k: 2 });
    expect(result.n).toBe(4);
    expect(result.points).toHaveLength(4);
    expect(result.points.every((point) => Number.isFinite(point.reu))).toBe(true);
    expect(result.points[0].reu).toBeGreaterThan(0);
  });

  it("builds coarse density counts for chart coloring", () => {
    const density = densityPoints([
      { x: 0, y: 0 },
      { x: 0.01, y: 0.01 },
      { x: 10, y: 10 },
    ], 2);

    expect(density.map((point) => point.value)).toEqual([2, 2, 1]);
  });

  it("applies inverse linear bias correction", () => {
    const corrected = applyLinearBiasCorrection(pairs);
    expect(corrected.pairs).toHaveLength(4);
    expect(corrected.pairs[0].sensor).toBeCloseTo(10, 6);
    expect(corrected.pairs[3].sensor).toBeCloseTo(40, 6);
  });
});
