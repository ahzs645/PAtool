/**
 * Health-relevant exposure modeling helpers.
 *
 * - Indoor infiltration ratios from paired-sensor literature (ASHRAE
 *   Guideline 44-2024 + 2024 multi-region paired-sensor studies).
 * - "Rapidfire"-style retrospective wildfire-PM2.5 exposure using only
 *   monitor observations + HMS smoke-day flags (O'Dell 2024 GMD).
 * - A wildfire-PM2.5 risk-coefficient lookup table for the Bayesian
 *   outcome-linkage export (Aguilera 2024 AR Med, Sugrue 2026 GeoHealth).
 *
 * These are deliberately small, transparent functions so the user can
 * see exactly which assumptions go into a published number.
 */

import type { SmokeRegimeKey } from "./domain";

// ─── Indoor infiltration ──────────────────────────────────────────────

export type BuildingClass =
  | "tight-hvac"
  | "typical-hvac"
  | "leaky-hvac"
  | "tight-no-hvac"
  | "typical-no-hvac"
  | "leaky-no-hvac";

export type InfiltrationProfile = {
  buildingClass: BuildingClass;
  /** Indoor/outdoor PM2.5 infiltration ratio under non-smoke conditions. */
  fInfNonSmoke: number;
  /** Infiltration ratio when HMS smoke is present (Fires 2024 paired sensor work). */
  fInfSmoke: number;
  citation: string;
};

export const INFILTRATION_PROFILES: Record<BuildingClass, InfiltrationProfile> = {
  "tight-hvac": {
    buildingClass: "tight-hvac",
    fInfNonSmoke: 0.25,
    fInfSmoke: 0.12,
    citation: "ASHRAE Guideline 44-2024 + Fires 2024 multi-region paired-sensor study",
  },
  "typical-hvac": {
    buildingClass: "typical-hvac",
    fInfNonSmoke: 0.4,
    fInfSmoke: 0.2,
    citation: "ASHRAE Guideline 44-2024 + Fires 2024 multi-region paired-sensor study",
  },
  "leaky-hvac": {
    buildingClass: "leaky-hvac",
    fInfNonSmoke: 0.6,
    fInfSmoke: 0.35,
    citation: "ASHRAE Guideline 44-2024 + Fires 2024 multi-region paired-sensor study",
  },
  "tight-no-hvac": {
    buildingClass: "tight-no-hvac",
    fInfNonSmoke: 0.45,
    fInfSmoke: 0.3,
    citation: "Allen, Riley follow-ups + ASHRAE 44 baseline",
  },
  "typical-no-hvac": {
    buildingClass: "typical-no-hvac",
    fInfNonSmoke: 0.6,
    fInfSmoke: 0.45,
    citation: "Allen, Riley follow-ups + ASHRAE 44 baseline",
  },
  "leaky-no-hvac": {
    buildingClass: "leaky-no-hvac",
    fInfNonSmoke: 0.85,
    fInfSmoke: 0.7,
    citation: "Allen, Riley follow-ups + ASHRAE 44 baseline",
  },
};

export type IndoorEstimateInput = {
  outdoorPm25: number;
  buildingClass: BuildingClass;
  smoke: boolean;
  /** Optional indoor-source contribution in µg/m³ (cooking, etc). */
  indoorSourceContribution?: number;
};

export type IndoorEstimateResult = {
  outdoorPm25: number;
  fInf: number;
  indoorSourceContribution: number;
  indoorPm25: number;
  buildingClass: BuildingClass;
  smoke: boolean;
};

/** Compute indoor PM2.5 from outdoor PM2.5, building class, and smoke regime. */
export function estimateIndoorPm25(input: IndoorEstimateInput): IndoorEstimateResult {
  const profile = INFILTRATION_PROFILES[input.buildingClass];
  const fInf = input.smoke ? profile.fInfSmoke : profile.fInfNonSmoke;
  const indoorSource = input.indoorSourceContribution ?? 0;
  const indoorPm25 = Math.max(0, input.outdoorPm25 * fInf + indoorSource);
  return {
    outdoorPm25: input.outdoorPm25,
    fInf,
    indoorSourceContribution: indoorSource,
    indoorPm25,
    buildingClass: input.buildingClass,
    smoke: input.smoke,
  };
}

// ─── rapidfire-style retrospective exposure ───────────────────────────

export type RapidfireDailyInput = {
  date: string;
  /** Daily reference PM2.5 (e.g. AirNow / regulatory monitor) in µg/m³. */
  referencePm25: number;
  /** True when NOAA HMS has any smoke plume over the location that day. */
  smokeFlag: boolean;
  /** Background PM2.5 estimate; defaults to a 30-day non-smoke median. */
  backgroundPm25?: number;
};

export type RapidfireDailyResult = {
  date: string;
  totalPm25: number;
  smokeAttributedPm25: number;
  backgroundPm25: number;
};

