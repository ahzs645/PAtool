import { describe, expect, it } from "vitest";

import type { PatSeries } from "./domain";
import { buildCalendarPm25, calculateAirSensorDailyMetrics, runAirSensorQc } from "./airSensorCompat";

function makeSeries(points: PatSeries["points"]): PatSeries {
  return {
    meta: { sensorId: "pa-1", label: "PA fixture", timezone: "UTC" },
    points,
  };
}

function point(hour: number, pm25A: number | null, pm25B: number | null, humidity = 45, temperature = 70) {
  return {
    timestamp: `2024-01-01T${String(hour).padStart(2, "0")}:00:00.000Z`,
    pm25A,
    pm25B,
    humidity,
    temperature,
    pressure: 1012,
  };
}

describe("AirSensor compatibility metrics", () => {
  it("summarizes reporting, validity, calendar PM2.5, and AirSensor index", () => {
    const series = makeSeries([
      point(0, 10, 11),
      point(1, 12, 12),
      point(2, 14, 13),
      point(3, 16, 15),
    ]);

    const soh = calculateAirSensorDailyMetrics(series, { samplingIntervalSeconds: 3600 });
    const calendar = buildCalendarPm25(series, { samplingIntervalSeconds: 3600, dataThreshold: 10 });

    expect(soh.expectedSamplesPerDay).toBe(24);
    expect(soh.metrics[0].reporting.pm25A).toBe(16.67);
    expect(soh.metrics[0].valid.pm25B).toBe(100);
    expect(soh.metrics[0].airSensorIndex).toBe(0);
    expect(calendar.days[0]).toEqual(expect.objectContaining({ pm25: 12.88, label: "Moderate" }));
  });

  it("flags AirSensor physical bounds and hourly channel profile failures", () => {
    const series = makeSeries([
      point(0, 10, 11),
      point(0, 5000, 12),
      point(0, 14, 200, 97),
      point(1, 15, 15, 45, 250),
    ]);

    const qc = runAirSensorQc(series, { profileId: "AB_03", removeOutOfSpec: true, minCount: 1 });

    expect(qc.status).toBe("fail");
    expect(qc.flaggedPoints).toBeGreaterThan(0);
    expect(qc.removedPoints).toBe(qc.flaggedPoints);
    expect(qc.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["pm25-out-of-spec", "humidity-out-of-spec", "temperature-out-of-spec"]),
    );
  });
});
