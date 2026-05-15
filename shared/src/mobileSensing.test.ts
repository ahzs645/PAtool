import { describe, expect, it } from "vitest";

import {
  aggregateMobilePoints,
  buildMobileCalendar,
  buildRouteSegments,
  cleanMobilePoints,
  findNearestReferenceMonitor,
  parseAirBeamCsv,
  summarizeDistribution,
  summarizeMobileCampaign,
  temporallyAdjustMobilePoints,
  type MobileSensingPoint,
  type ReferenceMonitor,
} from "./mobileSensing";

const csv = `Session_Name,Timestamp,Latitude,Longitude,PM2.5,Humidity,Temperature
Morning loop,2024-06-01T08:00:00Z,49.2800,-123.1200,8,40,18
Morning loop,2024-06-01T08:00:30Z,49.2805,-123.1205,10,41,18
Morning loop,2024-06-01T09:00:00Z,49.2810,-123.1210,20,42,19
Evening loop,2024-06-02T18:00:00Z,49.2900,-123.1300,30,45,20`;

describe("AirBeam CSV normalization", () => {
  it("normalizes AirBeam rows into mobile sensing points", () => {
    const points = parseAirBeamCsv(csv, { sourceId: "upload-1" });
    const morning = points.find((point) => point.sessionId === "Morning loop" && point.timestamp === "2024-06-01T08:00:00.000Z");

    expect(points).toHaveLength(4);
    expect(morning).toMatchObject({
      source: "airbeam",
      sourceId: "upload-1",
      sessionId: "Morning loop",
      pm25: 8,
      humidity: 40,
    });
  });

  it("aggregates points by session and time bucket", () => {
    const points = parseAirBeamCsv(csv, { sourceId: "upload-1" });
    const hourly = aggregateMobilePoints(points, "1hr");
    const firstMorningHour = hourly.find((point) => point.sessionId === "Morning loop" && point.timestamp === "2024-06-01T08:00:00.000Z");

    expect(hourly).toHaveLength(3);
    expect(firstMorningHour?.pm25).toBeCloseTo(9, 3);
    expect(firstMorningHour?.sampleCount).toBe(2);
  });
});

describe("mobile campaign analytics", () => {
  const points = parseAirBeamCsv(csv, { sourceId: "upload-1" });

  it("summarizes sessions and campaign-level exposure", () => {
    const summary = summarizeMobileCampaign(points);

    expect(summary.sessionCount).toBe(2);
    expect(summary.pointCount).toBe(4);
    expect(summary.pm25Median).toBeCloseTo(15, 3);
    expect(summary.sessions.find((session) => session.sessionId === "Morning loop")?.distanceKm).toBeGreaterThan(0);
  });

  it("finds nearest reference monitor and temporal adjustment rows", () => {
    const monitors: ReferenceMonitor[] = [
      { id: "far", name: "Far", latitude: 48, longitude: -122 },
      { id: "near", name: "Near", latitude: 49.281, longitude: -123.121 },
    ];
    const nearest = findNearestReferenceMonitor(points, monitors);

    expect(nearest?.monitor.id).toBe("near");

    const adjusted = temporallyAdjustMobilePoints(points, [
      { timestamp: "2024-06-01T08:00:00Z", pm25: 12 },
      { timestamp: "2024-06-01T09:00:00Z", pm25: 18 },
      { timestamp: "2024-06-02T18:00:00Z", pm25: 24 },
    ], "1hr");

    expect(adjusted).toHaveLength(4);
    expect(adjusted[0].adjustedPm25).toBeGreaterThan(0);
  });

  it("builds calendar, distribution, and segment summaries", () => {
    const calendar = buildMobileCalendar(points);
    const distribution = summarizeDistribution(points.map((point) => point.pm25));
    const segments = buildRouteSegments(points, { targetDistanceKm: 0.05 });

    expect(calendar).toHaveLength(2);
    expect(calendar[0].aqiCategory).toBe("moderate");
    expect(distribution.q3).toBeCloseTo(22.5, 3);
    expect(segments.length).toBeGreaterThan(0);
  });

  it("filters mobile GPS, speed, duplicate, and PM range problems", () => {
    const dirty = [
      ...points,
      { ...points[0], id: "dup" },
      { ...points[0], id: "bad-pm", timestamp: "2024-06-01T08:10:00Z", pm25: -1 },
      { ...points[0], id: "bad-gps", timestamp: "2024-06-01T08:11:00Z", gpsAccuracyMeters: 500 },
      { ...points[0], id: "jump", timestamp: "2024-06-01T08:12:00Z", latitude: 50.5 },
    ];

    const result = cleanMobilePoints(dirty, { maxGpsAccuracyMeters: 100, maxSpeedMetersPerSecond: 35 });

    expect(result.totalPoints).toBe(dirty.length);
    expect(result.removedPoints).toBeGreaterThanOrEqual(4);
    expect(result.issues.map((issue) => issue.code)).toContain("duplicate-timestamp");
    expect(result.issues.map((issue) => issue.code)).toContain("pm25-range");
    expect(result.issues.map((issue) => issue.code)).toContain("gps-accuracy");
    expect(result.issues.map((issue) => issue.code)).toContain("impossible-speed");
  });
});

describe("generic points", () => {
  it("keeps the module source-agnostic", () => {
    const points: MobileSensingPoint[] = [
      {
        id: "generic-1",
        source: "generic",
        sourceId: "walkshed",
        sessionId: "transect-a",
        timestamp: "2024-06-01T00:00:00Z",
        latitude: 49,
        longitude: -123,
        pm25: 5,
      },
    ];

    expect(summarizeMobileCampaign(points).sessions[0].source).toBe("generic");
  });
});
