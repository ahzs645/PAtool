import { describe, expect, it } from "vitest";

import { decomposeSuperPollutants } from "./superPollutants";

describe("super-pollutant decomposition", () => {
  it("decomposes a mix of CO₂ and methane into 20yr/100yr equivalents", () => {
    const summary = decomposeSuperPollutants([
      { pollutant: "co2", tonnesPerYear: 1_000_000 },
      { pollutant: "ch4", tonnesPerYear: 10_000 },
    ]);
    expect(summary.totalCo2eq20).toBeGreaterThan(summary.totalCo2eq100);
    expect(summary.rows.find((r) => r.pollutant === "ch4")?.co2eq20).toBeGreaterThan(0);
  });

  it("accounts for premature deaths from BC", () => {
    const s = decomposeSuperPollutants([{ pollutant: "bc", tonnesPerYear: 1_000_000 }]);
    expect(s.totalPrematureDeathsPerYear).toBeGreaterThan(0);
  });

  it("respects custom GWP overrides", () => {
    const s = decomposeSuperPollutants([{ pollutant: "co2", tonnesPerYear: 1, gwp20Override: 5 }]);
    expect(s.rows[0].co2eq20).toBe(5);
  });
});
