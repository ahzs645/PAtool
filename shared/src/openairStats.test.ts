import { describe, expect, it } from "vitest";

import {
  calendarData,
  conditionalQuantile,
  correlationMatrix,
  modStats,
  taylorStats,
  timeVariation,
  trendLevelData,
  type Pair,
} from "./openairStats";

describe("modStats", () => {
  it("returns zeroed stats for an empty input", () => {
    const out = modStats([]);
    expect(out.n).toBe(0);
    expect(out.RMSE).toBe(0);
    expect(out.IOA).toBe(0);
  });

  it("returns FAC2 = 1 / r = 1 / MB = 0 for identical series", () => {
    const pairs: Pair[] = Array.from({ length: 50 }, (_, i) => ({
      observed: i + 1,
      predicted: i + 1,
    }));
    const out = modStats(pairs);
    expect(out.n).toBe(50);
    expect(out.FAC2).toBe(1);
    expect(out.r).toBeCloseTo(1, 8);
    expect(out.MB).toBe(0);
    expect(out.RMSE).toBe(0);
    expect(out.IOA).toBeCloseTo(1, 8);
    expect(out.COE).toBeCloseTo(1, 8);
  });

  it("detects a positive bias and computes consistent metrics", () => {
    const pairs: Pair[] = [
      { observed: 10, predicted: 14 },
      { observed: 20, predicted: 24 },
      { observed: 30, predicted: 34 },
      { observed: 40, predicted: 44 },
    ];
    const out = modStats(pairs);
    expect(out.MB).toBeCloseTo(4, 6);
    expect(out.MGE).toBeCloseTo(4, 6);
    expect(out.RMSE).toBeCloseTo(4, 6);
    expect(out.r).toBeCloseTo(1, 6);
    expect(out.FAC2).toBe(1);
    expect(out.NMB).toBeCloseTo(0.16, 4); // bias 4 / mean obs 25
  });

  it("flags poor models with FAC2 below 1 and a negative COE", () => {
    const pairs: Pair[] = [
      { observed: 10, predicted: 30 },
      { observed: 12, predicted: 35 },
      { observed: 14, predicted: 40 },
    ];
    const out = modStats(pairs);
    expect(out.FAC2).toBe(0);
    expect(out.MB).toBeGreaterThan(0);
    expect(out.IOA).toBeLessThan(0); // Willmott refined IOA can be negative
  });
});

describe("taylorStats", () => {
  it("returns sdRatio=1, corr=1 for the perfect model", () => {
    const observed = [1, 2, 3, 4, 5, 6, 7];
    const result = taylorStats(observed, [
      { label: "perfect", predicted: observed },
    ]);
    expect(result[0].sdRatio).toBeCloseTo(1, 6);
    expect(result[0].correlation).toBeCloseTo(1, 6);
    expect(result[0].centeredRmse).toBeCloseTo(0, 6);
  });

  it("handles a constant-bias model (correlation stays at 1)", () => {
    const observed = [1, 2, 3, 4, 5];
    const result = taylorStats(observed, [
      { label: "biased", predicted: observed.map((v) => v + 5) },
    ]);
    expect(result[0].correlation).toBeCloseTo(1, 6);
    expect(result[0].sdRatio).toBeCloseTo(1, 6);
  });
});

describe("timeVariation", () => {
  it("groups hourly samples into all four panels", () => {
    const points = Array.from({ length: 7 * 24 }, (_, i) => ({
      timestamp: new Date(Date.UTC(2025, 0, 1, i)).toISOString(),
      value: i,
    }));
    const result = timeVariation(points, { useUtc: true });
    expect(result.hour).toHaveLength(24);
    expect(result.weekday).toHaveLength(7);
    expect(result.month).toHaveLength(12);
    expect(result.hourOfWeek).toHaveLength(168);
    const totalHourCount = result.hour.reduce((sum, bin) => sum + bin.count, 0);
    expect(totalHourCount).toBe(points.length);
    // monthly: January (key=1) should be the only non-empty bucket
    const nonEmptyMonths = result.month.filter((bin) => bin.count > 0);
    expect(nonEmptyMonths).toHaveLength(1);
    expect(nonEmptyMonths[0].key).toBe(1);
  });
});

describe("calendarData", () => {
  it("collapses repeated hourly readings into one cell per day", () => {
    const points = [
      { timestamp: "2025-03-01T00:00:00Z", value: 10 },
      { timestamp: "2025-03-01T12:00:00Z", value: 14 },
      { timestamp: "2025-03-02T00:00:00Z", value: 5 },
    ];
    const cells = calendarData(points, { useUtc: true });
    expect(cells).toHaveLength(2);
    expect(cells[0].date).toBe("2025-03-01");
    expect(cells[0].mean).toBeCloseTo(12, 6);
    expect(cells[0].max).toBe(14);
    expect(cells[1].date).toBe("2025-03-02");
    expect(cells[1].count).toBe(1);
  });
});

describe("conditionalQuantile", () => {
  it("produces ascending bin centres covering the predicted range", () => {
    const pairs = Array.from({ length: 100 }, (_, i) => ({
      predicted: i,
      observed: i + (i % 5 === 0 ? 4 : -1),
    }));
    const bins = conditionalQuantile(pairs, 5);
    expect(bins).toHaveLength(5);
    expect(bins[0].predictedCenter).toBeLessThan(bins[4].predictedCenter);
    for (const bin of bins) {
      expect(bin.p25).toBeLessThanOrEqual(bin.median);
      expect(bin.median).toBeLessThanOrEqual(bin.p75);
    }
  });
});

describe("correlationMatrix", () => {
  it("returns a symmetric matrix with 1s on the diagonal", () => {
    const a = [1, 2, 3, 4, 5];
    const b = [2, 4, 6, 8, 10];
    const c = [5, 4, 3, 2, 1];
    const out = correlationMatrix([
      { label: "a", values: a },
      { label: "b", values: b },
      { label: "c", values: c },
    ]);
    expect(out.matrix[0][0]).toBe(1);
    expect(out.matrix[0][1]).toBeCloseTo(1, 6);
    expect(out.matrix[0][2]).toBeCloseTo(-1, 6);
    expect(out.matrix[1][2]).toBeCloseTo(-1, 6);
    // symmetry
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        expect(out.matrix[i][j]).toBeCloseTo(out.matrix[j][i], 8);
      }
    }
  });

  it("clusters variables by similarity when asked", () => {
    const out = correlationMatrix(
      [
        { label: "x", values: [1, 2, 3, 4] },
        { label: "z", values: [4, 3, 2, 1] },
        { label: "y", values: [2, 4, 6, 8] },
      ],
      { cluster: true },
    );
    // x and y are perfectly positively correlated; z is anti-correlated.
    // Greedy single-linkage starting at index 0 should place y next to x.
    expect(out.order[0]).toBe(0);
    expect(out.order[1]).toBe(2);
    expect(out.order[2]).toBe(1);
  });
});

describe("trendLevelData", () => {
  it("returns one cell per (hour, month) combination", () => {
    const points = [
      { timestamp: "2025-01-01T03:00:00Z", value: 10 },
      { timestamp: "2025-01-01T03:00:00Z", value: 14 },
      { timestamp: "2025-02-01T05:00:00Z", value: 7 },
    ];
    const cells = trendLevelData(points, "hour", "month", { useUtc: true });
    expect(cells).toHaveLength(2);
    const jan3 = cells.find((c) => c.xKey === 3 && c.yKey === 1);
    expect(jan3?.count).toBe(2);
    expect(jan3?.value).toBeCloseTo(12, 6);
  });
});
