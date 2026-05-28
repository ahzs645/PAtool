/**
 * APTE-style life-expectancy loss from PM2.5 exposure. Implements the
 * "years of life lost per person" approximation used in biteSizedAQ
 * notebook #11. We use the Pope-2009-style log-linear hazard ratio
 * applied to a uniform population life table.
 *
 *   HR(PM) = exp(β · (PM − counterfactual))
 *   YLL    = lifeExpectancy · (1 − 1 / HR)
 *
 * Defaults: β = 0.014 per µg/m³ (≈ AQLI), counterfactual = 5 µg/m³ (WHO
 * 2021 AQG). Both can be overridden.
 */

export type LifeExpectancyOptions = {
  /** Counterfactual PM2.5 in µg/m³ below which there is no loss. */
  counterfactual?: number;
  /** Log-linear hazard exponent β per µg/m³. Default 0.014 (AQLI). */
  beta?: number;
  /** Baseline life expectancy in years. Default 78 (global mean). */
  baseLifeExpectancyYears?: number;
};

export type LifeExpectancyEstimate = {
  pm25Exposure: number;
  excessHazardRatio: number;
  yearsLifeLost: number;
  baseLifeExpectancyYears: number;
};

export function lifeExpectancyLoss(
  pm25Exposure: number,
  options: LifeExpectancyOptions = {},
): LifeExpectancyEstimate {
  const cf = options.counterfactual ?? 5;
  const beta = options.beta ?? 0.014;
  const base = options.baseLifeExpectancyYears ?? 78;
  if (!Number.isFinite(pm25Exposure) || pm25Exposure <= cf) {
    return { pm25Exposure, excessHazardRatio: 1, yearsLifeLost: 0, baseLifeExpectancyYears: base };
  }
  const hr = Math.exp(beta * (pm25Exposure - cf));
  const yll = base * (1 - 1 / hr);
  return {
    pm25Exposure,
    excessHazardRatio: hr,
    yearsLifeLost: yll,
    baseLifeExpectancyYears: base,
  };
}

export type YllPopulationEntry = {
  label: string;
  population: number;
  pm25Exposure: number;
};

export type YllPopulationResult = {
  label: string;
  population: number;
  pm25Exposure: number;
  yearsLifeLostPerPerson: number;
  totalPersonYearsLost: number;
};

/**
 * Apply the per-person YLL across a population basket and yield total
 * person-years of life lost. Useful for comparing regions in a chart.
 */
export function yllAcrossPopulations(
  populations: ReadonlyArray<YllPopulationEntry>,
  options: LifeExpectancyOptions = {},
): YllPopulationResult[] {
  return populations.map((p) => {
    const yll = lifeExpectancyLoss(p.pm25Exposure, options).yearsLifeLost;
    return {
      ...p,
      yearsLifeLostPerPerson: yll,
      totalPersonYearsLost: yll * p.population,
    };
  });
}
