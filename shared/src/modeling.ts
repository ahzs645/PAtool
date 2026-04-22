import type { PasCollection, PasRecord } from "./domain";
import type { StudySensorValueField } from "./studyArea";

export type PasSnapshotFeatureRow = {
  sensorId: string;
  label: string;
  generatedAt: string;
  source: PasCollection["source"];
  latitude: number;
  longitude: number;
  locationType: PasRecord["locationType"];
  isOutdoor: boolean;
  pm25: number;
  pm25Field: StudySensorValueField;
  humidity: number | null;
  temperature: number | null;
  pressure: number | null;
  confidence: number | null;
  channelFlags: number | null;
  elevationMeters: number | null;
  distanceToClosestMonitorKm: number | null;
  hourOfDay: number;
  dayOfWeek: number;
  month: number;
  dayOfYear: number;
  hourSin: number;
  hourCos: number;
  dayOfYearSin: number;
  dayOfYearCos: number;
};

export type PasSnapshotFeatureTableOptions = {
  pm25Field?: StudySensorValueField;
  includeInside?: boolean;
  minConfidence?: number;
};

export type PasSnapshotFeatureTable = {
  generatedAt: string;
  source: PasCollection["source"];
  rows: PasSnapshotFeatureRow[];
  dropped: {
    inside: number;
    missingCoordinates: number;
    missingPm25: number;
    lowConfidence: number;
  };
  featureNames: Array<keyof PasSnapshotFeatureRow>;
};

export type RegressionPrediction = {
  observed: number | null;
  predicted: number | null;
  groupId?: string;
};

export type RegressionMetrics = {
  n: number;
  rmse: number | null;
  mae: number | null;
  bias: number | null;
  rSquared: number | null;
};

export type CalibrationGateResult = {
  n: number;
  pearsonR: number | null;
  passes: boolean;
  minPearsonR: number;
};

export type ModelRunResult = {
  modelId: string;
  modelLabel?: string;
  splitId: string;
  metrics: RegressionMetrics;
  durationMs: number;
};

export type AggregatedModelResult = {
  modelId: string;
  modelLabel?: string;
  runs: number;
  splitIds: string[];
  durationMsMean: number | null;
  rmseMean: number | null;
  rmseStdDev: number | null;
  rSquaredMean: number | null;
  rSquaredStdDev: number | null;
  maeMean: number | null;
  biasMean: number | null;
};

const SNAPSHOT_FEATURE_NAMES: Array<keyof PasSnapshotFeatureRow> = [
  "latitude",
  "longitude",
  "isOutdoor",
  "pm25",
  "humidity",
  "temperature",
  "pressure",
  "confidence",
  "channelFlags",
  "elevationMeters",
  "distanceToClosestMonitorKm",
  "hourOfDay",
  "dayOfWeek",
  "month",
  "dayOfYear",
  "hourSin",
  "hourCos",
  "dayOfYearSin",
  "dayOfYearCos",
];

export function buildPasSnapshotFeatureTable(
  collection: PasCollection,
  options: PasSnapshotFeatureTableOptions = {},
): PasSnapshotFeatureTable {
  const pm25Field = options.pm25Field ?? "pm25_1hr";
  const includeInside = options.includeInside ?? false;
  const time = snapshotTimeFeatures(collection.generatedAt);
  const rows: PasSnapshotFeatureRow[] = [];
  const dropped = {
    inside: 0,
    missingCoordinates: 0,
    missingPm25: 0,
    lowConfidence: 0,
  };

  for (const record of collection.records) {
    if (!includeInside && record.locationType === "inside") {
      dropped.inside += 1;
      continue;
    }
    if (!hasValidCoordinates(record)) {
      dropped.missingCoordinates += 1;
      continue;
    }
    const pm25 = numericValue(record[pm25Field] ?? record.pm25Current);
    if (pm25 === null) {
      dropped.missingPm25 += 1;
      continue;
    }
    const confidence = numericValue(record.confidence);
    if (options.minConfidence !== undefined && confidence !== null && confidence < options.minConfidence) {
      dropped.lowConfidence += 1;
      continue;
    }

    rows.push({
      sensorId: record.id,
      label: record.label,
      generatedAt: collection.generatedAt,
      source: collection.source,
      latitude: record.latitude,
      longitude: record.longitude,
      locationType: record.locationType,
      isOutdoor: record.locationType === "outside",
      pm25,
      pm25Field,
      humidity: numericValue(record.humidity),
      temperature: numericValue(record.temperature),
      pressure: numericValue(record.pressure),
      confidence,
      channelFlags: numericValue(record.channelFlags),
      elevationMeters: numericValue(record.elevationMeters),
      distanceToClosestMonitorKm: numericValue(record.distanceToClosestMonitorKm),
      ...time,
    });
  }

  return {
    generatedAt: collection.generatedAt,
    source: collection.source,
    rows,
    dropped,
    featureNames: SNAPSHOT_FEATURE_NAMES,
  };
}

export function evaluateRegressionPredictions(predictions: readonly RegressionPrediction[]): RegressionMetrics {
  const pairs = predictions
    .filter((entry): entry is { observed: number; predicted: number; groupId?: string } =>
      typeof entry.observed === "number" &&
      Number.isFinite(entry.observed) &&
      typeof entry.predicted === "number" &&
      Number.isFinite(entry.predicted),
    );

  if (!pairs.length) {
    return { n: 0, rmse: null, mae: null, bias: null, rSquared: null };
  }

  const observedMean = mean(pairs.map((pair) => pair.observed));
  let squareError = 0;
  let absoluteError = 0;
  let bias = 0;
  let totalSquares = 0;

  for (const pair of pairs) {
    const residual = pair.predicted - pair.observed;
    squareError += residual * residual;
    absoluteError += Math.abs(residual);
    bias += residual;
    totalSquares += (pair.observed - observedMean) ** 2;
  }

  return {
    n: pairs.length,
    rmse: round(Math.sqrt(squareError / pairs.length), 6),
    mae: round(absoluteError / pairs.length, 6),
    bias: round(bias / pairs.length, 6),
    rSquared: totalSquares > 0 ? round(1 - squareError / totalSquares, 6) : null,
  };
}

