import { describe, expect, it } from "vitest";

import {
  meteorologicalYearDecomposition,
  partialDependenceTrainingOnly,
  strucchangeBreakpoints,
} from "./rmweatherExtensions";

describe("rmweather extensions", () => {
  it("meteorological-year decomposition uses reference-year meteorology", () => {
    const series = [
      { timestamp: "2020-06-15T00:00:00Z", observed: 5, meteorology: { temp: 15 } },
      { timestamp: "2021-06-15T00:00:00Z", observed: 10, meteorology: { temp: 25 } },
    ];
    const out = meteorologicalYearDecomposition(series, {
      referenceYear: 2020,
      predict: (m) => m.temp * 0.5,
    });
    expect(out).toHaveLength(2);
    expect(out[0].counterfactual).toBeCloseTo(7.5, 6);
    expect(out[1].counterfactual).toBeCloseTo(7.5, 6);
  });

  it("strucchange detects a step change", () => {
    const values = [
      ...Array.from({ length: 30 }, () => 1),
      ...Array.from({ length: 30 }, () => 10),
    ];
    const bps = strucchangeBreakpoints(values, { maxBreakpoints: 2, minSegmentSize: 10 });
    expect(bps.length).toBeGreaterThanOrEqual(1);
    expect(Math.abs(bps[0].index - 30)).toBeLessThanOrEqual(2);
  });

  it("partial dependence prunes grid to training envelope", () => {
    const grid = [-1, 0, 5, 10, 20];
    const pd = partialDependenceTrainingOnly({
      variable: "temp",
      trainingValues: [2, 3, 7, 8],
      grid,
      predict: (v) => v * 2,
    });
    expect(pd.every((p) => p.value >= 2 && p.value <= 8)).toBe(true);
  });
});
