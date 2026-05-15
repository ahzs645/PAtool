import type { PatSeries } from "./domain";
import { evaluateRegressionPredictions, type RegressionMetrics } from "./modeling";
import {
  fitRandomForest,
  predictRandomForest,
  predictRandomForestBatch,
  type RandomForestFitOptions,
  type RandomForestModel,
} from "./randomForest";

export type WeatherNormalizationFeatureName =
  | "trend"
  | "hourSin"
  | "hourCos"
  | "dayOfYearSin"
  | "dayOfYearCos"
  | "weekday"
  | "humidity"
  | "temperature"
  | "pressure";

export type WeatherNormalizationRow = {
  timestamp: string;
  observed: number;
  set: "training" | "testing";
  trend: number;
  hourSin: number;
  hourCos: number;
  dayOfYearSin: number;
  dayOfYearCos: number;
  weekday: number;
  humidity: number;
  temperature: number;
  pressure: number;
};

export type WeatherNormalizationPrepared = {
  rows: WeatherNormalizationRow[];
  featureNames: WeatherNormalizationFeatureName[];
  imputed: Record<"humidity" | "temperature" | "pressure", number>;
  dropped: {
    missingTimestamp: number;
    missingPm25: number;
  };
};

export type WeatherNormalizedPoint = {
  timestamp: string;
  observed: number;
  predicted: number;
  normalized: number;
  normalizedStd: number;
  set: "training" | "testing";
};

export type WeatherPartialDependencePoint = {
  variable: WeatherNormalizationFeatureName;
  value: number;
  partialDependency: number;
};

export type WeatherVariableImportance = {
  rank: number;
  variable: WeatherNormalizationFeatureName;
  importance: number;
};

export type WeatherNormalizationCovariateSet = "meteorology" | "meteorology-seasonality" | "custom";

export type WeatherNormalizationRunConfig = {
  featureNames: WeatherNormalizationFeatureName[];
  shuffledFeatureNames: WeatherNormalizationFeatureName[];
  partialDependenceFeatureNames: WeatherNormalizationFeatureName[];
  covariateSet: WeatherNormalizationCovariateSet;
};

export type WeatherModelDiagnostics = {
  metrics: RegressionMetrics & {
    pearsonR: number | null;
    normalizedMeanBias: number | null;
    normalizedRmse: number | null;
    indexOfAgreement: number | null;
    coefficientOfEfficiency: number | null;
  };
  predictions: Array<{ timestamp: string; observed: number; predicted: number; set: "training" | "testing" }>;
  importance: WeatherVariableImportance[];
  partialDependence: WeatherPartialDependencePoint[];
  normalized: WeatherNormalizedPoint[];
};

export type WeatherNormalizationResult = WeatherNormalizationPrepared & {
  model: RandomForestModel;
  config: WeatherNormalizationRunConfig;
  diagnostics: WeatherModelDiagnostics;
};

export type WeatherNormalizationOptions = {
  trainFraction?: number;
  seed?: number;
  normalizationSamples?: number;
  partialDependenceResolution?: number;
  covariateSet?: WeatherNormalizationCovariateSet;
  shuffledFeatureNames?: WeatherNormalizationFeatureName[];
  partialDependenceFeatureNames?: WeatherNormalizationFeatureName[];
  randomForest?: RandomForestFitOptions;
};

const FEATURE_NAMES: WeatherNormalizationFeatureName[] = [
  "trend",
  "hourSin",
  "hourCos",
  "dayOfYearSin",
  "dayOfYearCos",
  "weekday",
  "humidity",
  "temperature",
  "pressure",
];

export const WEATHER_NORMALIZATION_FEATURE_GROUPS = {
  meteorology: ["humidity", "temperature", "pressure"],
  seasonality: ["hourSin", "hourCos", "dayOfYearSin", "dayOfYearCos", "weekday"],
  trend: ["trend"],
} as const satisfies Record<string, readonly WeatherNormalizationFeatureName[]>;

const DEFAULT_PARTIAL_DEPENDENCE_FEATURES: WeatherNormalizationFeatureName[] = [
  "humidity",
  "temperature",
  "pressure",
  "hourSin",
  "dayOfYearSin",
];

