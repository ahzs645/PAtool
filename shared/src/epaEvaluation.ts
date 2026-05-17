import { pm25ToAqiBand } from "./domain";
import { blandAltman, linearFit, relativeExpandedUncertainty, type MeasurementPair } from "./measurementError";
import { applyQcProfile, type QcProfileId, type QcProfileSummary } from "./qcProfiles";

export type EvaluationPollutant = "PM2.5" | "PM10" | "O3" | "NO2" | "CO" | "SO2";

export type EpaEvaluationTarget = {
  pollutant: EvaluationPollutant;
  minPairs: number;
  minR2?: number;
  maxNormalizedMeanBias?: number;
  maxNormalizedRmse?: number;
  maxMedianReu?: number;
  averagingPeriod: "1-hour" | "24-hour";
};

export type EpaEvaluationOptions = {
  pollutant?: EvaluationPollutant;
  profileId?: QcProfileId;
  target?: Partial<EpaEvaluationTarget>;
};

export type AqiCategoryValidation = {
  category: string;
  count: number;
  meanBias: number;
  normalizedMeanBias: number | null;
  rmse: number;
  normalizedRmse: number | null;
  categoryAgreement: number;
  falseHigh: number;
  falseLow: number;
};

export type EpaEvaluationResult = {
  pollutant: EvaluationPollutant;
  target: EpaEvaluationTarget;
  qc: QcProfileSummary;
  pairs: MeasurementPair[];
  fit: ReturnType<typeof linearFit>;
  blandAltman: ReturnType<typeof blandAltman>;
  reu: ReturnType<typeof relativeExpandedUncertainty>;
  medianReu: number | null;
  normalizedMeanBias: number | null;
  normalizedRmse: number | null;
  aqiValidation: AqiCategoryValidation[];
  decisions: Array<{ criterion: string; value: number | null; threshold: number; pass: boolean; units?: string }>;
  pass: boolean;
};

const DEFAULT_TARGETS: Record<EvaluationPollutant, EpaEvaluationTarget> = {
  "PM2.5": { pollutant: "PM2.5", averagingPeriod: "1-hour", minPairs: 23, minR2: 0.7, maxNormalizedMeanBias: 0.3, maxNormalizedRmse: 0.5, maxMedianReu: 50 },
  PM10: { pollutant: "PM10", averagingPeriod: "1-hour", minPairs: 23, minR2: 0.7, maxNormalizedMeanBias: 0.3, maxNormalizedRmse: 0.5, maxMedianReu: 50 },
  O3: { pollutant: "O3", averagingPeriod: "1-hour", minPairs: 23, minR2: 0.75, maxNormalizedMeanBias: 0.2, maxNormalizedRmse: 0.35 },
  NO2: { pollutant: "NO2", averagingPeriod: "1-hour", minPairs: 23, minR2: 0.75, maxNormalizedMeanBias: 0.2, maxNormalizedRmse: 0.35 },
  CO: { pollutant: "CO", averagingPeriod: "1-hour", minPairs: 23, minR2: 0.75, maxNormalizedMeanBias: 0.2, maxNormalizedRmse: 0.35 },
  SO2: { pollutant: "SO2", averagingPeriod: "1-hour", minPairs: 23, minR2: 0.75, maxNormalizedMeanBias: 0.2, maxNormalizedRmse: 0.35 },
};

