import { describe, expect, it } from "vitest";

import {
  calendarPlot,
  corPlot,
  scatterPlot,
  timeVariation,
  trendLevel,
} from "./openairPlots";

function syntheticRows(): { timestamp: string; value: number }[] {
  const out: { timestamp: string; value: number }[] = [];
  const start = new Date("2024-01-01T00:00:00Z").getTime();
  for (let h = 0; h < 24 * 30; h += 1) {
    const ts = new Date(start + h * 3600 * 1000).toISOString();
    const hr = (h % 24);
    out.push({ timestamp: ts, value: 5 + Math.sin((hr / 24) * Math.PI * 2) * 5 });
  }
  return out;
}

describe("openair plots", () => {
  it("timeVariation produces 24 hour bins, 7 dow bins, 12 month bins", () => {
    const tv = timeVariation(syntheticRows());
    expect(tv.hour).toHaveLength(24);
    expect(tv.dayOfWeek).toHaveLength(7);
    expect(tv.month).toHaveLength(12);
    expect(tv.hour.every((b) => b.count > 0)).toBe(true);
  });

  it("calendarPlot returns one row per ISO date with counts", () => {
    const cells = calendarPlot(syntheticRows());
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.every((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.date))).toBe(true);
    expect(cells.every((c) => c.count === 24)).toBe(true);
  });

  it("corPlot recovers r≈1 for identical columns", () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ a: i, b: i, c: -i }));
    const m = corPlot(rows);
    const ab = m.cells.find((c) => c.rowVar === "a" && c.colVar === "b");
    const ac = m.cells.find((c) => c.rowVar === "a" && c.colVar === "c");
    expect(ab?.r).toBeCloseTo(1, 6);
    expect(ac?.r).toBeCloseTo(-1, 6);
    expect(m.order.length).toBe(3);
  });

  it("scatterPlot fit recovers slope on linear data", () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ x: i, y: 2 * i + 3 }));
    const out = scatterPlot(rows, { bins: 10 });
    expect(out.fit.slope).toBeCloseTo(2, 6);
    expect(out.fit.intercept).toBeCloseTo(3, 6);
    expect(out.fit.r2).toBeCloseTo(1, 6);
  });

  it("trendLevel yields one row per (year, month)", () => {
    const cells = trendLevel(syntheticRows());
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.every((c) => c.count > 0)).toBe(true);
  });
});
