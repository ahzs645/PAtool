import { describe, expect, it } from "vitest";

import { Monitor, lstOffsetHoursForTimezone, type MonitorMetaRow, type MonitorRow } from "./airMonitorPipeline";

const META: MonitorMetaRow[] = [
  { monitorId: "m1", parameter: "PM2.5", units: "ug/m3", source: "AirNow", utcOffsetHours: -8 },
  { monitorId: "m2", parameter: "PM2.5", units: "ug/m3", source: "AIRSIS", utcOffsetHours: -8 },
];

function hourlyRows(): MonitorRow[] {
  const rows: MonitorRow[] = [];
  for (let i = 0; i < 48; i += 1) {
    rows.push({
      datetime: new Date(Date.UTC(2025, 0, 1, i)).toISOString(),
      m1: i,
      m2: i % 6 === 0 ? null : i * 2,
    });
  }
  return rows;
}

describe("Monitor pipeline", () => {
  it("filters meta and prunes data columns to match", () => {
    const monitor = new Monitor(META, hourlyRows());
    const onlyM1 = monitor.filterMeta((row) => row.monitorId === "m1");
    expect(onlyM1.nMonitors).toBe(1);
    expect("m2" in onlyM1.data[0]).toBe(false);
  });

  it("filters by date range", () => {
    const monitor = new Monitor(META, hourlyRows());
    const filtered = monitor.filterDate(
      new Date(Date.UTC(2025, 0, 1, 10)).toISOString(),
      new Date(Date.UTC(2025, 0, 1, 14)).toISOString(),
    );
    expect(filtered.nTimestamps).toBe(4);
  });

  it("drops monitors that are entirely null", () => {
    const dataWithEmpty: MonitorRow[] = [
      { datetime: "2025-01-01T00:00:00Z", m1: 5, m2: null },
      { datetime: "2025-01-01T01:00:00Z", m1: 6, m2: null },
    ];
    const monitor = new Monitor(META, dataWithEmpty);
    const cleaned = monitor.dropEmptyMonitors();
    expect(cleaned.monitorIds).toEqual(["m1"]);
  });

  it("collapses across monitors using a mean", () => {
    const data: MonitorRow[] = [
      { datetime: "2025-01-01T00:00:00Z", m1: 10, m2: 20 },
      { datetime: "2025-01-01T01:00:00Z", m1: 5, m2: 15 },
    ];
    const collapsed = new Monitor(META, data).collapse("mean", "site-mean");
    expect(collapsed.nMonitors).toBe(1);
    expect(collapsed.data[0]["site-mean"]).toBe(15);
    expect(collapsed.data[1]["site-mean"]).toBe(10);
  });

  it("aggregates to a daily LST mean", () => {
    const monitor = new Monitor(META, hourlyRows());
    const daily = monitor.dailyLstMean(12); // require 12+ hourly samples per local day
    // UTC offset -8h: UTC 2025-01-01T00..47 spans local 2024-12-31 16:00..2025-01-02 15:00.
    // Days with ≥12 hourly samples for m1: 2025-01-01 (24h) only; 2024-12-31 and
    // 2025-01-02 each have 8h.
    const valid = daily.data.filter((row) => typeof row.m1 === "number");
    expect(valid.length).toBeGreaterThanOrEqual(1);
  });

  it("combines monitors from two Monitor objects", () => {
    const a = new Monitor([META[0]], [{ datetime: "2025-01-01T00:00:00Z", m1: 10 }]);
    const b = new Monitor([META[1]], [{ datetime: "2025-01-01T00:00:00Z", m2: 20 }]);
    const merged = a.combine(b);
    expect(merged.nMonitors).toBe(2);
    expect(merged.data[0].m1).toBe(10);
    expect(merged.data[0].m2).toBe(20);
  });
});

describe("LST helpers", () => {
  it("returns canonical offsets for known IANA timezones", () => {
    expect(lstOffsetHoursForTimezone("America/Los_Angeles")).toBe(-8);
    expect(lstOffsetHoursForTimezone("America/New_York")).toBe(-5);
    expect(lstOffsetHoursForTimezone("UTC")).toBe(0);
    expect(lstOffsetHoursForTimezone(undefined)).toBe(0);
  });
});
