import { describe, expect, it } from "vitest";

import type { InterpolationPoint } from "./domain";
import {
  leaveLocationOutCrossValidate,
  moransI,
  predictionIntervalCoverage,
  residualSemivariogram,
  smape,
  smapeForPairs,
  spatialBlockCrossValidate,
} from "./validationWorkbench";

const points: InterpolationPoint[] = [
  { id: "a", x: 0, y: 0, value: 10 },
  { id: "a", x: 0, y: 0.1, value: 12 },
  { id: "b", x: 1, y: 0, value: 20 },
  { id: "c", x: 0, y: 1, value: 30 },
  { id: "d", x: 1, y: 1, value: 40 },
];

describe("validation workbench", () => {
  it("computes SMAPE for individual values and finite pairs", () => {
    expect(smape(100, 80)).toBeCloseTo(40 / 180, 6);
    expect(smape(0, 0)).toBe(0);
    expect(smapeForPairs([
      { actual: 100, predicted: 80 },
      { actual: 0, predicted: 0 },
      { actual: Number.NaN, predicted: 1 },
    ])).toBeCloseTo((40 / 180) / 2, 6);
  });

  it("runs leave-location-out CV by holding all points with the same id together", () => {
    const result = leaveLocationOutCrossValidate(points, {
      method: "idw",
      idw: { power: 2 },
    });

    expect(result.method).toBe("idw");
    expect(result.folds).toBe(4);
    expect(result.n).toBe(points.length);
    expect(result.predictions.filter((prediction) => prediction.id === "a")).toHaveLength(2);
    expect(result.predictions.every((prediction) => Number.isFinite(prediction.predicted))).toBe(true);
    expect(result.rmse).toBeGreaterThanOrEqual(0);
    expect(result.smape).toBeGreaterThanOrEqual(0);
  });

  it("runs deterministic spatial block CV over lon-lat grid cells", () => {
    const result = spatialBlockCrossValidate(points, {
      method: "idw",
      cellSizeLon: 0.75,
      cellSizeLat: 0.75,
      originLon: 0,
      originLat: 0,
    });

    expect(result.folds).toBe(4);
    expect(result.n).toBe(points.length);
    expect(new Set(result.predictions.map((prediction) => prediction.foldId))).toEqual(
      new Set(["0:0", "1:0", "0:1", "1:1"]),
    );
  });

  it("computes positive Moran's I for spatially clustered residuals", () => {
    const result = moransI(
      [
        { x: 0, y: 0, residual: 1 },
        { x: 0, y: 1, residual: 1 },
        { x: 10, y: 10, residual: -1 },
        { x: 10, y: 11, residual: -1 },
      ],
      { maxDistance: 2, inverseDistancePower: 0 },
    );

    expect(result.n).toBe(4);
    expect(result.weightSum).toBe(4);
    expect(result.i).toBeCloseTo(1, 6);
  });

  it("builds empirical residual semivariogram bins", () => {
    const bins = residualSemivariogram(
      [
        { x: 0, y: 0, residual: 1 },
        { x: 1, y: 0, residual: 3 },
        { x: 2, y: 0, residual: 5 },
      ],
      { binWidth: 1, binCount: 3 },
    );

    expect(bins).toHaveLength(2);
    expect(bins[0]).toMatchObject({ bin: 1, pairs: 2, semivariance: 2 });
    expect(bins[1]).toMatchObject({ bin: 2, pairs: 1, semivariance: 8 });
  });

  it("summarizes prediction interval coverage and miss direction", () => {
    const result = predictionIntervalCoverage([
      { observed: 10, lower: 8, upper: 12 },
      { observed: 7, lower: 8, upper: 12 },
      { observed: 15, lower: 8, upper: 12 },
    ]);

    expect(result).toEqual({
      n: 3,
      covered: 1,
      coverage: 1 / 3,
      meanWidth: 4,
      below: 1,
      above: 1,
    });
  });
});
