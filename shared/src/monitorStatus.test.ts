import { describe, expect, it } from "vitest";

import {
  buildMonitorMatrix,
  filterPasByPm25Slice,
  filterPasWithinRadius,
  monitorMatrixToCsvBundle,
  pasSlicePm25,
  selectNearestPas,
  summarizePatCurrentStatus,
  type PasRecord,
  type PatSeries,
} from "./index";

const series: PatSeries = {
  meta: { sensorId: "s1", label: "Sensor 1", timezone: "America/Los_Angeles", latitude: 45, longitude: -122 },
  points: [
    { timestamp: "2026-05-13T20:00:00.000Z", pm25A: 8, pm25B: 10 },
    { timestamp: "2026-05-14T19:00:00.000Z", pm25A: 12, pm25B: 14 },
    { timestamp: "2026-05-14T20:00:00.000Z", pm25A: 16, pm25B: 18 },
  ],
};

describe("monitor status", () => {
  it("summarizes last valid values, latency, delta, and yesterday average", () => {
    const status = summarizePatCurrentStatus(series, { now: "2026-05-14T21:00:00.000Z" });

    expect(status.status).toBe("current");
    expect(status.currentPm25).toBe(17);
    expect(status.previousPm25).toBe(13);
    expect(status.deltaPm25).toBe(4);
    expect(status.latencyMinutes).toBe(60);
    expect(status.yesterdayMeanPm25).toBe(9);
  });
});

describe("monitor matrix", () => {
  it("builds a wide timestamp-aligned matrix from PAT series", () => {
    const matrix = buildMonitorMatrix([
      series,
      {
        ...series,
        meta: { ...series.meta, sensorId: "s2", label: "Sensor 2" },
        points: [{ timestamp: "2026-05-14T20:00:00.000Z", pm25A: 20, pm25B: null }],
      },
    ]);

    expect(matrix.meta.map((row) => row.sensorId)).toEqual(["s1", "s2"]);
    expect(matrix.timestamps).toContain("2026-05-14T20:00:00.000Z");
    expect(matrix.values.at(-1)).toEqual([17, 20]);
    expect(monitorMatrixToCsvBundle(matrix)).toContain("Metadata\ncolumn,sensorId,label,timezone,latitude,longitude");
  });
});

describe("monitor selection helpers", () => {
  const records: PasRecord[] = [
    { id: "a", label: "A", latitude: 45, longitude: -122, locationType: "outside", pm25Current: 10, pm25_1hr: 20 },
    { id: "b", label: "B", latitude: 46, longitude: -123, locationType: "outside", pm25Current: 50, pm25_1day: 70 },
  ];

  it("supports distance and PM2.5 slice filters", () => {
    expect(pasSlicePm25(records[0], "max")).toBe(20);
    expect(filterPasWithinRadius(records, { latitude: 45, longitude: -122 }, 5).map((record) => record.id)).toEqual(["a"]);
    expect(selectNearestPas(records, { latitude: 45, longitude: -122 }, 1).map((record) => record.id)).toEqual(["a"]);
    expect(filterPasByPm25Slice(records, "max", (value) => value >= 60).map((record) => record.id)).toEqual(["b"]);
  });
});
