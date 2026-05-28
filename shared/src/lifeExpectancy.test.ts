import { describe, expect, it } from "vitest";

import { lifeExpectancyLoss, yllAcrossPopulations } from "./lifeExpectancy";

describe("APTE life-expectancy loss", () => {
  it("returns zero loss at or below the counterfactual", () => {
    expect(lifeExpectancyLoss(5).yearsLifeLost).toBe(0);
    expect(lifeExpectancyLoss(3).yearsLifeLost).toBe(0);
  });

  it("loss increases monotonically with exposure", () => {
    const low = lifeExpectancyLoss(20).yearsLifeLost;
    const high = lifeExpectancyLoss(60).yearsLifeLost;
    expect(high).toBeGreaterThan(low);
  });

  it("aggregates across populations", () => {
    const result = yllAcrossPopulations([
      { label: "A", population: 100_000, pm25Exposure: 30 },
      { label: "B", population: 200_000, pm25Exposure: 50 },
    ]);
    expect(result).toHaveLength(2);
    expect(result[1].totalPersonYearsLost).toBeGreaterThan(result[0].totalPersonYearsLost);
  });
});
