import { describe, expect, it } from "vitest";

import {
  airnowLoadDaily,
  airsisLoadAnnual,
  clarityLoadLatest,
  epaAqsLoadAnnual,
  wrccLoadAnnual,
} from "./monitorLoaders";

const csv = [
  "timestamp,pm25",
  "2024-01-01T00:00:00Z,10",
  "2024-01-01T01:00:00Z,12",
  "2024-01-01T02:00:00Z,",
].join("\n");

describe("monitor loaders", () => {
  it("airsis loader produces an MtsMonitor", async () => {
    const m = await airsisLoadAnnual({ fetcher: async () => csv, year: 2024, unitId: "USFS123" });
    expect(m.meta).toHaveLength(1);
    expect(m.data.datetime).toHaveLength(3);
    expect(m.data.data[m.meta[0].id][2]).toBeNull();
  });

  it("wrcc loader passes through station id", async () => {
    const m = await wrccLoadAnnual({ fetcher: async () => csv, year: 2024, station: "DFLT" });
    expect(m.meta[0].id).toContain("DFLT");
  });

  it("airnow loader uses date in id", async () => {
    const m = await airnowLoadDaily({ fetcher: async () => csv, date: "2024-07-04" });
    expect(m.meta[0].id).toContain("2024-07-04");
  });

  it("epa aqs loader records parameter and units", async () => {
    const m = await epaAqsLoadAnnual({ fetcher: async () => csv, year: 2024, parameter: "pm25" });
    expect(m.meta[0].parameter).toBe("pm25");
    expect(m.meta[0].units).toBe("ug/m3");
  });

  it("clarity loader handles JSON results", async () => {
    const json = JSON.stringify({ results: [{ datetime: "2024-01-01T00:00:00Z", value: 7 }] });
    const m = await clarityLoadLatest({ fetcher: async () => json });
    expect(m.data.datetime).toHaveLength(1);
  });
});
