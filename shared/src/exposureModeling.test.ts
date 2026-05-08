import { describe, expect, it } from "vitest";

import {
  attributableRiskForExposure,
  estimateIndoorPm25,
  INFILTRATION_PROFILES,
  rapidfireExposureSeries,
  WILDFIRE_RR_TABLE,
} from "./exposureModeling";

describe("indoor infiltration model", () => {
  it("typical-hvac drops indoor PM2.5 from 100 to ~40 outside smoke and ~20 inside smoke", () => {
    const nonSmoke = estimateIndoorPm25({ outdoorPm25: 100, buildingClass: "typical-hvac", smoke: false });
    const smoke = estimateIndoorPm25({ outdoorPm25: 100, buildingClass: "typical-hvac", smoke: true });
    expect(nonSmoke.indoorPm25).toBeCloseTo(40, 0);
    expect(smoke.indoorPm25).toBeCloseTo(20, 0);
    expect(smoke.indoorPm25).toBeLessThan(nonSmoke.indoorPm25);
  });

  it("includes optional indoor source contributions", () => {
    const result = estimateIndoorPm25({
      outdoorPm25: 50,
      buildingClass: "typical-hvac",
      smoke: false,
      indoorSourceContribution: 5,
    });
    expect(result.indoorPm25).toBeCloseTo(50 * 0.4 + 5, 3);
  });

  it("classifies all six building classes", () => {
    expect(Object.keys(INFILTRATION_PROFILES)).toHaveLength(6);
  });
});

describe("rapidfire-style retrospective exposure", () => {
  it("attributes only smoke-day excess to wildfire PM2.5", () => {
    const daily = [
      { date: "2024-08-01", referencePm25: 6, smokeFlag: false },
      { date: "2024-08-02", referencePm25: 8, smokeFlag: false },
      { date: "2024-08-03", referencePm25: 7, smokeFlag: false },
      { date: "2024-08-04", referencePm25: 35, smokeFlag: true },
      { date: "2024-08-05", referencePm25: 9, smokeFlag: false },
    ];
    const result = rapidfireExposureSeries(daily);
    expect(result[0].smokeAttributedPm25).toBe(0);
    expect(result[3].smokeAttributedPm25).toBeGreaterThan(20);
    expect(result[3].backgroundPm25).toBeGreaterThan(5);
    expect(result[3].backgroundPm25).toBeLessThan(10);
  });
});

describe("wildfire RR table", () => {
  it("ships at least four well-cited outcomes with non-trivial point estimates", () => {
    expect(WILDFIRE_RR_TABLE.length).toBeGreaterThanOrEqual(4);
    for (const row of WILDFIRE_RR_TABLE) {
      expect(row.rrPer10).toBeGreaterThanOrEqual(1);
      expect(row.ci95Lower).toBeLessThanOrEqual(row.rrPer10);
      expect(row.ci95Upper).toBeGreaterThanOrEqual(row.rrPer10);
      expect(row.citation.length).toBeGreaterThan(10);
    }
  });

  it("computes excess risk percentages from regime-tagged exposure", () => {
    const rows = attributableRiskForExposure(20, "moderate-smoke");
    expect(rows.length).toBe(WILDFIRE_RR_TABLE.length);
    for (const row of rows) {
      expect(row.excessRiskPercent).toBeGreaterThanOrEqual(0);
      expect(row.attributableExposureUgM3).toBe(20);
    }
    expect(attributableRiskForExposure(20, "non-smoke")).toEqual([]);
  });
});
