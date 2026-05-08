/**
 * Distribution-free prediction intervals via split conformal prediction.
 *
 * Given a held-out *calibration* set of (predicted, observed) pairs, the
 * conformal procedure estimates a per-point margin q̂ such that, on
 * exchangeable test data, the coverage of `predicted ± q̂` is at least
 * `1 - alpha` in finite samples. This wraps any model — kriging, IDW, RF,
 * neural networks — without requiring distributional assumptions, which
 * is the gap analytical kriging variance and RF-OOB cannot fill.
 *
 * References:
 * - Vovk et al. 2005 "Algorithmic Learning in a Random World"
 * - Angelopoulos & Bates 2023, "A Gentle Introduction to Conformal Prediction"
 * - GeoXCP 2025 (geographic adaptation; doi.org/10.1080/13658816.2025.2574900)
 */

import type { ValidationPrediction } from "./validationWorkbench";

export type ConformalResidualMode = "absolute" | "signed-absolute" | "normalized";

export type ConformalCalibrationOptions = {
  /** Target miscoverage level (default 0.05 ⇒ 95% intervals). */
  alpha?: number;
  /** How to score residuals; "absolute" yields symmetric intervals. */
  mode?: ConformalResidualMode;
  /**
   * Optional per-point uncertainty estimates (e.g. kriging variance) used
   * by the "normalized" mode to widen intervals where the model already
   * knows it is uncertain. Must be the same length as the calibration
   * predictions and strictly positive.
   */
  sigmas?: ReadonlyArray<number>;
};

export type ConformalCalibration = {
  alpha: number;
  mode: ConformalResidualMode;
  /** Calibration size after dropping non-finite pairs. */
  n: number;
  /** Conformal margin (absolute or normalized depending on mode). */
  qhat: number;
  /** Sorted nonconformity scores; useful for diagnostics and plotting. */
  scores: number[];
};

export type ConformalIntervalQuery = {
  predicted: number;
  /** Per-point sigma used only when calibration mode is "normalized". */
  sigma?: number;
};

export type ConformalInterval = {
  predicted: number;
  lower: number;
  upper: number;
};

export type ConformalEvaluation = {
  alpha: number;
  n: number;
  /** Empirical coverage on the test set (in [0, 1]). */
  coverage: number;
  /** Mean width of the produced intervals. */
  meanWidth: number;
  /** Number of test pairs that fell below the lower bound. */
  below: number;
  /** Number of test pairs that fell above the upper bound. */
  above: number;
};