export function evaluateEpaSensorPerformance(
  pairs: readonly MeasurementPair[],
  options: EpaEvaluationOptions = {},
): EpaEvaluationResult {
  const pollutant = options.pollutant ?? "PM2.5";
  const target = { ...DEFAULT_TARGETS[pollutant], ...(options.target ?? {}) };
  const rows = pairs.map((pair) => ({
    ...pair,
    reference: pair.reference,
    sensor: pair.sensor,
  }));
  const qc = applyQcProfile(rows, options.profileId ?? "epa-collocation");
  const cleanPairs = qc.rows
    .filter((row) => row.qcPass)
    .map((row): MeasurementPair => ({
      time: typeof row.time === "string" || typeof row.time === "number" || row.time instanceof Date ? row.time : undefined,
      reference: Number(row.reference),
      sensor: Number(row.sensor),
    }))
    .filter((pair) => Number.isFinite(pair.reference) && Number.isFinite(pair.sensor));
  const fit = linearFit(cleanPairs);
  const agreement = blandAltman(cleanPairs);
  const reu = relativeExpandedUncertainty(cleanPairs);
  const medianReu = median(reu.points.map((point) => point.reu));
  const referenceMean = mean(cleanPairs.map((pair) => pair.reference));
  const normalizedMeanBias = referenceMean ? fit.bias / referenceMean : null;
  const normalizedRmse = referenceMean ? fit.rmse / referenceMean : null;
  const decisions = [
    { criterion: "Minimum valid pairs", value: fit.n, threshold: target.minPairs, pass: fit.n >= target.minPairs },
    ...(target.minR2 === undefined ? [] : [{ criterion: "Minimum R2", value: fit.r2, threshold: target.minR2, pass: fit.r2 >= target.minR2 }]),
    ...(target.maxNormalizedMeanBias === undefined ? [] : [{
      criterion: "Maximum absolute normalized mean bias",
      value: normalizedMeanBias === null ? null : Math.abs(normalizedMeanBias),
      threshold: target.maxNormalizedMeanBias,
      pass: normalizedMeanBias !== null && Math.abs(normalizedMeanBias) <= target.maxNormalizedMeanBias,
    }]),
    ...(target.maxNormalizedRmse === undefined ? [] : [{
      criterion: "Maximum normalized RMSE",
      value: normalizedRmse,
      threshold: target.maxNormalizedRmse,
      pass: normalizedRmse !== null && normalizedRmse <= target.maxNormalizedRmse,
    }]),
    ...(target.maxMedianReu === undefined ? [] : [{
      criterion: "Maximum median REU",
      value: medianReu,
      threshold: target.maxMedianReu,
      pass: medianReu !== null && medianReu <= target.maxMedianReu,
      units: "%",
    }]),
  ];

  return {
    pollutant,
    target,
    qc,
    pairs: cleanPairs,
    fit,
    blandAltman: agreement,
    reu,
    medianReu,
    normalizedMeanBias,
    normalizedRmse,
    aqiValidation: pollutant === "PM2.5" ? validateByPm25Aqi(cleanPairs) : [],
    decisions,
    pass: decisions.every((decision) => decision.pass),
  };
}

function validateByPm25Aqi(pairs: MeasurementPair[]): AqiCategoryValidation[] {
  const groups = new Map<string, MeasurementPair[]>();
  for (const pair of pairs) {
    const category = pm25ToAqiBand(pair.reference).label;
    groups.set(category, [...(groups.get(category) ?? []), pair]);
  }
  return [...groups.entries()].map(([category, rows]) => {
    const errors = rows.map((row) => row.sensor - row.reference);
    const bias = mean(errors);
    const rmse = Math.sqrt(mean(errors.map((error) => error ** 2)));
    const referenceMean = mean(rows.map((row) => row.reference));
    let agreement = 0;
    let falseHigh = 0;
    let falseLow = 0;
    for (const row of rows) {
      const ref = categoryRank(pm25ToAqiBand(row.reference).label);
      const sensor = categoryRank(pm25ToAqiBand(row.sensor).label);
      if (ref === sensor) agreement += 1;
      if (sensor > ref) falseHigh += 1;
      if (sensor < ref) falseLow += 1;
    }
    return {
      category,
      count: rows.length,
      meanBias: round(bias),
      normalizedMeanBias: referenceMean ? round(bias / referenceMean, 4) : null,
      rmse: round(rmse),
      normalizedRmse: referenceMean ? round(rmse / referenceMean, 4) : null,
      categoryAgreement: round(agreement / rows.length, 4),
      falseHigh,
      falseLow,
    };
  });
}

function mean(values: readonly number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round(value: number, digits = 3): number {
  return Number(value.toFixed(digits));
}

function categoryRank(label: string): number {
  return ["Good", "Moderate", "USG", "Unhealthy", "Very Unhealthy", "Hazardous"].indexOf(label);
}