export function runWeatherNormalization(
  series: PatSeries,
  options: WeatherNormalizationOptions = {},
): WeatherNormalizationResult {
  const prepared = prepareWeatherNormalizationRows(series, options);
  if (prepared.rows.length < 12) {
    throw new Error("Weather normalization needs at least 12 valid PM2.5 observations.");
  }
  const config = resolveWeatherNormalizationConfig(options);

  const featureMatrix = prepared.rows.map((row) => featureVector(row));
  const target = prepared.rows.map((row) => row.observed);
  const trainingIndexes = prepared.rows
    .map((row, index) => (row.set === "training" ? index : -1))
    .filter((index) => index >= 0);
  const trainFeatures = trainingIndexes.map((index) => featureMatrix[index]);
  const trainTarget = trainingIndexes.map((index) => target[index]);
  const model = fitRandomForest(trainFeatures, trainTarget, {
    numTrees: 70,
    maxDepth: 10,
    minSamplesSplit: 5,
    seed: options.seed ?? 31,
    ...(options.randomForest ?? {}),
  });

  const predictions = predictRandomForestBatch(model, featureMatrix).map((prediction, index) => ({
    timestamp: prepared.rows[index].timestamp,
    observed: prepared.rows[index].observed,
    predicted: round(prediction.mean, 4),
    set: prepared.rows[index].set,
  }));
  const testPredictions = predictions.filter((row) => row.set === "testing");
  const metrics = extendedMetrics(testPredictions.length ? testPredictions : predictions);

  const diagnostics: WeatherModelDiagnostics = {
    metrics,
    predictions,
    importance: permutationImportance(model, prepared.rows, options.seed ?? 31),
    partialDependence: partialDependence(
      model,
      prepared.rows,
      config.partialDependenceFeatureNames,
      options.partialDependenceResolution ?? 12,
    ),
    normalized: normalizeWeather(model, prepared.rows, {
      nSamples: options.normalizationSamples ?? 40,
      seed: (options.seed ?? 31) + 101,
      shuffledFeatureNames: config.shuffledFeatureNames,
    }),
  };

  return {
    ...prepared,
    model,
    config,
    diagnostics,
  };
}

export function prepareWeatherNormalizationRows(
  series: PatSeries,
  options: WeatherNormalizationOptions = {},
): WeatherNormalizationPrepared {
  const raw = series.points
    .map((point) => {
      const timestamp = new Date(point.timestamp);
      const observed = meanNullable(point.pm25A, point.pm25B);
      if (!Number.isFinite(timestamp.getTime())) return { kind: "drop" as const, reason: "missingTimestamp" as const };
      if (observed === null) return { kind: "drop" as const, reason: "missingPm25" as const };
      return {
        kind: "row" as const,
        timestamp: timestamp.toISOString(),
        observed,
        humidity: finiteOrNull(point.humidity),
        temperature: finiteOrNull(point.adjustedTemperature ?? point.temperature),
        pressure: finiteOrNull(point.pressure),
      };
    });

  const dropped = {
    missingTimestamp: raw.filter((row) => row.kind === "drop" && row.reason === "missingTimestamp").length,
    missingPm25: raw.filter((row) => row.kind === "drop" && row.reason === "missingPm25").length,
  };
  const valid = raw.filter((row): row is Extract<typeof row, { kind: "row" }> => row.kind === "row");
  const imputed = {
    humidity: median(valid.map((row) => row.humidity).filter(isNumber)) ?? 50,
    temperature: median(valid.map((row) => row.temperature).filter(isNumber)) ?? 20,
    pressure: median(valid.map((row) => row.pressure).filter(isNumber)) ?? 1013,
  };

  const sorted = valid.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  const firstTime = sorted.length ? new Date(sorted[0].timestamp).getTime() : 0;
  const rng = mulberry32(options.seed ?? 31);
  const trainFraction = clamp(options.trainFraction ?? 0.8, 0.1, 0.95);
  const rows = sorted.map((row) => {
    const date = new Date(row.timestamp);
    const hour = date.getUTCHours();
    const dayOfYear = utcDayOfYear(date);
    const hourAngle = (hour / 24) * Math.PI * 2;
    const dayAngle = (dayOfYear / 366) * Math.PI * 2;
    return {
      timestamp: row.timestamp,
      observed: round(row.observed, 4),
      set: rng() <= trainFraction ? "training" as const : "testing" as const,
      trend: round((date.getTime() - firstTime) / 86_400_000, 6),
      hourSin: round(Math.sin(hourAngle), 6),
      hourCos: round(Math.cos(hourAngle), 6),
      dayOfYearSin: round(Math.sin(dayAngle), 6),
      dayOfYearCos: round(Math.cos(dayAngle), 6),
      weekday: date.getUTCDay(),
      humidity: row.humidity ?? imputed.humidity,
      temperature: row.temperature ?? imputed.temperature,
      pressure: row.pressure ?? imputed.pressure,
    };
  });

  if (rows.length && rows.every((row) => row.set === "training")) {
    rows[rows.length - 1].set = "testing";
  }
  if (rows.length && rows.every((row) => row.set === "testing")) {
    rows[0].set = "training";
  }

  return {
    rows,
    featureNames: FEATURE_NAMES,
    imputed,
    dropped,
  };
}

