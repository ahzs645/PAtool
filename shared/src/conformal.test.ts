import { describe, expect, it } from "vitest";

import {
  calibrateConformal,
  conformalIntervals,
  crpsFromSample,
  crpsGaussian,
  evaluateConformalIntervals,
  meanCrps,
} from "./conformal";
import type { ValidationPrediction } from "./validationWorkbench";

function buildPredictions(residuals: number[]): ValidationPrediction[] {
  return residuals.map((residual, i) => ({
    id: String(i),
    x: i,
    y: 0,
    observed: 100 + residual,
    predicted: 100,
    residual,
    foldId: "calib",
  }));
}

describe("split conformal calibration", () => {
  it("produces a margin near the (1-alpha) order statistic of |residuals|", () => {
    const residuals = Array.from({ length: 100 }, (_, i) => i - 50); // [-50, 49]
    const calibration = calibrateConformal(buildPredictions(residuals), { alpha: 0.1 });
    expect(calibration.n).toBe(100);
    // 91st absolute value once sorted should sit around 46-50.
    expect(calibration.qhat).toBeGreaterThanOrEqual(45);
    expect(calibration.qhat).toBeLessThanOrEqual(55);
  });

  it("delivers ≥ (1-alpha) empirical coverage on exchangeable test data", () => {
    const rng = mulberry32(7);
    const residualsCalib = Array.from({ length: 500 }, () => 4 * (rng() - 0.5));
    const residualsTest = Array.from({ length: 1000 }, () => 4 * (rng() - 0.5));
    const calib = calibrateConformal(buildPredictions(residualsCalib), { alpha: 0.05 });

    const testQueries = residualsTest.map(() => ({ predicted: 100 }));
    const intervals = conformalIntervals(calib, testQueries);
    const observed = residualsTest.map((residual) => 100 + residual);

    const evaluation = evaluateConformalIntervals(intervals, observed, 0.05);
    expect(evaluation.coverage).toBeGreaterThanOrEqual(0.9); // generous; expected ≈ 0.95
    expect(evaluation.meanWidth).toBeGreaterThan(0);
  });

  it("normalized mode widens intervals where sigma is large", () => {
    const residuals = [0.2, -0.4, 0.6, -0.8, 0.5, -0.3];
    const sigmas = [1, 1, 2, 2, 1, 1];
    const calib = calibrateConformal(buildPredictions(residuals), {
      alpha: 0.1,
      mode: "normalized",
      sigmas,
    });
    const intervals = conformalIntervals(calib, [
      { predicted: 100, sigma: 1 },
      { predicted: 100, sigma: 4 },
    ]);
    const widthSmall = intervals[0].upper - intervals[0].lower;
    const widthLarge = intervals[1].upper - intervals[1].lower;
    expect(widthLarge).toBeGreaterThan(widthSmall);
  });
});

describe("CRPS metrics", () => {
  it("CRPS_Gaussian shrinks toward MAE as sd → 0", () => {
    const mae = Math.abs(10 - 9.9);
    const tight = crpsGaussian(10, 9.9, 1e-4);
    expect(tight).toBeGreaterThan(0);
    expect(tight).toBeLessThanOrEqual(mae);
    expect(tight).toBeGreaterThan(mae - 0.001);
  });

  it("sample CRPS goes to zero for a perfect ensemble at the observation", () => {
    expect(crpsFromSample(10, [10, 10, 10])).toBeCloseTo(0, 6);
  });

  it("aggregates batch CRPS", () => {
    const observed = [10, 11, 12];
    const means = [10, 12, 11];
    const sds = [1, 1, 1];
    expect(meanCrps(observed, means, sds)).toBeGreaterThan(0);
  });
});

function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
