import type { InterpolationMethod, InterpolationPoint } from "./domain";
import { idwInterpolate, ordinaryKrigingInterpolate } from "./domain";

export type CrossValidationResidual = {
  id?: string;
  x: number;
  y: number;
  observed: number;
  predicted: number;
  error: number;
};

export type CrossValidationResult = {
  method: InterpolationMethod;
  n: number;
  rmse: number;
  mae: number;
  bias: number;
  residuals: CrossValidationResidual[];
};

export type LooCrossValidationOptions = {
  method: InterpolationMethod;
  idwPower?: number;
  idwMaxNeighbors?: number;
  krigingMaxNeighbors?: number;
};

const SINGLE_CELL_BOUNDS_PAD = 1e-4;

function singleCellBounds(x: number, y: number) {
  return {
    west: x - SINGLE_CELL_BOUNDS_PAD,
    east: x + SINGLE_CELL_BOUNDS_PAD,
    south: y - SINGLE_CELL_BOUNDS_PAD,
    north: y + SINGLE_CELL_BOUNDS_PAD,
  };
}

function predictAtPoint(
  remaining: InterpolationPoint[],
  x: number,
  y: number,
  options: LooCrossValidationOptions,
): number {
  const bounds = singleCellBounds(x, y);
  const grid =
    options.method === "kriging"
      ? ordinaryKrigingInterpolate(remaining, 1, 1, bounds, options.krigingMaxNeighbors ?? 12, 1)
      : idwInterpolate(remaining, 1, 1, bounds, options.idwPower ?? 2, options.idwMaxNeighbors ?? -1);
  return grid.values[0];
}

export function leaveOneOutCrossValidate(
  points: InterpolationPoint[],
  options: LooCrossValidationOptions,
): CrossValidationResult {
  const residuals: CrossValidationResidual[] = [];
  let sqSum = 0;
  let absSum = 0;
  let biasSum = 0;

  if (points.length < 3) {
    return {
      method: options.method,
      n: 0,
      rmse: 0,
      mae: 0,
      bias: 0,
      residuals,
    };
  }

  for (let i = 0; i < points.length; i += 1) {
    const held = points[i];
    const remaining = points.slice(0, i).concat(points.slice(i + 1));
    const predicted = predictAtPoint(remaining, held.x, held.y, options);
    if (!Number.isFinite(predicted)) continue;

    const error = predicted - held.value;
    residuals.push({
      id: held.id,
      x: held.x,
      y: held.y,
      observed: held.value,
      predicted,
      error,
    });
    sqSum += error * error;
    absSum += Math.abs(error);
    biasSum += error;
  }

  const n = residuals.length;
  if (n === 0) {
    return { method: options.method, n: 0, rmse: 0, mae: 0, bias: 0, residuals };
  }

  return {
    method: options.method,
    n,
    rmse: Math.sqrt(sqSum / n),
    mae: absSum / n,
    bias: biasSum / n,
    residuals,
  };
}

export function compareInterpolationMethods(
  points: InterpolationPoint[],
  methods: InterpolationMethod[] = ["idw", "kriging"],
): CrossValidationResult[] {
  return methods.map((method) => leaveOneOutCrossValidate(points, { method }));
}

export type ElevationTrend = {
  slope: number;
  intercept: number;
};

export function fitElevationTrend(points: InterpolationPoint[]): ElevationTrend | null {
  const usable = points.filter(
    (p) => typeof p.elevationMeters === "number" && Number.isFinite(p.elevationMeters),
  );
  if (usable.length < 3) return null;

  let sumX = 0;
  let sumY = 0;
  for (const p of usable) {
    sumX += p.elevationMeters as number;
    sumY += p.value;
  }
  const meanX = sumX / usable.length;
  const meanY = sumY / usable.length;

  let num = 0;
  let den = 0;
  for (const p of usable) {
    const dx = (p.elevationMeters as number) - meanX;
    num += dx * (p.value - meanY);
    den += dx * dx;
  }
  if (den === 0) return null;

  const slope = num / den;
  const intercept = meanY - slope * meanX;
  return { slope, intercept };
}

export function detrendByElevation(
  points: InterpolationPoint[],
  trend: ElevationTrend,
): InterpolationPoint[] {
  return points.map((p) => {
    if (typeof p.elevationMeters !== "number" || !Number.isFinite(p.elevationMeters)) {
      return p;
    }
    const predicted = trend.slope * p.elevationMeters + trend.intercept;
    return { ...p, value: p.value - predicted };
  });
}

export function applyElevationTrend(
  residual: number,
  elevationMeters: number | null | undefined,
  trend: ElevationTrend,
): number {
  if (typeof elevationMeters !== "number" || !Number.isFinite(elevationMeters)) {
    return residual + trend.intercept;
  }
  return residual + trend.slope * elevationMeters + trend.intercept;
}
