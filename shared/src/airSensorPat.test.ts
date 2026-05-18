import { describe, expect, it } from "vitest";

import { patChannelExternalFit, patChannelInternalFit } from "./airSensorPat";

describe("patChannelInternalFit", () => {
  it("returns slope=1 / intercept=0 / r²≈1 / 0 percent diff for matched channels", () => {
    const samples = Array.from({ length: 20 }, (_, i) => ({
      timestamp: new Date(2025, 0, 1, i).toISOString(),
      pm25A: i + 1,
      pm25B: i + 1,
    }));
    const fit = patChannelInternalFit(samples);
    expect(fit.channel).toBe("A-vs-B");
    expect(fit.slope).toBeCloseTo(1, 6);
    expect(fit.intercept).toBeCloseTo(0, 6);
    expect(fit.r2).toBeCloseTo(1, 6);
    expect(fit.meanAbsPercentDiff).toBeCloseTo(0, 6);
  });

  it("skips samples with null channels", () => {
    const samples = [
      { timestamp: "2025-01-01T00:00:00Z", pm25A: 1, pm25B: null },
      { timestamp: "2025-01-01T01:00:00Z", pm25A: 2, pm25B: 2 },
      { timestamp: "2025-01-01T02:00:00Z", pm25A: 3, pm25B: 3 },
    ];
    const fit = patChannelInternalFit(samples);
    expect(fit.n).toBe(2);
  });
});

describe("patChannelExternalFit", () => {
  it("regresses PA against a federal reference", () => {
    const samples = Array.from({ length: 30 }, (_, i) => ({
      timestamp: new Date(2025, 0, 1, i).toISOString(),
      patPm25: 1.5 * (i + 1),
      referencePm25: i + 1,
    }));
    const fit = patChannelExternalFit(samples);
    expect(fit.channel).toBe("external");
    expect(fit.slope).toBeCloseTo(1.5, 6);
    expect(fit.intercept).toBeCloseTo(0, 6);
  });
});
