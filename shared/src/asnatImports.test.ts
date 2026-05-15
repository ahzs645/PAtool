import { describe, expect, it } from "vitest";

import {
  aggregateMeasurements,
  aqiCategoryStatistics,
  aqiComposition,
  autoQaQcFlags,
  compareNeighborMeasurements,
  distanceMeters,
  neighborPairStatistics,
  parseStandardMeasurementTable,
  pointInPolygon,
  summarizeSites,
} from "./index";

describe("ASNAT-inspired modular imports", () => {
  it("computes geodetic distances and polygon containment", () => {
    const distance = distanceMeters(
      { longitude: -122.34, latitude: 47.61 },
      { longitude: -122.35, latitude: 47.62 },
    );
    expect(distance).toBeGreaterThan(1_000);
    expect(distance).toBeLessThan(1_500);
    expect(pointInPolygon(
      { longitude: 0.5, latitude: 0.5 },
      [
        { longitude: 0, latitude: 0 },
        { longitude: 1, latitude: 0 },
        { longitude: 1, latitude: 1 },
        { longitude: 0, latitude: 1 },
      ],
    )).toBe(true);
  });

  it("aggregates and summarizes standard measurement rows", () => {
    const rows = [
      { id: "a", timestamp: "2026-01-01T00:05:00Z", value: 10 },
      { id: "a", timestamp: "2026-01-01T00:35:00Z", value: 14, flagged: true },
      { id: "a", timestamp: "2026-01-01T01:05:00Z", value: null },
    ];
    expect(aggregateMeasurements(rows, "hour")).toMatchObject([
      { id: "a", bucket: "2026-01-01T00", count: 2, flagged: 1, mean: 12 },
      { id: "a", bucket: "2026-01-01T01", count: 0, missing: 1, mean: null },
    ]);
    const summary = summarizeSites(rows)[0];
    expect(summary).toMatchObject({ id: "a", count: 2, mean: 12 });
    expect(summary.missingPercent).toBeCloseTo(100 / 3);
  });

  it("parses ASNAT-style standard tables", () => {
    const parsed = parseStandardMeasurementTable([
      "title row",
      "timestamp(UTC)\tlongitude(deg)\tlatitude(deg)\tid(-)\tpm25(ug/m3)\tflagged(-)",
      "2026-01-01T00:00:00Z\t-122\t47\ts1\t9\t0",
      "2026-01-01T01:00:00Z\t-122\t47\ts1\tNA\t99",
    ].join("\n"));
    expect(parsed.warnings).toEqual([]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[1]).toMatchObject({ id: "s1", value: null, flagged: true });
  });

  it("builds neighbor comparisons and pair statistics", () => {
    const references = [
      { id: "r1", timestamp: "2026-01-01T00:00:00Z", longitude: -122, latitude: 47, value: 10 },
      { id: "r1", timestamp: "2026-01-01T01:00:00Z", longitude: -122, latitude: 47, value: 20 },
    ];
    const sensors = [
      { id: "s1", timestamp: "2026-01-01T00:05:00Z", longitude: -122.001, latitude: 47.001, value: 12 },
      { id: "s1", timestamp: "2026-01-01T01:05:00Z", longitude: -122.001, latitude: 47.001, value: 19 },
    ];
    const pairs = compareNeighborMeasurements(references, sensors, {
      timeBucket: "hour",
      maxDistanceMeters: 500,
      maxAbsoluteDifference: 1,
    });
    expect(pairs).toHaveLength(2);
    expect(pairs[0].flags).toContain("neighbor-absolute-difference");
    expect(neighborPairStatistics(pairs)[0]).toMatchObject({ referenceId: "r1", sensorId: "s1", n: 2 });
  });

  it("computes AQI composition, category stats, and QA flags", () => {
    const composition = aqiComposition([4, 12, 40, null]);
    expect(composition.find((row) => row.label === "Good")?.count).toBe(1);
    expect(composition.find((row) => row.category === "Unavailable")?.count).toBe(1);

    const categoryStats = aqiCategoryStatistics([
      { reference: 8, sensor: 10 },
      { reference: 30, sensor: 40 },
    ]);
    expect(categoryStats.find((row) => row.label === "Good")?.count).toBe(1);

    const flags = autoQaQcFlags([
      { timestamp: "2026-01-01T00:00:00Z", value: 1 },
      { timestamp: "2026-01-01T01:00:00Z", value: 1 },
      { timestamp: "2026-01-01T02:00:00Z", value: 1 },
      { timestamp: "2026-01-01T03:00:00Z", value: 1 },
      { timestamp: "2026-01-01T04:00:00Z", value: -1 },
      { timestamp: "2026-01-01T05:00:00Z", value: 80 },
    ]);
    expect(flags.some((flag) => flag.code === "constant-run")).toBe(true);
    expect(flags.some((flag) => flag.code === "negative")).toBe(true);
    expect(flags.some((flag) => flag.code === "sudden-spike")).toBe(true);
  });
});
