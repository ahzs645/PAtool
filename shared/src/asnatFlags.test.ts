import { describe, expect, it } from "vitest";

import {
  compileFlagExpression,
  evaluateFlagExpression,
  exportFlagConditions,
  flagAsnatSeries,
  flagNeighborPair,
  type AsnatRow,
} from "./asnatFlags";

describe("ASNAT flag expression engine", () => {
  it("evaluates the documented compound condition", () => {
    const predicate = compileFlagExpression("(id = 44275 or id = 99449) and count < 25");
    expect(predicate({ timestamp: "t", id: 44275, count: 10 })).toBe(true);
    expect(predicate({ timestamp: "t", id: 99449, count: 24 })).toBe(true);
    expect(predicate({ timestamp: "t", id: 44275, count: 30 })).toBe(false);
    expect(predicate({ timestamp: "t", id: 12345, count: 10 })).toBe(false);
  });

  it("honors arithmetic precedence (2 + 3 * 4 = 14)", () => {
    expect(evaluateFlagExpression("2 + 3 * 4 = 14", { timestamp: "t" })).toBe(true);
    expect(evaluateFlagExpression("2 + 3 * 4 = 20", { timestamp: "t" })).toBe(false);
  });

  it("treats ^ as right-associative (2^3^2 = 512)", () => {
    expect(evaluateFlagExpression("2 ^ 3 ^ 2 = 512", { timestamp: "t" })).toBe(true);
  });

  it("compares against datetime literals", () => {
    const predicate = compileFlagExpression(
      "2022-06-01T00:00:00Z <= timestamp and timestamp <= 2022-06-01T05:00:00Z",
    );
    expect(predicate({ timestamp: "2022-06-01T03:00:00Z" })).toBe(true);
    expect(predicate({ timestamp: "2022-06-01T09:00:00Z" })).toBe(false);
  });

  it("flags negative corrected values via a user condition", () => {
    const predicate = compileFlagExpression("pm25_corrected_hourly < 0");
    expect(predicate({ timestamp: "t", pm25_corrected_hourly: -2 })).toBe(true);
    expect(predicate({ timestamp: "t", pm25_corrected_hourly: 5 })).toBe(false);
  });

  it("supports the # comment header used in flags.txt", () => {
    const predicate = compileFlagExpression("#flag condition 2\npm25_corrected_hourly < 0");
    expect(predicate({ timestamp: "t", pm25_corrected_hourly: -1 })).toBe(true);
  });
});

function series(values: Array<number | null>, startHour = 0): AsnatRow[] {
  return values.map((value, i) => ({
    timestamp: `2022-06-01T${String(startHour + i).padStart(2, "0")}:00:00+0000`,
    id: "A",
    value,
  }));
}

