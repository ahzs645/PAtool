import { describe, expect, it } from "vitest";

import { importPurpleAirCsv } from "./purpleairCsvImport";
import { pasCollectionSchema, patSeriesSchema } from "./domain";

const HEADER = "time_stamp,humidity,temperature,pressure,pm1.0_cf_1,pm2.5_cf_1,pm10.0_cf_1,sensor_number,latitude,longitude";

function dayCsv(date: string, rows: Array<[hour: string, sn: string, pm: number, lat: number, lon: number]>): string {
  const body = rows
    .map(([hour, sn, pm, lat, lon]) => `${date} ${hour}:00:00+00:00,50,60,1010,${pm / 2},${pm},${pm * 1.2},${sn},${lat},${lon}`)
    .join("\n");
  return `${HEADER}\n${body}\n`;
}

describe("importPurpleAirCsv", () => {
  it("parses daily exports into collection, series, and network", () => {
    const files = [
      { name: "2022-11-17.csv", text: dayCsv("2022-11-17", [["00", "1001", 4, 53.9, -122.8], ["01", "1001", 6, 53.9, -122.8], ["00", "2002", 10, 53.8, -122.7]]) },
      { name: "2022-11-18.csv", text: dayCsv("2022-11-18", [["00", "1001", 8, 53.9, -122.8], ["00", "2002", 12, 53.8, -122.7]]) },
    ];

    const result = importPurpleAirCsv(files);

    // Valid against the runtime schemas the app expects.
    expect(pasCollectionSchema.safeParse(result.collection).success).toBe(true);
    result.series.forEach((s) => expect(patSeriesSchema.safeParse(s).success).toBe(true));

    expect(result.summary.sensorCount).toBe(2);
    expect(result.summary.rowCount).toBe(5);
    expect(result.summary.start).toBe("2022-11-17T00:00:00Z");
    expect(result.summary.end).toBe("2022-11-18T00:00:00Z");

    const s1001 = result.series.find((s) => s.meta.sensorId === "1001");
    expect(s1001?.points).toHaveLength(3);
    // Points are ascending and both channels carry the single combined value.
    expect(s1001?.points[0].pm25A).toBe(4);
    expect(s1001?.points[0].pm25B).toBe(4);
    expect(s1001?.points.at(-1)?.timestamp).toBe("2022-11-18T00:00:00Z");

    const rec1001 = result.collection.records.find((r) => r.id === "1001");
    expect(rec1001?.locationType).toBe("outside");
    expect(rec1001?.pm25Current).toBe(8); // last reading
    expect(rec1001?.latitude).toBeCloseTo(53.9);

    // Network is daily-bucketed with one frame per day.
    expect(result.network.timestamps).toEqual(["2022-11-17T00:00:00Z", "2022-11-18T00:00:00Z"]);
    expect(result.network.sites).toHaveLength(2);
  });

  it("drops implausible rows and warns about single-channel data", () => {
    const files = [
      { name: "d.csv", text: dayCsv("2022-11-17", [["00", "1001", 5, 53.9, -122.8], ["01", "1001", 9001, 53.9, -122.8]]) },
    ];
    const result = importPurpleAirCsv(files);
    expect(result.summary.droppedRows).toBe(1);
    expect(result.warnings.some((w) => /identical channels/i.test(w))).toBe(true);
  });

  it("throws when no usable rows are present", () => {
    expect(() => importPurpleAirCsv([{ name: "empty.csv", text: "a,b,c\n1,2,3\n" }])).toThrow();
  });
});
