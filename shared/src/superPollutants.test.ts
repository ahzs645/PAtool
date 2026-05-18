import { describe, expect, it } from "vitest";

import { AR6_GWP, decomposeSlcp, slcpShare, type SlcpInventoryRow } from "./superPollutants";

const INVENTORY: SlcpInventoryRow[] = [
  { region: "US", year: 2020, species: "CO2",  tonnes: 5_000_000_000 },
  { region: "US", year: 2020, species: "CH4",  tonnes: 25_000_000 },
  { region: "US", year: 2020, species: "BC",   tonnes: 200_000 },
  { region: "US", year: 2020, species: "HFCs", tonnes: 50_000 },
  { region: "US", year: 2020, species: "SO2",  tonnes: 4_000_000 },
];

describe("decomposeSlcp", () => {
  it("groups inventory rows by region+year and computes CO2e totals", () => {
    const decomp = decomposeSlcp(INVENTORY);
    expect(decomp).toHaveLength(1);
    expect(decomp[0].region).toBe("US");
    expect(decomp[0].year).toBe(2020);
    expect(decomp[0].byClass.longLived).toBe(5_000_000_000); // CO2 unchanged
    expect(decomp[0].byClass.methane).toBeCloseTo(25_000_000 * AR6_GWP.CH4.GWP100, 0);
    expect(decomp[0].byClass.blackCarbon).toBeCloseTo(200_000 * AR6_GWP.BC.GWP100, 0);
  });

  it("supports a GWP20 horizon", () => {
    const decomp = decomposeSlcp(INVENTORY, "GWP20");
    expect(decomp[0].byClass.methane).toBeCloseTo(25_000_000 * AR6_GWP.CH4.GWP20, 0);
  });
});

describe("slcpShare", () => {
  it("returns the SLCP fraction of the total GWP20 budget", () => {
    const decomp = decomposeSlcp(INVENTORY);
    const share = slcpShare(decomp[0]);
    expect(share.methane).toBeGreaterThan(0);
    expect(share.methane).toBeLessThan(1);
    expect(share.combinedSlcp).toBeGreaterThan(share.methane);
  });
});