describe("ASNAT built-in flags", () => {
  it("flags negative values as 60", () => {
    const result = flagAsnatSeries(series([5, -1, 3]), { negative: true });
    expect(result[1].flags).toContain(60);
    expect(result[0].code).toBe("0");
  });

  it("flags constant runs as 83 and missing runs as 84", () => {
    const constant = flagAsnatSeries(series([5, 5, 5, 6]), { constantRun: 3 });
    expect(constant[0].flags).toContain(83);
    expect(constant[2].flags).toContain(83);
    expect(constant[3].flags).not.toContain(83);

    const missing = flagAsnatSeries(series([null, null, 5, 6]), { missingRun: 2 });
    expect(missing[0].flags).toContain(84);
    expect(missing[1].flags).toContain(84);
    expect(missing[2].flags).not.toContain(84);
  });

  it("flags statistical outliers as 85", () => {
    const result = flagAsnatSeries(series([10, 10, 10, 10, 10, 10, 10, 10, 10, 100]), { zScore: { k: 2 } });
    expect(result[9].flags).toContain(85);
    expect(result[0].flags).not.toContain(85);
  });

  it("flags Hampel outliers as 86", () => {
    const result = flagAsnatSeries(series([10, 11, 9, 50, 10, 11, 9]), { hampel: { window: 3, threshold: 3 } });
    expect(result[3].flags).toContain(86);
  });

  it("flags sudden spikes as 70", () => {
    const result = flagAsnatSeries(series([10, 10, 10, 16]), { spike: { window: 3, threshold: 0.5 } });
    expect(result[3].flags).toContain(70);
  });

  it("flags duplicate timestamps at the same location as 90", () => {
    const rows: AsnatRow[] = [
      { timestamp: "2022-06-01T00:00:00+0000", id: "A", longitude: -80.456, latitude: 35.123, value: 5 },
      { timestamp: "2022-06-01T00:00:00+0000", id: "A", longitude: -80.456, latitude: 35.123, value: 6 },
      { timestamp: "2022-06-01T01:00:00+0000", id: "A", longitude: -80.456, latitude: 35.123, value: 7 },
    ];
    const result = flagAsnatSeries(rows, { duplicateLocation: true });
    expect(result[0].flags).toContain(90);
    expect(result[1].flags).toContain(90);
    expect(result[2].flags).not.toContain(90);
  });

  it("flags malformed timestamps as 95", () => {
    const rows: AsnatRow[] = [
      { timestamp: "2022-06-01T00:00:00+0000", id: "A", value: 1 },
      { timestamp: "2022/06/01 00:00", id: "A", value: 2 },
    ];
    const result = flagAsnatSeries(rows, { dateFormat: true });
    expect(result[0].flags).not.toContain(95);
    expect(result[1].flags).toContain(95);
  });

  it("assembles a semicolon-joined flagged column", () => {
    const result = flagAsnatSeries(series([-5, -5, -5]), { negative: true, constantRun: 3 });
    expect(result[0].code).toBe("60;83");
  });

  it("flags inconsistent daily ozone (72) and PM (73) patterns", () => {
    const ozone: AsnatRow[] = [
      { timestamp: "2022-06-01T02:00:00+0000", id: "A", value: 80 }, // night spike
      { timestamp: "2022-06-01T06:00:00+0000", id: "A", value: 30 },
      { timestamp: "2022-06-01T09:00:00+0000", id: "A", value: 31 },
      { timestamp: "2022-06-01T12:00:00+0000", id: "A", value: 32 },
      { timestamp: "2022-06-01T15:00:00+0000", id: "A", value: 30 },
      { timestamp: "2022-06-01T18:00:00+0000", id: "A", value: 31 },
    ];
    const o3 = flagAsnatSeries(ozone, { dailyPattern: true, pollutant: "ozone" });
    expect(o3[0].flags).toContain(72);

    const pm: AsnatRow[] = [
      { timestamp: "2022-06-01T07:00:00+0000", id: "A", value: 25 },
      { timestamp: "2022-06-01T08:00:00+0000", id: "A", value: 24 },
      { timestamp: "2022-06-01T16:00:00+0000", id: "A", value: 80 }, // afternoon spike
      { timestamp: "2022-06-01T21:00:00+0000", id: "A", value: 25 },
      { timestamp: "2022-06-01T22:00:00+0000", id: "A", value: 26 },
    ];
    const pmFlags = flagAsnatSeries(pm, { dailyPattern: true, pollutant: "pm" });
    expect(pmFlags[2].flags).toContain(73);
  });
});

describe("ASNAT neighbor flags", () => {
  it("flags neighbor difference (80), percent difference (81), and low-R2 pairs (82)", () => {
    const samples = [
      { x: 10, y: 10 },
      { x: 10, y: 30 }, // big abs + percent difference
      { x: 12, y: 11 },
    ];
    const result = flagNeighborPair(samples, { maxDifference: 10, maxPercentDifference: 50, minRSquared: 0.7 });
    expect(result[1].flags).toContain(80);
    expect(result[1].flags).toContain(81);
    // Poor correlation -> every row of the pair gets 82.
    expect(result[0].flags).toContain(82);
    expect(result[2].flags).toContain(82);
  });
});

describe("flags.txt export", () => {
  it("serializes conditions with numbered comment headers", () => {
    const txt = exportFlagConditions(["id = 44275 and count < 25", "pm25_corrected_hourly < 0"]);
    expect(txt).toContain("#flag condition 1");
    expect(txt).toContain("#flag condition 2");
    expect(txt).toContain("pm25_corrected_hourly < 0");
  });
});