function finiteOrNull(value: number | undefined | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

/**
 * Calibrate a conformal margin from cross-validation residuals. Pass the
 * `predictions` array from any `ValidationCvResult` (LLOCV, spatial-block
 * CV, temporal CV) — the calibration set is the held-out predictions, so
 * conformal margins inherit whatever bias structure the chosen CV reveals.
 */
export function calibrateConformal(
  predictions: ReadonlyArray<ValidationPrediction>,
  options: ConformalCalibrationOptions = {},
): ConformalCalibration {
  const alpha = options.alpha ?? 0.05;
  const mode: ConformalResidualMode = options.mode ?? "absolute";
  const sigmas = options.sigmas;

  const scores: number[] = [];
  predictions.forEach((prediction, index) => {
    const observed = finiteOrNull(prediction.observed);
    const predicted = finiteOrNull(prediction.predicted);
    if (observed === null || predicted === null) return;
    const residual = observed - predicted;
    if (mode === "normalized") {
      const sigma = sigmas?.[index];
      if (typeof sigma !== "number" || !Number.isFinite(sigma) || sigma <= 0) return;
      scores.push(Math.abs(residual) / sigma);
    } else {
      scores.push(Math.abs(residual));
    }
  });

  scores.sort((a, b) => a - b);
  const n = scores.length;
  // Conformal correction: pick the ceil((n+1)(1-alpha)) order statistic.
  // For tiny calibration sets fall back to the maximum to stay
  // conservative.
  let qhat: number;
  if (n === 0) {
    qhat = Number.POSITIVE_INFINITY;
  } else {
    const rank = Math.min(n, Math.ceil((n + 1) * (1 - alpha)));
    qhat = scores[rank - 1];
  }
  return { alpha, mode, n, qhat, scores };
}

/** Build prediction intervals from calibrated margin. */
export function conformalIntervals(
  calibration: ConformalCalibration,
  queries: ReadonlyArray<ConformalIntervalQuery>,
): ConformalInterval[] {
  return queries.map((query) => {
    const margin = calibration.mode === "normalized" && typeof query.sigma === "number"
      ? calibration.qhat * Math.max(query.sigma, 0)
      : calibration.qhat;
    return {
      predicted: query.predicted,
      lower: query.predicted - margin,
      upper: query.predicted + margin,
    };
  });
}

/**
 * Continuous Ranked Probability Score for symmetric Gaussian-like
 * predictive distributions. CRPS rewards both calibration and sharpness
 * and is the standard ensemble-forecast metric. We approximate the
 * forecast distribution with `mean ± sd` derived from a residual sample
 * (e.g. cross-validation residuals); for asymmetric forecasts a
 * sample-based CRPS should be used instead.
 *
 * CRPS_Gaussian(x; μ, σ) = σ · [ z·(2Φ(z) - 1) + 2·φ(z) - 1/√π ]
 *   where z = (x - μ) / σ.
 */
export function crpsGaussian(observed: number, mean: number, sd: number): number {
  if (!Number.isFinite(observed) || !Number.isFinite(mean) || !Number.isFinite(sd) || sd <= 0) {
    return Number.NaN;
  }
  const z = (observed - mean) / sd;
  return sd * (z * (2 * stdNormalCdf(z) - 1) + 2 * stdNormalPdf(z) - 1 / Math.sqrt(Math.PI));
}

/**
 * Sample-based CRPS for an arbitrary predictive ensemble. For an empirical
 * ensemble {x_i} of size m, CRPS = (1/m) Σ |x_i - y| - (1/(2 m²)) Σ Σ |x_i - x_j|.
 */
export function crpsFromSample(observed: number, sample: ReadonlyArray<number>): number {
  if (!Number.isFinite(observed)) return Number.NaN;
  const finite = sample.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return Number.NaN;
  const meanAbs = finite.reduce((sum, value) => sum + Math.abs(value - observed), 0) / finite.length;
  let pairwise = 0;
  for (let i = 0; i < finite.length; i += 1) {
    for (let j = 0; j < finite.length; j += 1) {
      pairwise += Math.abs(finite[i] - finite[j]);
    }
  }
  pairwise /= 2 * finite.length * finite.length;
  return meanAbs - pairwise;
}

/** Compute mean CRPS across a held-out batch. */
export function meanCrps(
  observed: ReadonlyArray<number>,
  means: ReadonlyArray<number>,
  sds: ReadonlyArray<number>,
): number {
  let total = 0;
  let count = 0;
  for (let i = 0; i < observed.length; i += 1) {
    const value = crpsGaussian(observed[i], means[i], sds[i]);
    if (Number.isFinite(value)) {
      total += value;
      count += 1;
    }
  }
  return count === 0 ? Number.NaN : total / count;
}

/**
 * Evaluate intervals on a held-out test set. Returns coverage and width
 * statistics — pair this with `conformalIntervals` to see how the
 * calibrated margin generalizes.
 */
export function evaluateConformalIntervals(
  intervals: ReadonlyArray<ConformalInterval>,
  observed: ReadonlyArray<number>,
  alpha: number,
): ConformalEvaluation {
  const n = Math.min(intervals.length, observed.length);
  let covered = 0;
  let width = 0;
  let below = 0;
  let above = 0;
  let valid = 0;
  for (let i = 0; i < n; i += 1) {
    const interval = intervals[i];
    const value = observed[i];
    if (!Number.isFinite(interval.lower) || !Number.isFinite(interval.upper) || !Number.isFinite(value)) continue;
    valid += 1;
    width += interval.upper - interval.lower;
    if (value < interval.lower) below += 1;
    else if (value > interval.upper) above += 1;
    else covered += 1;
  }
  return {
    alpha,
    n: valid,
    coverage: valid === 0 ? 0 : covered / valid,
    meanWidth: valid === 0 ? 0 : width / valid,
    below,
    above,
  };
}

function stdNormalPdf(x: number): number {
  return Math.exp(-(x * x) / 2) / Math.sqrt(2 * Math.PI);
}

function stdNormalCdf(x: number): number {
  // Abramowitz & Stegun approximation 7.1.26.
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1
    - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t
      * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}
