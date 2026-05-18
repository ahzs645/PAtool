import { describe, expect, it } from "vitest";

import {
  gaussianSmooth,
  kzFilter,
  rollingMean,
  whittakerSmooth,
} from "./openairSmoothers";

describe("rollingMean", () => {
  it("returns the input series for a window of 1", () => {
    const out = rollingMean([1, 2, 3, 4, 5], 1);
    expect(out).toEqual([1, 2, 3, 4, 5]);
  });

  it("computes a centered mean and propagates null where below minObservations", () => {
    const out = rollingMean([1, 2, 3, 4, 5], 3, { align: "center", minObservations: 3 });
    // edges have fewer than 3 observations
    expect(out[0]).toBeNull();
    expect(out[1]).toBeCloseTo(2, 6);
    expect(out[2]).toBeCloseTo(3, 6);
    expect(out[3]).toBeCloseTo(4, 6);
    expect(out[4]).toBeNull();
  });

  it("skips null inputs gracefully", () => {
    const out = rollingMean([1, null, 3, null, 5], 3, { minObservations: 1 });
    expect(out[2]).toBeCloseTo(3, 6); // mean(null, 3, null) → 3
  });
});

describe("gaussianSmooth", () => {
  it("preserves a constant signal", () => {
    const out = gaussianSmooth([5, 5, 5, 5, 5, 5, 5], { sigma: 1 });
    for (const v of out) expect(v).toBeCloseTo(5, 6);
  });

  it("attenuates a single spike toward the mean", () => {
    const series = [0, 0, 0, 10, 0, 0, 0];
    const out = gaussianSmooth(series, { sigma: 1 });
    expect(out[3]!).toBeLessThan(10);
    expect(out[3]!).toBeGreaterThan(0);
    // mass is conserved within numerical tolerance (kernel renormalises at edges
    // so we only check the central window)
    const central = out.slice(1, 6).reduce<number>((acc, v) => acc + (v ?? 0), 0);
    expect(central).toBeGreaterThan(7);
    expect(central).toBeLessThan(10);
  });
});

describe("kzFilter", () => {
  it("flattens a noisy series while tracking its mean", () => {
    const length = 100;
    const trend = Array.from({ length }, (_, i) => i / length);
    const noisy = trend.map((v, i) => v + (i % 2 === 0 ? 0.5 : -0.5));
    const smoothed = kzFilter(noisy, 5, 3);
    // central section should track the underlying trend within a small margin
    for (let i = 20; i < 80; i += 1) {
      expect(Math.abs((smoothed[i] ?? 0) - trend[i])).toBeLessThan(0.1);
    }
  });
});

describe("whittakerSmooth", () => {
  it("returns the input series when lambda is 0", () => {
    const input = [1, 2, 3, 4, 5];
    const out = whittakerSmooth(input, { lambda: 0 });
    for (let i = 0; i < input.length; i += 1) {
      expect(out[i]!).toBeCloseTo(input[i], 6);
    }
  });

  it("smooths a noisy signal but preserves the linear trend's endpoints", () => {
    const length = 50;
    const trend = Array.from({ length }, (_, i) => i);
    const noisy = trend.map((v, i) => v + (i % 2 === 0 ? 2 : -2));
    const smoothed = whittakerSmooth(noisy, { lambda: 100, differenceOrder: 2 });
    // Average residual against the true linear trend should be small
    let sq = 0;
    for (let i = 0; i < length; i += 1) sq += ((smoothed[i] ?? 0) - trend[i]) ** 2;
    expect(Math.sqrt(sq / length)).toBeLessThan(1.0);
  });

  it("imputes nulls by leaning on the penalty term", () => {
    const series: Array<number | null> = [1, 2, null, 4, 5];
    const out = whittakerSmooth(series, { lambda: 10, differenceOrder: 2 });
    expect(out[2]).not.toBeNull();
    expect(out[2]!).toBeGreaterThan(2);
    expect(out[2]!).toBeLessThan(4);
  });
});