function normalizeWeather(
  model: RandomForestModel,
  rows: WeatherNormalizationRow[],
  options: { nSamples: number; seed: number; shuffledFeatureNames: WeatherNormalizationFeatureName[] },
): WeatherNormalizedPoint[] {
  const rng = mulberry32(options.seed);
  const pools = new Map<WeatherNormalizationFeatureName, number[]>();
  for (const feature of options.shuffledFeatureNames) {
    pools.set(feature, rows.map((row) => row[feature]));
  }

  return rows.map((row) => {
    const predictions: number[] = [];
    for (let sample = 0; sample < Math.max(1, options.nSamples); sample += 1) {
      const sampled = { ...row };
      for (const feature of options.shuffledFeatureNames) {
        const values = pools.get(feature) ?? [];
        sampled[feature] = values[Math.floor(rng() * values.length)] ?? sampled[feature];
      }
      predictions.push(predictRandomForest(model, featureVector(sampled)).mean);
    }
    const normalized = average(predictions);
    return {
      timestamp: row.timestamp,
      observed: row.observed,
      predicted: round(predictRandomForest(model, featureVector(row)).mean, 4),
      normalized: round(normalized, 4),
      normalizedStd: round(stdDev(predictions, normalized), 4),
      set: row.set,
    };
  });
}

function resolveWeatherNormalizationConfig(options: WeatherNormalizationOptions): WeatherNormalizationRunConfig {
  const covariateSet = options.covariateSet ?? (options.shuffledFeatureNames ? "custom" : "meteorology");
  const shuffledFeatureNames = uniqueFeatures(options.shuffledFeatureNames ?? (
    covariateSet === "meteorology-seasonality"
      ? [...WEATHER_NORMALIZATION_FEATURE_GROUPS.meteorology, ...WEATHER_NORMALIZATION_FEATURE_GROUPS.seasonality]
      : WEATHER_NORMALIZATION_FEATURE_GROUPS.meteorology
  ));
  const partialDependenceFeatureNames = uniqueFeatures(
    options.partialDependenceFeatureNames ?? DEFAULT_PARTIAL_DEPENDENCE_FEATURES,
  );

  return {
    featureNames: FEATURE_NAMES,
    shuffledFeatureNames,
    partialDependenceFeatureNames,
    covariateSet,
  };
}

function uniqueFeatures(features: readonly WeatherNormalizationFeatureName[]): WeatherNormalizationFeatureName[] {
  return [...new Set(features)].filter((feature) => FEATURE_NAMES.includes(feature));
}

function partialDependence(
  model: RandomForestModel,
  rows: WeatherNormalizationRow[],
  variables: WeatherNormalizationFeatureName[],
  resolution: number,
): WeatherPartialDependencePoint[] {
  const result: WeatherPartialDependencePoint[] = [];
  const sampleRows = rows.length > 240 ? rows.filter((_, index) => index % Math.ceil(rows.length / 240) === 0) : rows;
  for (const variable of variables) {
    const values = rows.map((row) => row[variable]).filter(isNumber).sort((a, b) => a - b);
    const grid = quantileGrid(values, resolution);
    for (const value of grid) {
      const predictions = sampleRows.map((row) => predictRandomForest(model, featureVector({ ...row, [variable]: value })).mean);
      result.push({
        variable,
        value: round(value, 4),
        partialDependency: round(average(predictions), 4),
      });
    }
  }
  return result;
}

