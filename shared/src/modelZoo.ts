import type { InterpolationPoint } from "./domain";
import { idwInterpolate, ordinaryKrigingInterpolate } from "./domain";

export const MODEL_ZOO_MODEL_IDS = [
  "spatial-mean",
  "IDW",
  "ordinary-kriging",
  "RFSI-lite",
  "STRK-lite",
  "RFK-lite",
] as const;

export type ModelZooModelId = (typeof MODEL_ZOO_MODEL_IDS)[number];

export type ModelZooPoint = InterpolationPoint;

export type ModelZooMetrics = {
  n: number;
  rmse: number | null;
  mae: number | null;
  bias: number | null;
  smape: number | null;
  rSquared: number | null;
};

export type ModelZooPrediction = {
  id?: string;
  x: number;
  y: number;
  observed: number;
  predicted: number;
  error: number;
};

export type ModelZooReportRow = {
  modelId: ModelZooModelId;
  label: string;
  metrics: ModelZooMetrics;
  notes: string[];
  predictions: ModelZooPrediction[];
};

export type ModelZooReport = {
  models: ModelZooReportRow[];
  pointsUsed: number;
  pointsDropped: number;
  notes: string[];
};

export type BuildModelZooReportOptions = {
  modelIds?: readonly ModelZooModelId[];
  idwPower?: number;
  idwMaxNeighbors?: number;
  krigingMaxNeighbors?: number;
  includePredictions?: boolean;
};

type PredictionContext = {
  training: ModelZooPoint[];
  target: ModelZooPoint;
  options: Required<Pick<BuildModelZooReportOptions, "idwPower" | "idwMaxNeighbors" | "krigingMaxNeighbors">>;
};

type TrendModel = {
  centerX: number;
  centerY: number;
  coefficients: number[];
};

const SINGLE_CELL_BOUNDS_PAD = 1e-4;

const MODEL_LABELS: Record<ModelZooModelId, string> = {
  "spatial-mean": "Spatial mean baseline",
  IDW: "Inverse distance weighting",
  "ordinary-kriging": "Ordinary kriging",
  "RFSI-lite": "RFSI-lite deterministic trend + IDW residual",
  "STRK-lite": "STRK-lite deterministic spatial trend + kriging residual",
  "RFK-lite": "RFK-lite deterministic trend + blended kriging/IDW residual",
};

const MODEL_NOTES: Record<ModelZooModelId, string> = {
  "spatial-mean": "Uses the leave-one-out training mean; no spatial structure is modeled.",
  IDW: "Uses deterministic inverse distance weighting; this is not a fitted statistical model.",
  "ordinary-kriging": "Uses the package ordinary-kriging helper with an empirical variogram when at least three training points are available.",
  "RFSI-lite": "Approximation only: fits a deterministic spatial trend and interpolates residuals with IDW; no random forest is trained.",
  "STRK-lite": "Approximation only: fits a deterministic spatial trend and interpolates residuals with ordinary kriging; no temporal component is used.",
  "RFK-lite": "Approximation only: fits a deterministic spatial trend and blends kriging and IDW residual interpolation; no random forest is trained.",
};

export function buildModelZooReport(
  points: readonly ModelZooPoint[],
  options: BuildModelZooReportOptions = {},
): ModelZooReport {
  const usable = points.filter(isUsablePoint);
  const modelIds = [...new Set(options.modelIds ?? MODEL_ZOO_MODEL_IDS)];
  const normalizedOptions = {
    idwPower: options.idwPower ?? 2,
    idwMaxNeighbors: options.idwMaxNeighbors ?? -1,
    krigingMaxNeighbors: options.krigingMaxNeighbors ?? 12,
  };

  const models = modelIds.map((modelId) =>
    evaluateModel(modelId, usable, normalizedOptions, options.includePredictions ?? false),
  );
  const notes = [
    "Metrics are computed from leave-one-out predictions where each held-out point has a feasible training set.",
  ];
  if (usable.length < points.length) {
    notes.push("Dropped points with non-finite coordinates or values before evaluation.");
  }

  return {
    models,
    pointsUsed: usable.length,
    pointsDropped: points.length - usable.length,
    notes,
  };
}

