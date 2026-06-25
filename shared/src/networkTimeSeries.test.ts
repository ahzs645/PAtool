import { describe, expect, it } from "vitest";

import {
  buildNetworkTimeSeries,
  networkFrameAt,
  networkFrameMeans,
  networkValueRange,
  type NetworkMeasurementRow,
} from "./networkTimeSeries";

const rows: NetworkMeasurementRow[] = [
  { sensorId: "A", timestamp: "2023-01-02T00:00:00Z", latitude: 53.8, longitude: -122.8, value: 20 },
  { sensorId: "A", timestamp: "2023-01-01T00:00:00Z", latitude: 53.8, longitude: -122.8, value: 10 },
  { sensorId: "B", timestamp: "2023-01-01T00:00:00Z", latitude: 53.9, longitude: -122.7, value: 30 },
  // B has no row on day 2 -> null
];

describe("network time series", () => {
  it("pivots rows onto a sorted shared timestamp axis", () => {
    const series = buildNetworkTimeSeries(rows, { pollutant: "pm2.5", unit: "ug/m3" });
    expect(series.timestamps).toEqual(["2023-01-01T00:00:00Z", "2023-01-02T00:00:00Z"]);
    const a = series.sites.find((s) => s.id === "A")!;
    const b = series.sites.find((s) => s.id === "B")!;
    expect(a.values).toEqual([10, 20]);
    expect(b.values).toEqual([30, null]);
  });

  it("averages multiple rows in the same site/timestamp bucket", () => {
    const series = buildNetworkTimeSeries([
      { sensorId: "A", timestamp: "2023-01-01T00:00:00Z", latitude: 1, longitude: 2, value: 10 },
      { sensorId: "A", timestamp: "2023-01-01T00:00:00Z", latitude: 1, longitude: 2, value: 20 },
    ]);
    expect(series.sites[0].values[0]).toBe(15);
  });

  it("buckets sub-daily timestamps to day when requested", () => {
    const series = buildNetworkTimeSeries([
      { sensorId: "A", timestamp: "2023-01-01T05:00:00Z", latitude: 1, longitude: 2, value: 10 },
      { sensorId: "A", timestamp: "2023-01-01T18:00:00Z", latitude: 1, longitude: 2, value: 30 },
    ], { bucket: "day" });
    expect(series.timestamps).toEqual(["2023-01-01T00:00:00Z"]);
    expect(series.sites[0].values[0]).toBe(20);
  });

  it("returns a frame at an index", () => {
    const series = buildNetworkTimeSeries(rows);
    const frame = networkFrameAt(series, 1);
    expect(frame.timestamp).toBe("2023-01-02T00:00:00Z");
    expect(frame.points.find((p) => p.id === "A")?.value).toBe(20);
    expect(frame.points.find((p) => p.id === "B")?.value).toBeNull();
  });

  it("clamps out-of-range frame indices", () => {
    const series = buildNetworkTimeSeries(rows);
    expect(networkFrameAt(series, 99).index).toBe(1);
    expect(networkFrameAt(series, -5).index).toBe(0);
  });

  it("computes the global value range and per-frame means", () => {
    const series = buildNetworkTimeSeries(rows);
    expect(networkValueRange(series)).toEqual({ min: 10, max: 30 });
    expect(networkFrameMeans(series)).toEqual([20, 20]); // (10+30)/2, then 20 only
  });
});
