export type AirQualityStandardKey = "who-annual-pm25" | "india-annual-pm25" | "us-annual-pm25";

export type AirQualityStandard = {
  key: AirQualityStandardKey;
  label: string;
  pollutant: "pm25";
  averagingPeriod: "annual";
  thresholdUgM3: number;
  jurisdiction: string;
};

export const PM25_STANDARDS: Record<AirQualityStandardKey, AirQualityStandard> = {
  "who-annual-pm25": {
    key: "who-annual-pm25",
    label: "WHO annual guideline",
    pollutant: "pm25",
    averagingPeriod: "annual",
    thresholdUgM3: 5,
    jurisdiction: "World Health Organization",
  },
  "india-annual-pm25": {
    key: "india-annual-pm25",
    label: "India annual standard",
    pollutant: "pm25",
    averagingPeriod: "annual",
    thresholdUgM3: 40,
    jurisdiction: "India NAAQS",
  },
  "us-annual-pm25": {
    key: "us-annual-pm25",
    label: "US annual standard",
    pollutant: "pm25",
    averagingPeriod: "annual",
    thresholdUgM3: 9,
    jurisdiction: "US EPA",
  },
};

export type MonthlyExposureUnit = {
  region: string;
  year: number;
  month: number;
  pm25: number;
  population?: number;
};

export type MonthlyComplianceCell = {
  region: string;
  year: number;
  month: number;
  thresholdUgM3: number;
  unitCount: number;
  compliantUnitCount: number;
  complianceRate: number;
  population?: number;
  compliantPopulation?: number;
  populationComplianceRate?: number;
  meanPm25: number;
  populationWeightedPm25?: number;
};

