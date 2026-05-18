import { describe, expect, it } from "vitest";

import { fitSplineQuantile, type QuantileSeriesPoint } from "./splineQuantileBaseline";

describe("fitSplineQuantile", () => {
  it("returns empty output for an empty series", () => {
    const fit = fitSplineQuantile([]);
    expect(fit.fitted).toEqual([]);
    expect(fit.coefficients).toEqual([]);
  });

  it("tracks a near-constant low quantile beneath spiky data", () => {
    const series: QuantileSeriesPoint[] = [];
    for (let i = 0; i < 200; i += 1) {
      const baseline = 5;
      const spike = i % 11 === 0 ? 80 : 0; // sparse spikes
      series.push({ x: i, y: baseline + spike + (i % 3) * 0.5 });
    }
    const fit = fitSplineQuantile(series, { tau: 0.05, iterations: 500, learningRate: 0.2 });
    // The 5th-percentile baseline should sit at or below the spike-free
    // points (≈ 5) for most of the series.
    const belowSpikes = fit.fitted.filter((v) => v <= 8).length;
    expect(belowSpikes).toBeGreaterThan(150);
    expect(fit.knots.length).toBeGreaterThan(2);
  });
});
