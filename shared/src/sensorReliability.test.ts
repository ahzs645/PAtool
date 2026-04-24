import { describe, expect, it } from "vitest";

import type { PatSeries } from "./domain";
import {
  summarizeBarkjohnAvailability,
  summarizeSensorReliability,
  summarizeSensorReliabilityAgreement,
  summarizeSensorReliabilityCompleteness,
  summarizeSensorReliabilityDrift,
  summarizeSensorReliabilityRmaRegression,
} from "./sensorReliability";

function makeSeries(points: PatSeries["points"]): PatSeries {
  return {
    meta: {
      sensorId: "sensor-1",
      label: "Reliability fixture",
      timezone: "UTC",
    },
    points,
  };
}

function point(day: number, pm25A: number | null, pm25B: number | null, humidity = 45): PatSeries["points"][number] {
  return {
    timestamp: `2024-01-${String(day).padStart(2, "0")}T00:00:00.000Z`,
    pm25A,
    pm25B,
    pm25Cf1A: pm25A,
    pm25Cf1B: pm25B,
    humidity,
    temperature: 70,
    pressure: 1012,
  };
}

describe("sensor reliability report", () => {
  it("summarizes completeness, agreement, RMA, Barkjohn availability, drift, and issues", () => {
    const series = makeSeries([
      point(1, 10, 10.5),
      point(2, 12, 12.4),
      point(3, 14, 14.2),
      point(4, 16, 16.2),
    ]);

    const report = summarizeSensorReliability(series);

    expect(report.sensorId).toBe("sensor-1");
    expect(report.category).toBe("pass");
    expect(report.completeness.pairedCompleteness).toBe(1);
    expect(report.agreement.agreementFraction).toBe(1);
    expect(report.rmaRegression).toEqual(
      expect.objectContaining({
        n: 4,
        category: "pass",
      }),
    );
    expect(report.barkjohn.correctedAvailability).toBe(1);
    expect(report.barkjohn.rhAvailability).toBe(1);
    expect(report.drift.direction).toBe("stable");
    expect(report.issues).toEqual([]);
  });

  it("infers expected points and reports field completeness deterministically", () => {
    const series = makeSeries([
      point(1, 10, 10),
      point(3, 12, null, 50),
    ]);

    const completeness = summarizeSensorReliabilityCompleteness(series, { expectedIntervalMinutes: 24 * 60 });

    expect(completeness.expectedPoints).toBe(3);
    expect(completeness.reportingCompleteness).toBe(0.6667);
    expect(completeness.channelACompleteness).toBe(0.6667);
    expect(completeness.channelBCompleteness).toBe(0.3333);
    expect(completeness.pairedCompleteness).toBe(0.3333);
  });

  it("flags channel disagreement and missing Barkjohn inputs", () => {
    const series = makeSeries([
      { ...point(1, 10, 40), pm25Cf1A: null, pm25Cf1B: null, humidity: null },
      { ...point(2, 12, 42), pm25Cf1A: null, pm25Cf1B: null, humidity: null },
      { ...point(3, 14, 44), pm25Cf1A: null, pm25Cf1B: null, humidity: null },
    ]);

    const agreement = summarizeSensorReliabilityAgreement(series);
    const barkjohn = summarizeBarkjohnAvailability(series);
    const report = summarizeSensorReliability(series);

    expect(agreement.category).toBe("fail");
    expect(agreement.invalidPairs).toBe(3);
    expect(barkjohn.correctedAvailability).toBe(0);
    expect(barkjohn.rhAvailability).toBe(0);
    expect(report.category).toBe("fail");
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["channel-disagreement", "barkjohn-unavailable"]),
    );
  });

  it("returns null RMA regression when fewer than three finite pairs are available", () => {
    const series = makeSeries([
      point(1, 10, 10),
      point(2, 12, null),
      point(3, null, 13),
    ]);

    expect(summarizeSensorReliabilityRmaRegression(series)).toBeNull();

    const report = summarizeSensorReliability(series);
    expect(report.issues.map((issue) => issue.code)).toContain("rma-unavailable");
  });

  it("classifies degrading A/B drift over daily SOH buckets", () => {
    const series = makeSeries([
      point(1, 10, 10),
      point(2, 10, 12),
      point(3, 10, 14),
      point(4, 10, 17),
    ]);

    const drift = summarizeSensorReliabilityDrift(series, {
      driftDeltaPerDayWatchThreshold: 0.5,
      driftDeltaPerDayFailThreshold: 3,
    });

    expect(drift.direction).toBe("degrading");
    expect(drift.category).toBe("watch");
    expect(drift.slopePerDay).toBeGreaterThan(0.5);
  });
});