export function summarizeMonthlyCompliance(
  units: ReadonlyArray<MonthlyExposureUnit>,
  standard: AirQualityStandard | AirQualityStandardKey,
): MonthlyComplianceCell[] {
  const resolved = typeof standard === "string" ? PM25_STANDARDS[standard] : standard;
  const groups = new Map<string, MonthlyExposureUnit[]>();

  for (const unit of units) {
    if (!Number.isFinite(unit.pm25) || unit.month < 1 || unit.month > 12) continue;
    const key = `${unit.region}\u0000${unit.year}\u0000${unit.month}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(unit);
    else groups.set(key, [unit]);
  }

  return Array.from(groups.values())
    .map((bucket) => {
      const first = bucket[0];
      const compliant = bucket.filter((unit) => unit.pm25 <= resolved.thresholdUgM3);
      const populationRows = bucket.filter((unit) => Number.isFinite(unit.population) && (unit.population ?? 0) > 0);
      const population = sum(populationRows.map((unit) => unit.population ?? 0));
      const compliantPopulation = sum(populationRows
        .filter((unit) => unit.pm25 <= resolved.thresholdUgM3)
        .map((unit) => unit.population ?? 0));
      const weightedNumerator = sum(populationRows.map((unit) => unit.pm25 * (unit.population ?? 0)));

      return {
        region: first.region,
        year: first.year,
        month: first.month,
        thresholdUgM3: resolved.thresholdUgM3,
        unitCount: bucket.length,
        compliantUnitCount: compliant.length,
        complianceRate: compliant.length / bucket.length,
        population: populationRows.length ? population : undefined,
        compliantPopulation: populationRows.length ? compliantPopulation : undefined,
        populationComplianceRate: populationRows.length ? compliantPopulation / population : undefined,
        meanPm25: mean(bucket.map((unit) => unit.pm25)),
        populationWeightedPm25: populationRows.length ? weightedNumerator / population : undefined,
      };
    })
    .sort((a, b) => a.region.localeCompare(b.region) || a.year - b.year || a.month - b.month);
}

export type LifeTableAgeBand = {
  ageStart: number;
  ageEnd: number;
  mortalityProbability: number;
};

export type LifeTableRow = LifeTableAgeBand & {
  survivorsAtStart: number;
  survivorsAtEnd: number;
  personYears: number;
};

export type LifeTableResult = {
  initialCohort: number;
  rows: LifeTableRow[];
  lifeExpectancy: number;
};

export function computeLifeTable(
  bands: ReadonlyArray<LifeTableAgeBand>,
  initialCohort = 100_000,
): LifeTableResult {
  let survivors = initialCohort;
  const rows = bands.map((band) => {
    const intervalYears = Math.max(0, band.ageEnd - band.ageStart);
    const qx = clamp(band.mortalityProbability, 0, 1);
    const nextSurvivors = survivors * (1 - qx);
    const personYears = ((survivors + nextSurvivors) / 2) * intervalYears;
    const row = {
      ...band,
      mortalityProbability: qx,
      survivorsAtStart: survivors,
      survivorsAtEnd: nextSurvivors,
      personYears,
    };
    survivors = nextSurvivors;
    return row;
  });

  return {
    initialCohort,
    rows,
    lifeExpectancy: sum(rows.map((row) => row.personYears)) / initialCohort,
  };
}

export type LifeExpectancyImpactInput = {
  bands: ReadonlyArray<LifeTableAgeBand>;
  observedPm25: number;
  counterfactualPm25: number;
  relativeRiskPer10UgM3: number;
  initialCohort?: number;
};

export type LifeExpectancyImpactResult = {
  observed: LifeTableResult;
  counterfactual: LifeTableResult;
  relativeRisk: number;
  attributableFraction: number;
  yearsLostPerPerson: number;
  cohortYearsLost: number;
};

export function estimatePm25LifeExpectancyImpact(
  input: LifeExpectancyImpactInput,
): LifeExpectancyImpactResult {
  const observed = computeLifeTable(input.bands, input.initialCohort);
  const exposureDelta = Math.max(0, input.observedPm25 - input.counterfactualPm25);
  const relativeRisk = Math.pow(input.relativeRiskPer10UgM3, exposureDelta / 10);
  const attributableFraction = relativeRisk <= 1 ? 0 : (relativeRisk - 1) / relativeRisk;
  const adjustedBands = input.bands.map((band) => ({
    ...band,
    mortalityProbability: band.mortalityProbability * (1 - attributableFraction),
  }));
  const counterfactual = computeLifeTable(adjustedBands, input.initialCohort);
  const yearsLostPerPerson = Math.max(0, counterfactual.lifeExpectancy - observed.lifeExpectancy);

  return {
    observed,
    counterfactual,
    relativeRisk,
    attributableFraction,
    yearsLostPerPerson,
    cohortYearsLost: yearsLostPerPerson * (input.initialCohort ?? 100_000),
  };
}

export type HumanImpactInput = {
  lifeYearsLost: number;
  yearsWithCondition: number;
  disabilityWeight: number;
  naturalFev1DeclineMlPerYear?: number;
  pollutionFev1DeclineMlPerYear?: number;
  exposureYears?: number;
};

export type HumanImpactMetrics = {
  lifeYearsLost: number;
  yearsLivedWithDisability: number;
  disabilityAdjustedLifeYears: number;
  lungAgingRate: number;
  extraLungAgeYears: number;
};

export function computeHumanImpactMetrics(input: HumanImpactInput): HumanImpactMetrics {
  const yld = Math.max(0, input.yearsWithCondition) * clamp(input.disabilityWeight, 0, 1);
  const naturalDecline = input.naturalFev1DeclineMlPerYear ?? 25;
  const pollutionDecline = input.pollutionFev1DeclineMlPerYear ?? 0;
  const exposureYears = input.exposureYears ?? input.yearsWithCondition;
  const lungAgingRate = naturalDecline > 0 ? (naturalDecline + Math.max(0, pollutionDecline)) / naturalDecline : 1;
  const extraLungAgeYears = Math.max(0, (lungAgingRate - 1) * Math.max(0, exposureYears));

  return {
    lifeYearsLost: Math.max(0, input.lifeYearsLost),
    yearsLivedWithDisability: yld,
    disabilityAdjustedLifeYears: Math.max(0, input.lifeYearsLost) + yld,
    lungAgingRate,
    extraLungAgeYears,
  };
}

function sum(values: ReadonlyArray<number>): number {
  return values.reduce((total, value) => total + value, 0);
}

function mean(values: ReadonlyArray<number>): number {
  return values.length ? sum(values) / values.length : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