function evaluateModel(
  modelId: ModelZooModelId,
  points: ModelZooPoint[],
  options: PredictionContext["options"],
  includePredictions: boolean,
): ModelZooReportRow {
  const predictions: ModelZooPrediction[] = [];
  const notes = [MODEL_NOTES[modelId]];
  let skipped = 0;

  for (let i = 0; i < points.length; i += 1) {
    const target = points[i];
    const training = points.slice(0, i).concat(points.slice(i + 1));
    const predicted = predict(modelId, { training, target, options });
    if (predicted === null) {
      skipped += 1;
      continue;
    }

    predictions.push({
      id: target.id,
      x: target.x,
      y: target.y,
      observed: target.value,
      predicted,
      error: predicted - target.value,
    });
  }

  if (skipped > 0) {
    notes.push(`Skipped ${skipped} held-out point(s) because the model needed more training points.`);
  }

  return {
    modelId,
    label: MODEL_LABELS[modelId],
    metrics: evaluatePredictions(predictions),
    notes,
    predictions: includePredictions ? predictions : [],
  };
}

function predict(modelId: ModelZooModelId, context: PredictionContext): number | null {
  switch (modelId) {
    case "spatial-mean":
      return meanValue(context.training);
    case "IDW":
      return predictIdw(context.training, context.target, context.options.idwPower, context.options.idwMaxNeighbors);
    case "ordinary-kriging":
      return predictKriging(context.training, context.target, context.options.krigingMaxNeighbors);
    case "RFSI-lite":
      return predictTrendResidual(context, "idw");
    case "STRK-lite":
      return predictTrendResidual(context, "kriging");
    case "RFK-lite":
      return predictTrendResidual(context, "blend");
  }
}

function predictTrendResidual(
  context: PredictionContext,
  residualMethod: "idw" | "kriging" | "blend",
): number | null {
  const trend = fitSpatialTrend(context.training);
  if (!trend) return null;

  const trendAtTarget = predictTrend(trend, context.target);
  const residualPoints = context.training.map((point) => ({
    ...point,
    value: point.value - predictTrend(trend, point),
  }));

  if (residualMethod === "idw") {
    const residual = predictIdw(
      residualPoints,
      context.target,
      context.options.idwPower,
      context.options.idwMaxNeighbors,
    );
    return residual === null ? null : trendAtTarget + residual;
  }

  if (residualMethod === "kriging") {
    const residual = predictKriging(residualPoints, context.target, context.options.krigingMaxNeighbors);
    return residual === null ? null : trendAtTarget + residual;
  }

  const idwResidual = predictIdw(
    residualPoints,
    context.target,
    context.options.idwPower,
    context.options.idwMaxNeighbors,
  );
  const krigingResidual = predictKriging(residualPoints, context.target, context.options.krigingMaxNeighbors);
  if (idwResidual === null && krigingResidual === null) return null;
  if (idwResidual === null) return trendAtTarget + krigingResidual!;
  if (krigingResidual === null) return trendAtTarget + idwResidual;
  return trendAtTarget + 0.5 * idwResidual + 0.5 * krigingResidual;
}

function predictIdw(
  training: ModelZooPoint[],
  target: ModelZooPoint,
  power: number,
  maxNeighbors: number,
): number | null {
  if (training.length < 1) return null;
  const grid = idwInterpolate(training, 1, 1, singleCellBounds(target), power, maxNeighbors);
  const value = grid.values[0];
  return Number.isFinite(value) ? value : null;
}

function predictKriging(
  training: ModelZooPoint[],
  target: ModelZooPoint,
  maxNeighbors: number,
): number | null {
  if (training.length < 3) return null;
  const grid = ordinaryKrigingInterpolate(training, 1, 1, singleCellBounds(target), maxNeighbors, 1);
  const value = grid.values[0];
  return Number.isFinite(value) ? value : null;
}

