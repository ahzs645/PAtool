import { describe, expect, it } from "vitest";

import { countStandardsCoverageBuckets, summarizeStandardsCoverage } from "./standardsCoverage";

describe("standards coverage", () => {
  it("counts pollutants with any valid national standard", () => {
    const summaries = summarizeStandardsCoverage([
      { iso3: "AAA", country: "Full", pollutant: "PM25", duration: "yr", numericStandard: 5 },
      { iso3: "AAA", country: "Full", pollutant: "PM25", duration: "24h", numericStandard: 15 },
      { iso3: "AAA", country: "Full", pollutant: "PM10", duration: "yr", numericStandard: 20 },
      { iso3: "AAA", country: "Full", pollutant: "NO2", duration: "yr", numericStandard: 10 },
      { iso3: "AAA", country: "Full", pollutant: "SO2", duration: "24h", numericStandard: 40 },
      { iso3: "AAA", country: "Full", pollutant: "O3", duration: "8h", numericStandard: 100 },
      { iso3: "AAA", country: "Full", pollutant: "CO", duration: "8h", numericStandard: 10000 },
      { iso3: "BBB", country: "Partial", pollutant: "PM25", duration: "yr", numericStandard: 40 },
      { iso3: "BBB", country: "Partial", pollutant: "NO2", duration: "yr", numericStandard: null },
    ]);

    expect(summaries[0].pollutantCount).toBe(6);
    expect(summaries[0].pm25AnnualTier).toBe("who-aligned");
    expect(summaries[1].pollutantCount).toBe(1);
    expect(summaries[1].pm25AnnualTier).toBe("lenient");
  });

  it("builds fixed 0-6 coverage buckets", () => {
    const buckets = countStandardsCoverageBuckets([
      {
        iso3: "AAA",
        country: "Full",
        pollutantCount: 6,
        coverageFraction: 1,
        pollutantsWithStandards: ["PM25", "PM10", "NO2", "SO2", "O3", "CO"],
        missingPollutants: [],
        pm25AnnualStandard: 5,
        pm25AnnualTier: "who-aligned",
      },
    ]);

    expect(buckets).toHaveLength(7);
    expect(buckets[6]).toMatchObject({ pollutantCount: 6, countries: 1, percent: 100 });
  });
});
