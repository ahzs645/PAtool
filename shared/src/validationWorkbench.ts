import type {
  IdwEstimateOptions,
  InterpolationMethod,
  InterpolationPoint,
  KrigingEstimateOptions,
  PointEstimate,
  PointEstimateQuery,
} from "./domain";
import {
  createOrdinaryKrigingModel,
  idwEstimateAtPoints,
  krigingEstimateAtPoints,
} from "./domain";

export type ValidationPrediction = {
  id?: string;
  x: number;
  y: number;
  observed: number;
  predicted: number;
  residual: number;
  foldId: string;
};

export type ValidationMetrics = {
  n: number;
  rmse: number;
  mae: number;
  bias: number;
  smape: number;
};

export type ValidationCvResult = ValidationMetrics & {
  method: InterpolationMethod;
  folds: number;
  predictions: ValidationPrediction[];
};

export type ValidationInterpolationOptions = {
  method?: InterpolationMethod;
  idw?: IdwEstimateOptions;
  kriging?: KrigingEstimateOptions;
};

export type SpatialBlockOptions = ValidationInterpolationOptions & {
  cellSizeLon: number;
  cellSizeLat: number;
  originLon?: number;
  originLat?: number;
};

export type ResidualPoint = {
  id?: string;
  x: number;
  y: number;
  residual: number;
};

export type MoransIOptions = {
  maxDistance?: number;
  kNearest?: number;
  inverseDistancePower?: number;
};

export type MoransIResult = {
  n: number;
  i: number;
  weightSum: number;
  meanResidual: number;
};

export type SemivariogramBin = {
  bin: number;
  minDistance: number;
  maxDistance: number;
  midpoint: number;
  pairs: number;
  semivariance: number;
};

export type SemivariogramOptions = {
  binWidth?: number;
  maxDistance?: number;
  binCount?: number;
};

export type PredictionInterval = {
  observed: number;
  lower: number;
  upper: number;
};

export type PredictionIntervalCoverage = {
  n: number;
  covered: number;
  coverage: number;
  meanWidth: number;
  below: number;
  above: number;
};

const DEFAULT_METHOD: InterpolationMethod = "idw";

function finitePoints(points: InterpolationPoint[]): InterpolationPoint[] {
  return points.filter(
    (point) =>
      Number.isFinite(point.x) &&
      Number.isFinite(point.y) &&
      Number.isFinite(point.value),
  );
}

