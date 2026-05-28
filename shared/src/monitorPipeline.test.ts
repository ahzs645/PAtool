import { describe, expect, it } from "vitest";

import {
  monitorCombine,
  monitorDailyStatistic,
  monitorDailyThreshold,
  monitorFilterByDistance,
  monitorFilterDate,
  monitorFilterMeta,
  monitorIsValid,
  monitorReplaceValues,
  monitorToCsv,
  type MtsMonitor,
} from "./monitorPipeline";

function fixture(): MtsMonitor {
  const hours = 48;
  const datetime = Array.from({ length: hours }, (_, i) =>
    new Date(Date.UTC(2024, 0, 1, i)).toISOString(),
  );
  return {
    meta: [
      { id: "A", latitude: 47.5, longitude: -122.3, timezone: "America/Los_Angeles" },
      { id: "B", latitude: 33.7, longitude: -118.2, timezone: "America/Los_Angeles" },
    ],
    data: {
      datetime,
      data: {
        A: Array.from({ length: hours }, (_, i) => 5 + i * 0.3),
        B: Array.from({ length: hours }, (_, i) => 8 + Math.sin(i / 4) * 2),
      },
    },
  };
}

describe("monitor pipeline", () => {
  it("validates structure", () => {
    expect(monitorIsValid(fixture())).toBe(true);
  });

  it("filters by metadata predicate", () => {
    const out = monitorFilterMeta(fixture(), (m) => m.id === "A");
    expect(out.meta).toHaveLength(1);
    expect(Object.keys(out.data.data)).toEqual(["A"]);
  });

  it("filters by date range", () => {
    const out = monitorFilterDate(fixture(), "2024-01-01T03:00:00Z", "2024-01-01T06:00:00Z");
    expect(out.data.datetime).toHaveLength(3);
  });

  it("filters by distance", () => {
    const out = monitorFilterByDistance(fixture(), 47.6, -122.3, 100);
    expect(out.meta.map((m) => m.id)).toEqual(["A"]);
  });

  it("replaces flagged values", () => {
    const out = monitorReplaceValues(fixture(), (v) => (v ?? 0) > 10, null);
    expect(out.data.data.A.some((v) => v === null)).toBe(true);
  });

  it("computes daily statistic with min-hours rule", () => {
    const daily = monitorDailyStatistic(fixture(), { statistic: "mean", minHours: 12 });
    expect(daily.data.datetime.length).toBeGreaterThan(0);
  });

  it("daily threshold counts exceedances", () => {
    const counts = monitorDailyThreshold(fixture(), 10);
    expect(counts.data.data.A.length).toBe(counts.data.datetime.length);
  });

  it("combines multiple monitors over a union timestamp grid", () => {
    const m1 = fixture();
    const m2: MtsMonitor = {
      meta: [{ id: "C", latitude: 40, longitude: -74, timezone: "America/New_York" }],
      data: {
        datetime: [new Date(Date.UTC(2024, 0, 1, 48)).toISOString()],
        data: { C: [12] },
      },
    };
    const combined = monitorCombine([m1, m2]);
    expect(combined.meta.map((m) => m.id)).toEqual(["A", "B", "C"]);
    expect(combined.data.datetime).toContain(m2.data.datetime[0]);
  });

  it("monitorToCsv produces a long CSV", () => {
    const csv = monitorToCsv(fixture());
    expect(csv.split("\n")[0]).toBe("timestamp,monitor_id,value");
  });
});
