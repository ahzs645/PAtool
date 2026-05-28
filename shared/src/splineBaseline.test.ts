import { describe, expect, it } from "vitest";

import { estimateSplineQuantileBaseline } from "./splineBaseline";

describe("spline quantile baseline", () => {
  it("tracks a low-frequency trend underneath spiky observations", () => {
    const values: number[] = [];
    for (let i = 0; i < 200; i += 1) {
      const trend = 2 + 0.02 * i;
      values.push(trend + (i % 10 === 0 ? 25 : 0));
    }
    const out = estimateSplineQuantileBaseline(values, { tau: 0.02, df: 8 });
    expect(out.baseline).toHaveLength(values.length);
    expect(out.baseline[100]).toBeLessThan(values[100]);
    expect(out.corrected.length).toBe(values.length);
  });

  it("auto-df scales with input length", () => {
    const out = estimateSplineQuantileBaseline(new Array(120).fill(1));
    expect(out.df).toBeGreaterThan(3);
  });
});