function singleCellBounds(point: Pick<ModelZooPoint, "x" | "y">) {
  return {
    west: point.x - SINGLE_CELL_BOUNDS_PAD,
    east: point.x + SINGLE_CELL_BOUNDS_PAD,
    south: point.y - SINGLE_CELL_BOUNDS_PAD,
    north: point.y + SINGLE_CELL_BOUNDS_PAD,
  };
}

function evaluatePredictions(predictions: readonly ModelZooPrediction[]): ModelZooMetrics {
  if (predictions.length === 0) {
    return { n: 0, rmse: null, mae: null, bias: null, smape: null, rSquared: null };
  }

  const observedMean = mean(predictions.map((prediction) => prediction.observed));
  let squareError = 0;
  let absoluteError = 0;
  let bias = 0;
  let smapeTotal = 0;
  let smapeCount = 0;
  let totalSquares = 0;

  for (const prediction of predictions) {
    const residual = prediction.predicted - prediction.observed;
    squareError += residual * residual;
    absoluteError += Math.abs(residual);
    bias += residual;
    totalSquares += (prediction.observed - observedMean) ** 2;

    const denominator = Math.abs(prediction.observed) + Math.abs(prediction.predicted);
    if (denominator > 0) {
      smapeTotal += (2 * Math.abs(residual)) / denominator;
      smapeCount += 1;
    }
  }

  return {
    n: predictions.length,
    rmse: round(Math.sqrt(squareError / predictions.length)),
    mae: round(absoluteError / predictions.length),
    bias: round(bias / predictions.length),
    smape: smapeCount > 0 ? round((100 * smapeTotal) / smapeCount) : null,
    rSquared: totalSquares > 0 ? round(1 - squareError / totalSquares) : null,
  };
}

function fitSpatialTrend(points: readonly ModelZooPoint[]): TrendModel | null {
  if (points.length < 3) return null;

  const centerX = mean(points.map((point) => point.x));
  const centerY = mean(points.map((point) => point.y));
  const matrix = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const rhs = [0, 0, 0];

  for (const point of points) {
    const features = trendFeatures(point, centerX, centerY);
    for (let row = 0; row < features.length; row += 1) {
      rhs[row] += features[row] * point.value;
      for (let col = 0; col < features.length; col += 1) {
        matrix[row][col] += features[row] * features[col];
      }
    }
  }

  for (let i = 1; i < matrix.length; i += 1) {
    matrix[i][i] += 1e-9;
  }

  const coefficients = solveLinearSystem(matrix, rhs);
  return coefficients ? { centerX, centerY, coefficients } : null;
}

function predictTrend(model: TrendModel, point: ModelZooPoint): number {
  const features = trendFeatures(point, model.centerX, model.centerY);
  return model.coefficients.reduce((total, coefficient, index) => total + coefficient * features[index], 0);
}

function trendFeatures(point: Pick<ModelZooPoint, "x" | "y">, centerX: number, centerY: number): number[] {
  return [1, (point.x - centerX) * 100, (point.y - centerY) * 100];
}

function solveLinearSystem(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  const a = matrix.map((row, index) => row.concat(rhs[index]));

  for (let pivot = 0; pivot < n; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < n; row += 1) {
      if (Math.abs(a[row][pivot]) > Math.abs(a[best][pivot])) best = row;
    }
    if (Math.abs(a[best][pivot]) < 1e-12) return null;
    [a[pivot], a[best]] = [a[best], a[pivot]];

    const scale = a[pivot][pivot];
    for (let col = pivot; col <= n; col += 1) a[pivot][col] /= scale;

    for (let row = 0; row < n; row += 1) {
      if (row === pivot) continue;
      const factor = a[row][pivot];
      for (let col = pivot; col <= n; col += 1) {
        a[row][col] -= factor * a[pivot][col];
      }
    }
  }

  return a.map((row) => row[n]);
}

function meanValue(points: readonly ModelZooPoint[]): number | null {
  return points.length > 0 ? mean(points.map((point) => point.value)) : null;
}

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function round(value: number): number {
  return Number(value.toFixed(6));
}

function isUsablePoint(point: ModelZooPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.value);
}
