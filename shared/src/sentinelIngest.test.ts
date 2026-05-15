import { describe, expect, it } from "vitest";

import { estimateLowerQuantileBaseline } from "./baseline";
import { parseSentinelCsv, inferSentinelColumnMapping, normalizeSentinelRows } from "./sentinelIngest";
import { buildSentinelCollocationTable, buildSentinelQaTable, summarizeSentinelSensors } from "./qaReports";
import { summarizeSentinelQa } from "./qaFlags";
import { aggregateSentinelRecords } from "./timeAggregation";
import { buildSourceDirectionBins } from "./sourceAttribution";

const CSV = `Local Date Time,Sensor ID,pid1_PPB_Calc,ws_speed,ws_direction,temp,rh_Humd,lat,long,trig.trig_activeFlag,QA
2023-06-12 00:00:00,A,10,2,350,20,45,49.25,-123.1,1,None
2023-06-12 00:01:00,A,12,2,10,21,46,49.25,-123.1,,Calibration
2023-06-12 00:04:00,A,,45,370,22,47,49.25,-123.1,,
2023-06-12 00:05:00,B,8,1,90,19,44,49.26,-123.11,,
2023-06-12 00:07:00,B,10,1,90,20,45,49.26,-123.11,,`;

describe("SENTINEL-style import and QA modules", () => {
  it("parses CSV, infers columns, normalizes rows, and applies automatic flags", () => {
    const rows = parseSentinelCsv(CSV);
    const mapping = inferSentinelColumnMapping(Object.keys(rows[0]));
    const normalized = normalizeSentinelRows(rows, { mapping, autoQa: true });
    const qa = summarizeSentinelQa(normalized);

    expect(mapping.timestamp).toBe("Local Date Time");
    expect(mapping.signal).toBe("pid1_PPB_Calc");
    expect(normalized).toHaveLength(5);
    expect(normalized[0].timestamp).toBe("2023-06-12T00:00:00.000Z");
    expect(normalized[1].qaFlags).toContain("Calibration");
    expect(normalized[2].qaFlags).toContain("Missing_Signal");
    expect(normalized[2].qaFlags).toContain("WS_offscale");
    expect(normalized[2].qaFlags).toContain("WD_offscale");
    expect(qa.flaggedRows).toBe(2);
  });

  it("aggregates to five-minute bins with vector-averaged wind direction", () => {
    const rows = parseSentinelCsv(CSV);
    const mapping = inferSentinelColumnMapping(Object.keys(rows[0]));
    const normalized = normalizeSentinelRows(rows, { mapping, autoQa: true });
    const aggregated = aggregateSentinelRecords(normalized, { intervalMinutes: 5 });

    expect(aggregated).toHaveLength(2);
    expect(aggregated[0]).toMatchObject({
      sensorId: "A",
      timestamp: "2023-06-12T00:00:00.000Z",
      count: 3,
      latitude: 49.25,
      longitude: -123.1,
    });
    expect(aggregated[0].signal).toBe(11);
    expect(aggregated[0].windDirection).not.toBeNull();
  });

  it("builds baseline, summary, QA, collocation, and source-direction outputs", () => {
    const rows = parseSentinelCsv(CSV);
    const mapping = inferSentinelColumnMapping(Object.keys(rows[0]));
    const normalized = normalizeSentinelRows(rows, { mapping, autoQa: true });
    const baseline = estimateLowerQuantileBaseline(normalized.map((row) => row.signal), { windowSize: 3 });
    const aggregated = aggregateSentinelRecords(normalized, { intervalMinutes: 5 });
    const sensorA = aggregated.filter((row) => row.sensorId === "A");
    const sensorB = aggregated.filter((row) => row.sensorId === "B");

    expect(baseline.baseline).toHaveLength(normalized.length);
    expect(baseline.corrected[0]).not.toBeNull();
    expect(summarizeSentinelSensors(aggregated)).toHaveLength(2);
    expect(buildSentinelQaTable(sensorA).find((row) => row.variable === "signal")?.mean).toBe(11);
    expect(buildSentinelCollocationTable(sensorA, sensorB).find((row) => row.variable === "signal")?.meanDelta).toBe(2);
    expect(buildSourceDirectionBins(aggregated).some((bin) => bin.count > 0)).toBe(true);
  });
});
