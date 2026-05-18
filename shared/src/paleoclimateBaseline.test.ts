import { describe, expect, it } from "vitest";

import {
  findBaselineEpoch,
  paleoclimateAnomaly,
  PREINDUSTRIAL_PM25_BASELINE,
  preIndustrialPm25Anomaly,
} from "./paleoclimateBaseline";

describe("paleoclimate baseline", () => {
  it("classifies an observation against its epoch", () => {
    const baseline = findBaselineEpoch(PREINDUSTRIAL_PM25_BASELINE, 1800);
    expect(baseline?.epoch).toBe("Pre-industrial");
  });

  it("computes a positive anomaly for present-day PM2.5", () => {
    const anomaly = preIndustrialPm25Anomaly(15, 2025);
    expect(anomaly.observed).toBe(15);
    expect(anomaly.absoluteAnomaly).toBeGreaterThan(0);
    expect(anomaly.percentAnomaly).toBeGreaterThan(0);
  });

  it("computes anomalies relative to an arbitrary baseline", () => {
    const baseline = PREINDUSTRIAL_PM25_BASELINE.find((row) => row.epoch === "Industrial")!;
    const anomaly = paleoclimateAnomaly(20, 1900, baseline);
    expect(anomaly.epoch).toBe("Industrial");
    expect(anomaly.absoluteAnomaly).toBeCloseTo(8, 6);
  });
});
