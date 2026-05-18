import { describe, expect, it } from "vitest";

import { pollenPm25Interaction, type PollenPm25Day } from "./pollenInteraction";

const DAYS: PollenPm25Day[] = [
  { date: "2025-04-01", pm25: 5,  pollenGrainsPerM3: 50 },
  { date: "2025-04-02", pm25: 8,  pollenGrainsPerM3: 90 },
  { date: "2025-04-03", pm25: 18, pollenGrainsPerM3: 1200 },
  { date: "2025-04-04", pm25: 25, pollenGrainsPerM3: 2500 },
  { date: "2025-04-05", pm25: 6,  pollenGrainsPerM3: 80 },
];

describe("pollenPm25Interaction", () => {
  it("returns a positive Spearman correlation when pm25 and pollen co-vary", () => {
    const out = pollenPm25Interaction(DAYS);
    expect(out.n).toBe(5);
    expect(out.spearmanCorrelation).toBeGreaterThan(0.8);
  });

  it("populates the contingency table around the supplied thresholds", () => {
    const out = pollenPm25Interaction(DAYS, { pm25Threshold: 10, pollenThreshold: 500 });
    expect(out.contingency.highHigh).toBe(2);
    expect(out.contingency.lowLow).toBe(3);
    expect(out.jointHighDays).toContain("2025-04-03");
    expect(out.jointHighDays).toContain("2025-04-04");
  });
});