function distance(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

function metricsFromPredictions(predictions: ValidationPrediction[]): ValidationMetrics {
  const n = predictions.length;
  if (n === 0) return { n: 0, rmse: 0, mae: 0, bias: 0, smape: 0 };

  let sq = 0;
  let abs = 0;
  let bias = 0;
  let smapeSum = 0;
  for (const prediction of predictions) {
    const error = prediction.predicted - prediction.observed;
    sq += error * error;
    abs += Math.abs(error);
    bias += error;
    smapeSum += smape(prediction.observed, prediction.predicted);
  }

  return {
    n,
    rmse: Math.sqrt(sq / n),
    mae: abs / n,
    bias: bias / n,
    smape: smapeSum / n,
  };
}

function predictionWithDefinedValue(estimate: PointEstimate): estimate is PointEstimate & { value: number } {
  return typeof estimate.value === "number" && Number.isFinite(estimate.value);
}

function estimateHeldOut(
  training: InterpolationPoint[],
  heldOut: InterpolationPoint[],
  options: ValidationInterpolationOptions,
): PointEstimate[] {
  const queries: PointEstimateQuery[] = heldOut.map((point) => ({
    id: point.id,
    x: point.x,
    y: point.y,
  }));
  const method = options.method ?? DEFAULT_METHOD;

  if (method === "kriging" && training.length >= 2) {
    return krigingEstimateAtPoints(createOrdinaryKrigingModel(training), queries, options.kriging);
  }

  return idwEstimateAtPoints(training, queries, options.idw);
}

function runGroupedCv(
  points: InterpolationPoint[],
  foldForPoint: (point: InterpolationPoint) => string,
  options: ValidationInterpolationOptions,
): ValidationCvResult {
  const usable = finitePoints(points);
  const byFold = new Map<string, InterpolationPoint[]>();
  for (const point of usable) {
    const key = foldForPoint(point);
    const fold = byFold.get(key) ?? [];
    fold.push(point);
    byFold.set(key, fold);
  }

  const predictions: ValidationPrediction[] = [];
  for (const [foldId, heldOut] of byFold) {
    const training = usable.filter((point) => foldForPoint(point) !== foldId);
    if (training.length === 0) continue;

    const estimates = estimateHeldOut(training, heldOut, options);
    estimates.forEach((estimate, index) => {
      if (!predictionWithDefinedValue(estimate)) return;
      const observed = heldOut[index].value;
      predictions.push({
        id: heldOut[index].id,
        x: heldOut[index].x,
        y: heldOut[index].y,
        observed,
        predicted: estimate.value,
        residual: observed - estimate.value,
        foldId,
      });
    });
  }

  return {
    method: options.method ?? DEFAULT_METHOD,
    folds: byFold.size,
    predictions,
    ...metricsFromPredictions(predictions),
  };
}

export function smape(actual: number, predicted: number): number {
  if (!Number.isFinite(actual) || !Number.isFinite(predicted)) return 0;
  const denominator = Math.abs(actual) + Math.abs(predicted);
  if (denominator === 0) return 0;
  return (2 * Math.abs(predicted - actual)) / denominator;
}

export function smapeForPairs(
  pairs: Array<{ actual: number; predicted: number }>,
): ValidationMetrics["smape"] {
  const usable = pairs.filter(
    (pair) => Number.isFinite(pair.actual) && Number.isFinite(pair.predicted),
  );
  if (usable.length === 0) return 0;
  return usable.reduce((sum, pair) => sum + smape(pair.actual, pair.predicted), 0) / usable.length;
}

export function leaveLocationOutCrossValidate(
  points: InterpolationPoint[],
  options: ValidationInterpolationOptions = {},
): ValidationCvResult {
  return runGroupedCv(
    points,
    (point) => point.id ?? `${point.x}:${point.y}`,
    options,
  );
}

export function spatialBlockCrossValidate(
  points: InterpolationPoint[],
  options: SpatialBlockOptions,
): ValidationCvResult {
  const usable = finitePoints(points);
  const originLon = options.originLon ?? (usable.length > 0 ? Math.min(...usable.map((point) => point.x)) : 0);
  const originLat = options.originLat ?? (usable.length > 0 ? Math.min(...usable.map((point) => point.y)) : 0);
  const lonSize = options.cellSizeLon > 0 ? options.cellSizeLon : 1;
  const latSize = options.cellSizeLat > 0 ? options.cellSizeLat : 1;

  return runGroupedCv(
    points,
    (point) => {
      const col = Math.floor((point.x - originLon) / lonSize);
      const row = Math.floor((point.y - originLat) / latSize);
      return `${col}:${row}`;
    },
    options,
  );
}

export function moransI(points: ResidualPoint[], options: MoransIOptions = {}): MoransIResult {
  const usable = points.filter(
    (point) =>
      Number.isFinite(point.x) &&
      Number.isFinite(point.y) &&
      Number.isFinite(point.residual),
  );
  const n = usable.length;
  if (n < 2) return { n, i: 0, weightSum: 0, meanResidual: 0 };

  const meanResidual = usable.reduce((sum, point) => sum + point.residual, 0) / n;
  let denominator = 0;
  for (const point of usable) {
    const centered = point.residual - meanResidual;
    denominator += centered * centered;
  }
  if (denominator === 0) return { n, i: 0, weightSum: 0, meanResidual };

  const maxDistance = options.maxDistance ?? Number.POSITIVE_INFINITY;
  const kNearest = options.kNearest ?? 0;
  const inverseDistancePower = options.inverseDistancePower ?? 1;
  let numerator = 0;
  let weightSum = 0;

  for (let i = 0; i < n; i += 1) {
    const neighbors = usable
      .map((other, j) => ({ j, d: i === j ? 0 : distance(usable[i].x, usable[i].y, other.x, other.y) }))
      .filter((entry) => entry.j !== i && entry.d > 0 && entry.d <= maxDistance)
      .sort((left, right) => left.d - right.d);
    const selected = kNearest > 0 ? neighbors.slice(0, kNearest) : neighbors;

    for (const { j, d } of selected) {
      const weight = inverseDistancePower === 0 ? 1 : 1 / Math.pow(d, inverseDistancePower);
      numerator += weight * (usable[i].residual - meanResidual) * (usable[j].residual - meanResidual);
      weightSum += weight;
    }
  }

  return {
    n,
    i: weightSum > 0 ? (n / weightSum) * (numerator / denominator) : 0,
    weightSum,
    meanResidual,
  };
}

export function residualSemivariogram(
  points: ResidualPoint[],
  options: SemivariogramOptions = {},
): SemivariogramBin[] {
  const usable = points.filter(
    (point) =>
      Number.isFinite(point.x) &&
      Number.isFinite(point.y) &&
      Number.isFinite(point.residual),
  );
  if (usable.length < 2) return [];

  const pairs: Array<{ d: number; gamma: number }> = [];
  let maxObservedDistance = 0;
  for (let i = 0; i < usable.length; i += 1) {
    for (let j = i + 1; j < usable.length; j += 1) {
      const d = distance(usable[i].x, usable[i].y, usable[j].x, usable[j].y);
      if (d === 0) continue;
      if (options.maxDistance !== undefined && d > options.maxDistance) continue;
      const delta = usable[i].residual - usable[j].residual;
      pairs.push({ d, gamma: 0.5 * delta * delta });
      maxObservedDistance = Math.max(maxObservedDistance, d);
    }
  }
  if (pairs.length === 0) return [];

  const maxDistance = options.maxDistance ?? maxObservedDistance;
  const binWidth = options.binWidth ?? (maxDistance > 0 ? maxDistance / Math.max(1, options.binCount ?? 10) : 1);
  const binCount = Math.max(1, options.binCount ?? Math.ceil(maxDistance / binWidth));
  const bins = new Map<number, { pairs: number; sum: number }>();

  for (const pair of pairs) {
    const bin = Math.min(Math.floor(pair.d / binWidth), binCount - 1);
    const current = bins.get(bin) ?? { pairs: 0, sum: 0 };
    current.pairs += 1;
    current.sum += pair.gamma;
    bins.set(bin, current);
  }

  return Array.from(bins.entries())
    .sort(([left], [right]) => left - right)
    .map(([bin, value]) => {
      const minDistance = bin * binWidth;
      const maxBinDistance = (bin + 1) * binWidth;
      return {
        bin,
        minDistance,
        maxDistance: maxBinDistance,
        midpoint: (minDistance + maxBinDistance) / 2,
        pairs: value.pairs,
        semivariance: value.sum / value.pairs,
      };
    });
}

export function predictionIntervalCoverage(
  intervals: PredictionInterval[],
): PredictionIntervalCoverage {
  const usable = intervals.filter(
    (interval) =>
      Number.isFinite(interval.observed) &&
      Number.isFinite(interval.lower) &&
      Number.isFinite(interval.upper) &&
      interval.lower <= interval.upper,
  );
  const n = usable.length;
  if (n === 0) return { n: 0, covered: 0, coverage: 0, meanWidth: 0, below: 0, above: 0 };

  let covered = 0;
  let width = 0;
  let below = 0;
  let above = 0;
  for (const interval of usable) {
    width += interval.upper - interval.lower;
    if (interval.observed < interval.lower) {
      below += 1;
    } else if (interval.observed > interval.upper) {
      above += 1;
    } else {
      covered += 1;
    }
  }

  return {
    n,
    covered,
    coverage: covered / n,
    meanWidth: width / n,
    below,
    above,
  };
}

export type { InterpolationMethod, InterpolationPoint } from "./domain";
