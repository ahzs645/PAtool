import { describe, expect, it } from "vitest";

import { rankDataReadiness, scoreDataReadiness, summarizeMonitorMetadata } from "./dataReadiness";

describe("monitor metadata coverage", () => {
  it("summarizes official and inferred metadata completeness by country", () => {
    const summaries = summarizeMonitorMetadata([
      { uniqueId: "a", iso: "usa", latitude: 40, longitude: -77, area: "urban", type: "background", labeledArea: true, labeledType: false },
      { uniqueId: "b", iso: "usa", latitude: 41, longitude: -78, elevation: 100, area: "rural", type: "background", labeledArea: true, labeledType: true },
      { uniqueId: "c", iso: "ind", latitude: 28, longitude: 77, area: "urban", type: null, labeledArea: false, labeledType: false },
    ]);

    expect(summaries[0].iso).toBe("USA");
    expect(summaries[0].monitorCount).toBe(2);
    expect(summaries[0].coordinateCoverage).toBe(1);
    expect(summaries[0].officialTypeCoverage).toBe(0.5);
    expect(summaries[0].metadataCompleteness).toBeGreaterThan(0.7);
  });
});

describe("data readiness scoring", () => {
  it("puts non-monitoring countries in the not-monitoring tier", () => {
    const score = scoreDataReadiness({ country: "Example", governmentMonitoring2024: false });
    expect(score.score).toBe(0);
    expect(score.tier).toBe("not-monitoring");
  });

  it("ranks open, machine-readable sources above partial sources", () => {
    const rows = rankDataReadiness([
      {
        country: "Openland",
        governmentMonitoring2024: true,
        publicAccessInCountry: true,
        fullyTransparent: true,
        physicalUnitsAvailable: true,
        stationCoordinatesAvailable: true,
        timelyFineScaleAvailable: true,
        programmaticAccessAvailable: true,
      },
      {
        country: "Partialia",
        governmentMonitoring2024: true,
        publicAccessInCountry: true,
        partiallyTransparent: true,
        physicalUnitsAvailable: true,
        stationCoordinatesAvailable: true,
      },
    ]);

    expect(rows[0].country).toBe("Openland");
    expect(rows[0].tier).toBe("excellent");
    expect(rows[1].tier).toBe("limited");
  });
});