function permutationImportance(
  model: RandomForestModel,
  rows: WeatherNormalizationRow[],
  seed: number,
): WeatherVariableImportance[] {
  const baselinePredictions = rows.map((row) => ({ observed: row.observed, predicted: predictRandomForest(model, featureVector(row)).mean }));
  const baselineRmse = evaluateRegressionPredictions(baselinePredictions).rmse ?? 0;
  const rng = mulberry32(seed + 211);
  return FEATURE_NAMES.map((variable) => {
    const shuffledValues = shuffle(rows.map((row) => row[variable]), rng);
    const predictions = rows.map((row, index) => ({
      observed: row.observed,
      predicted: predictRandomForest(model, featureVector({ ...row, [variable]: shuffledValues[index] })).mean,
    }));
    const rmse = evaluateRegressionPredictions(predictions).rmse ?? baselineRmse;
    return { variable, importance: Math.max(0, round(rmse - baselineRmse, 6)) };
  })
    .sort((left, right) => right.importance - left.importance)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function extendedMetrics(rows: Array<{ observed: number; predicted: number }>): WeatherModelDiagnostics["metrics"] {
  const base = evaluateRegressionPredictions(rows);
  const observed = rows.map((row) => row.observed);
  const predicted = rows.map((row) => row.predicted);
  const observedMean = average(observed);
  const rmse = base.rmse;
  const bias = base.bias;
  const denominator = observed.reduce((sum, value, index) => (
    sum + (Math.abs(predicted[index] - observedMean) + Math.abs(value - observedMean)) ** 2
  ), 0);
  const squareError = rows.reduce((sum, row) => sum + (row.predicted - row.observed) ** 2, 0);
  const totalSquares = observed.reduce((sum, value) => sum + (value - observedMean) ** 2, 0);
  return {
    ...base,
    pearsonR: roundOrNull(pearson(observed, predicted), 6),
    normalizedMeanBias: observedMean !== 0 && bias !== null ? round(bias / observedMean, 6) : null,
    normalizedRmse: observedMean !== 0 && rmse !== null ? round(rmse / observedMean, 6) : null,
    indexOfAgreement: denominator > 0 ? round(1 - squareError / denominator, 6) : null,
    coefficientOfEfficiency: totalSquares > 0 ? round(1 - squareError / totalSquares, 6) : null,
  };
}

function featureVector(row: WeatherNormalizationRow): number[] {
  return FEATURE_NAMES.map((feature) => row[feature]);
}

function meanNullable(left: number | null, right: number | null): number | null {
  const values = [left, right].filter(isNumber);
  return values.length ? average(values) : null;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function quantileGrid(values: number[], resolution: number): number[] {
  if (!values.length) return [];
  const steps = Math.max(2, resolution);
  const grid: number[] = [];
  for (let i = 0; i < steps; i += 1) {
    const p = i / (steps - 1);
    const index = Math.min(values.length - 1, Math.max(0, Math.round(p * (values.length - 1))));
    grid.push(values[index]);
  }
  return [...new Set(grid)];
}

function utcDayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.floor((date.getTime() - start) / 86_400_000) + 1;
}

function pearson(left: number[], right: number[]): number | null {
  if (left.length < 3 || left.length !== right.length) return null;
  const leftMean = average(left);
  const rightMean = average(right);
  let numerator = 0;
  let leftSquares = 0;
  let rightSquares = 0;
  for (let i = 0; i < left.length; i += 1) {
    const ld = left[i] - leftMean;
    const rd = right[i] - rightMean;
    numerator += ld * rd;
    leftSquares += ld * ld;
    rightSquares += rd * rd;
  }
  const denominator = Math.sqrt(leftSquares * rightSquares);
  return denominator > 0 ? numerator / denominator : null;
}

function shuffle(values: number[], rng: () => number): number[] {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function average(values: readonly number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function stdDev(values: readonly number[], mean: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function round(value: number, digits = 6): number {
  return Number(value.toFixed(digits));
}

function roundOrNull(value: number | null, digits: number): number | null {
  return value === null ? null : round(value, digits);
}

function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