/**
 * Retrospective wildfire-PM2.5 exposure following O'Dell et al. 2024
 * (rapidfire v0.1.3, GMD). On smoke days, total - background is
 * attributed to wildfire smoke; on clean days, smoke-attributed exposure
 * is zero. The default background estimator is the median of recent
 * non-smoke days within `backgroundWindowDays`.
 */
export function rapidfireExposureSeries(
  daily: ReadonlyArray<RapidfireDailyInput>,
  options: { backgroundWindowDays?: number } = {},
): RapidfireDailyResult[] {
  const window = options.backgroundWindowDays ?? 30;
  return daily.map((day, index) => {
    const effectiveBackground = day.backgroundPm25 ?? estimateNonSmokeMedian(daily, index, window);
    const total = Math.max(0, day.referencePm25);
    const smokeAttributed = day.smokeFlag ? Math.max(0, total - effectiveBackground) : 0;
    return {
      date: day.date,
      totalPm25: total,
      smokeAttributedPm25: smokeAttributed,
      backgroundPm25: effectiveBackground,
    };
  });
}

function estimateNonSmokeMedian(
  daily: ReadonlyArray<RapidfireDailyInput>,
  index: number,
  window: number,
): number {
  const start = Math.max(0, index - window);
  const slice = daily.slice(start, index)
    .filter((day) => !day.smokeFlag && Number.isFinite(day.referencePm25))
    .map((day) => day.referencePm25)
    .sort((a, b) => a - b);
  if (slice.length === 0) {
    return Number.isFinite(daily[index].referencePm25) ? Math.min(daily[index].referencePm25, 8) : 5;
  }
  const mid = Math.floor(slice.length / 2);
  return slice.length % 2 === 0 ? (slice[mid - 1] + slice[mid]) / 2 : slice[mid];
}

// ─── Wildfire health risk table ───────────────────────────────────────

export type WildfireOutcomeKey =
  | "all-cause-mortality"
  | "respiratory-ed-visit"
  | "asthma-ed-visit-pediatric"
  | "cardiovascular-hospitalization";

export type WildfireRiskCoefficient = {
  outcome: WildfireOutcomeKey;
  label: string;
  /** Relative risk per 10 µg/m³ increase in wildfire-PM2.5. */
  rrPer10: number;
  ci95Lower: number;
  ci95Upper: number;
  exposureWindow: string;
  population: string;
  citation: string;
};

export const WILDFIRE_RR_TABLE: ReadonlyArray<WildfireRiskCoefficient> = [
  {
    outcome: "all-cause-mortality",
    label: "All-cause mortality (short-term)",
    rrPer10: 1.012,
    ci95Lower: 1.005,
    ci95Upper: 1.020,
    exposureWindow: "lag 0-2 days",
    population: "general population, US",
    citation: "Aguilera et al. 2024, Annual Review of Medicine 75:277",
  },
  {
    outcome: "respiratory-ed-visit",
    label: "Respiratory ED visits",
    rrPer10: 1.072,
    ci95Lower: 1.039,
    ci95Upper: 1.106,
    exposureWindow: "lag 0-3 days",
    population: "all ages, western US",
    citation: "Reid et al. 2016 + Aguilera et al. 2024 update",
  },
  {
    outcome: "asthma-ed-visit-pediatric",
    label: "Pediatric asthma ED visits",
    rrPer10: 1.10,
    ci95Lower: 1.02,
    ci95Upper: 1.19,
    exposureWindow: "same-day",
    population: "children 0-17, Northern California",
    citation: "Sugrue et al. 2026, GeoHealth 10:e2025GH001530",
  },
  {
    outcome: "cardiovascular-hospitalization",
    label: "Cardiovascular hospitalization",
    rrPer10: 1.014,
    ci95Lower: 1.000,
    ci95Upper: 1.028,
    exposureWindow: "lag 0-1 days",
    population: "adults ≥65, Medicare cohort",
    citation: "Heaney et al. 2022 + Aguilera 2024 update",
  },
];

export type RegimeAttributableRisk = {
  outcome: WildfireOutcomeKey;
  excessRiskPercent: number;
  attributableExposureUgM3: number;
  citation: string;
};

/**
 * Translate a regime-tagged exposure increment into outcome-specific
 * excess risk for the Bayesian outcome-linkage export. Returns one row
 * per outcome with `(rr - 1) * 100 * dExp/10`. Use only for descriptive
 * model summaries — full health-impact assessments must apply the actual
 * coefficient distributions, not point estimates.
 */
export function attributableRiskForExposure(
  attributableExposureUgM3: number,
  regime: SmokeRegimeKey,
): RegimeAttributableRisk[] {
  if (regime === "non-smoke" || attributableExposureUgM3 <= 0) return [];
  return WILDFIRE_RR_TABLE.map((row) => ({
    outcome: row.outcome,
    excessRiskPercent: ((row.rrPer10 - 1) * 100 * attributableExposureUgM3) / 10,
    attributableExposureUgM3,
    citation: row.citation,
  }));
}
