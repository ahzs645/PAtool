import { describe, expect, it } from "vitest";

import {
  computeHumanImpactMetrics,
  computeLifeTable,
  estimatePm25LifeExpectancyImpact,
  PM25_STANDARDS,
  summarizeMonthlyCompliance,
  type LifeTableAgeBand,
} from "./airQualityMetrics";

describe("monthly compliance summaries", () => {
  it("compares unit and population compliance against a selected PM2.5 standard", () => {
    const rows = summarizeMonthlyCompliance([
      { region: "North", year: 2024, month: 1, pm25: 4, population: 100 },
      { region: "North", year: 2024, month: 1, pm25: 20, population: 300 },
      { region: "North", year: 2024, month: 1, pm25: 45, population: 600 },
    ], "india-annual-pm25");

    expect(rows).toHaveLength(1);
    expect(rows[0].complianceRate).toBeCloseTo(2 / 3, 3);
    expect(rows[0].populationComplianceRate).toBeCloseTo(0.4, 3);
    expect(rows[0].populationWeightedPm25).toBeCloseTo(33.4, 3);
    expect(rows[0].thresholdUgM3).toBe(PM25_STANDARDS["india-annual-pm25"].thresholdUgM3);
  });
});

describe("life table impact", () => {
  const bands: LifeTableAgeBand[] = [
    { ageStart: 0, ageEnd: 20, mortalityProbability: 0.02 },
    { ageStart: 20, ageEnd: 60, mortalityProbability: 0.08 },
    { ageStart: 60, ageEnd: 80, mortalityProbability: 0.5 },
  ];

  it("computes person-years and life expectancy from age-specific mortality", () => {
    const result = computeLifeTable(bands, 100_000);
    expect(result.rows[0].survivorsAtEnd).toBeCloseTo(98_000, 0);
    expect(result.lifeExpectancy).toBeGreaterThan(60);
    expect(result.lifeExpectancy).toBeLessThan(80);
  });

  it("estimates a clean-air counterfactual with higher life expectancy", () => {
    const result = estimatePm25LifeExpectancyImpact({
      bands,
      observedPm25: 35,
      counterfactualPm25: 5,
      relativeRiskPer10UgM3: 1.08,
      initialCohort: 100_000,
    });

    expect(result.relativeRisk).toBeGreaterThan(1);
    expect(result.attributableFraction).toBeGreaterThan(0);
    expect(result.counterfactual.lifeExpectancy).toBeGreaterThan(result.observed.lifeExpectancy);
    expect(result.cohortYearsLost).toBeCloseTo(result.yearsLostPerPerson * 100_000, 3);
  });
});

describe("human impact metrics", () => {
  it("combines life years lost and disability years into DALYs", () => {
    const metrics = computeHumanImpactMetrics({
      lifeYearsLost: 5,
      yearsWithCondition: 30,
      disabilityWeight: 0.2,
      pollutionFev1DeclineMlPerYear: 22.5,
      exposureYears: 10,
    });

    expect(metrics.yearsLivedWithDisability).toBeCloseTo(6, 3);
    expect(metrics.disabilityAdjustedLifeYears).toBeCloseTo(11, 3);
    expect(metrics.lungAgingRate).toBeCloseTo(1.9, 3);
    expect(metrics.extraLungAgeYears).toBeCloseTo(9, 3);
  });
});