export function assessPearsonCalibrationGate(
  predictions: readonly RegressionPrediction[],
  minPearsonR = 0.7,
): CalibrationGateResult {
  const pairs = predictions
    .filter((entry): entry is { observed: number; predicted: number; groupId?: string } =>
      typeof entry.observed === "number" &&
      Number.isFinite(entry.observed) &&
      typeof entry.predicted === "number" &&
      Number.isFinite(entry.predicted),
    );
  const pearsonR = pairs.length >= 3
    ? pearsonCorrelation(pairs.map((pair) => pair.observed), pairs.map((pair) => pair.predicted))
    : null;

  return {
    n: pairs.length,
    pearsonR: pearsonR === null ? null : round(pearsonR, 6),
    passes: pearsonR !== null && pearsonR >= minPearsonR,
    minPearsonR,
  };
}

export function aggregateModelRuns(runs: readonly ModelRunResult[]): AggregatedModelResult[] {
  const groups = new Map<string, ModelRunResult[]>();
  for (const run of runs) {
    const group = groups.get(run.modelId) ?? [];
    group.push(run);
    groups.set(run.modelId, group);
  }

  return [...groups.entries()].map(([modelId, group]) => {
    const rmse = group.map((run) => run.metrics.rmse).filter(isNumber);
    const rSquared = group.map((run) => run.metrics.rSquared).filter(isNumber);
    const mae = group.map((run) => run.metrics.mae).filter(isNumber);
    const bias = group.map((run) => run.metrics.bias).filter(isNumber);
    const durations = group.map((run) => run.durationMs).filter(isNumber);

    return {
      modelId,
      modelLabel: group.find((run) => run.modelLabel)?.modelLabel,
      runs: group.length,
      splitIds: [...new Set(group.map((run) => run.splitId))].sort(),
      durationMsMean: meanOrNull(durations),
      rmseMean: meanOrNull(rmse),
      rmseStdDev: stdDevOrNull(rmse),
      rSquaredMean: meanOrNull(rSquared),
      rSquaredStdDev: stdDevOrNull(rSquared),
      maeMean: meanOrNull(mae),
      biasMean: meanOrNull(bias),
    };
  }).sort((left, right) => {
    if (left.rmseMean === null && right.rmseMean === null) return left.modelId.localeCompare(right.modelId);
    if (left.rmseMean === null) return 1;
    if (right.rmseMean === null) return -1;
    return left.rmseMean - right.rmseMean;
  });
}

function snapshotTimeFeatures(generatedAt: string): Pick<
  PasSnapshotFeatureRow,
  "hourOfDay" | "dayOfWeek" | "month" | "dayOfYear" | "hourSin" | "hourCos" | "dayOfYearSin" | "dayOfYearCos"
> {
  const date = new Date(generatedAt);
  const valid = Number.isFinite(date.getTime());
  const hourOfDay = valid ? date.getUTCHours() : 0;
  const dayOfWeek = valid ? date.getUTCDay() : 0;
  const month = valid ? date.getUTCMonth() + 1 : 1;
  const start = valid ? Date.UTC(date.getUTCFullYear(), 0, 1) : 0;
  const dayOfYear = valid ? Math.floor((date.getTime() - start) / 86_400_000) + 1 : 1;
  const hourAngle = (hourOfDay / 24) * Math.PI * 2;
  const dayAngle = (dayOfYear / 366) * Math.PI * 2;

  return {
    hourOfDay,
    dayOfWeek,
    month,
    dayOfYear,
    hourSin: round(Math.sin(hourAngle), 6),
    hourCos: round(Math.cos(hourAngle), 6),
    dayOfYearSin: round(Math.sin(dayAngle), 6),
    dayOfYearCos: round(Math.cos(dayAngle), 6),
  };
}

function hasValidCoordinates(record: PasRecord): boolean {
  return Number.isFinite(record.latitude) &&
    Number.isFinite(record.longitude) &&
    record.latitude >= -90 &&
    record.latitude <= 90 &&
    record.longitude >= -180 &&
    record.longitude <= 180;
}

function numericValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pearsonCorrelation(left: readonly number[], right: readonly number[]): number | null {
  if (left.length < 3 || left.length !== right.length) return null;
  const leftMean = mean(left);
  const rightMean = mean(right);
  let numerator = 0;
  let leftSquares = 0;
  let rightSquares = 0;
  for (let i = 0; i < left.length; i += 1) {
    const leftDelta = left[i] - leftMean;
    const rightDelta = right[i] - rightMean;
    numerator += leftDelta * rightDelta;
    leftSquares += leftDelta * leftDelta;
    rightSquares += rightDelta * rightDelta;
  }
  const denominator = Math.sqrt(leftSquares * rightSquares);
  return denominator > 0 ? numerator / denominator : null;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function meanOrNull(values: readonly number[]): number | null {
  return values.length ? round(mean(values), 6) : null;
}

function stdDevOrNull(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
  return round(Math.sqrt(variance), 6);
}

function isNumber(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function round(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}
