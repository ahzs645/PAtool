import { describe, expect, it } from "vitest";

import {
  decomposeMetYears,
  guardTrainingOnly,
  type MetRecord,
  type ModelPredictor,
} from "./metYearDecomposition";

function makeRecord(year: number, month: number, temp: number, base: number): MetRecord {
  return {
    timestamp: `${year}-${String(month).padStart(2, "0")}-01T00:00:00Z`,
    value: base + temp,
    features: { temp },
  };
}

describe("decomposeMetYears", () => {
  it("returns per-year means + iterations for a linear predictor", () => {
    const records: MetRecord[] = [];
    for (let year = 2020; year <= 2023; year += 1) {
      for (let month = 1; month <= 12; month += 1) {
        records.push(makeRecord(year, month, month + (year - 2020), 5));
      }
    }
    const predict: ModelPredictor = (rows) => rows.map((row) => row.features.temp + 5);
    const result = decomposeMetYears(records, predict, { iterations: 50, seed: 1 });
    expect(result.swapYears).toEqual([2020, 2021, 2022, 2023]);
    expect(result.perYearMean.size).toBe(4);
    for (const value of result.perYearMean.values()) {
      expect(value).toBeGreaterThan(0);
    }
  });

  it("returns empty maps when no records are supplied", () => {
    const result = decomposeMetYears([], () => []);
    expect(result.perYearMean.size).toBe(0);
    expect(result.iterations).toBeGreaterThan(0);
  });
});

describe("guardTrainingOnly", () => {
  it("filters out rows with features outside the training range", () => {
    const training: MetRecord[] = Array.from({ length: 12 }, (_, i) => ({
      timestamp: `2025-${String(i + 1).padStart(2, "0")}-01T00:00:00Z`,
      value: i,
      features: { temp: i + 5 },
    }));
    const newRecords: MetRecord[] = [
      { timestamp: "2026-01-01", value: 1, features: { temp: 6 } },     // in-range
      { timestamp: "2026-02-01", value: 2, features: { temp: 100 } },   // out-of-range
      { timestamp: "2026-03-01", value: 3, features: { temp: -10 } },   // out-of-range
    ];
    const guarded = guardTrainingOnly(newRecords, training);
    expect(guarded).toHaveLength(1);
    expect(guarded[0].features.temp).toBe(6);
  });
});
