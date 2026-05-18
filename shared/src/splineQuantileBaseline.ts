// ---------------------------------------------------------------------------
// splineQuantileBaseline — duration-scaled cubic-spline quantile-regression
// baseline analogous to the SENTINEL `quantile_baseline` helper. Used to
// estimate a slowly-varying low-quantile baseline (typically τ = 0.02) for
// background-PM2.5 attribution or wildfire-smoke decomposition.
//
// Approach
// --------
// 1. Build a natural-cubic-spline basis on `series.length` knots, with the
//    knot count scaled to the duration of the series (≈ 1 knot per `df`
//    days, where df defaults to `series.length / 24 / 14` ≈ one knot every
//    two weeks for hourly data).
// 2. Fit the τ-quantile by subgradient descent on the pinball-loss
//    objective: L = Σ ρ_τ(y_i - x_i · β) with ρ_τ(u) = max(τu, (τ-1)u).
//
// Pure functional API; no SciPy or quantreg dependency. Used by the report
// page and validation lab where a windowed quantile is too jagged.
// ---------------------------------------------------------------------------

export type QuantileSeriesPoint = { x: number; y: number };

export type SplineQuantileFit = {
  tau: number;
  knots: number[];
  coefficients: number[];
  fitted: number[];
  iterations: number;
};

export type SplineQuantileOptions = {
  tau?: number;            // quantile target (0..1). Default 0.02.
  df?: number;             // degrees of freedom for the spline basis
  iterations?: number;     // subgradient steps. Default 500.
  learningRate?: number;   // step size scaled by 1/sqrt(t)
};

export function fitSplineQuantile(
  series: readonly QuantileSeriesPoint[],
  options: SplineQuantileOptions = {},
): SplineQuantileFit {
  const tau = options.tau ?? 0.02;
  const iterations = options.iterations ?? 500;
  const learningRate = options.learningRate ?? 0.05;

  const n = series.length;
  if (n === 0) {
    return { tau, knots: [], coefficients: [], fitted: [], iterations: 0 };
  }
  const xs = series.map((point) => point.x);
  const ys = series.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const span = (maxX - minX) || 1;

  // Pick the number of knots from the requested df. Default ~ duration / 14d
  // assuming hourly inputs (one knot every two weeks).
  const defaultDf = Math.max(4, Math.round(n / (24 * 14)));
  const df = options.df ?? defaultDf;
  const knotCount = Math.max(2, df);
  const knots: number[] = [];
  for (let k = 0; k < knotCount; k += 1) {
    knots.push(minX + (k / (knotCount - 1)) * span);
  }

  // Design matrix: intercept + (x - minX)/span + natural-cubic-spline
  // basis using truncated cubic (x - knot)_+^3 with the standard two-knot
  // adjustment to satisfy zero second-derivative end conditions.
  const design = buildNaturalCubicBasis(xs, knots, minX, span);
  const beta = new Float64Array(design[0].length);
  // Initialise intercept to the empirical τ-quantile of y.
  beta[0] = quantile(ys, tau);

  let step = learningRate;
  for (let t = 0; t < iterations; t += 1) {
    step = learningRate / Math.sqrt(t + 1);
    const grad = new Float64Array(beta.length);
    for (let i = 0; i < n; i += 1) {
      let prediction = 0;
      for (let j = 0; j < beta.length; j += 1) prediction += beta[j] * design[i][j];
      const residual = ys[i] - prediction;
      const subgrad = residual >= 0 ? -tau : 1 - tau;
      for (let j = 0; j < beta.length; j += 1) grad[j] += subgrad * design[i][j];
    }
    for (let j = 0; j < beta.length; j += 1) beta[j] -= (step * grad[j]) / n;
  }

  const fitted = design.map((row) => row.reduce((sum, value, j) => sum + value * beta[j], 0));
  return {
    tau,
    knots,
    coefficients: [...beta],
    fitted,
    iterations,
  };
}

function buildNaturalCubicBasis(
  xs: readonly number[],
  knots: readonly number[],
  minX: number,
  span: number,
): number[][] {
  const lastKnot = knots[knots.length - 1];
  const secondLast = knots[knots.length - 2] ?? lastKnot;
  const denom = lastKnot - secondLast || 1;
  return xs.map((x) => {
    const row: number[] = [1, (x - minX) / span];
    const power = (knot: number) => {
      const diff = x - knot;
      return diff > 0 ? diff * diff * diff : 0;
    };
    const last = power(lastKnot);
    const lastButOne = power(secondLast);
    for (let k = 0; k < knots.length - 2; k += 1) {
      // d_k(x) = ((x - ξ_k)_+^3 - (x - ξ_K)_+^3) / (ξ_K - ξ_k)
      // - ((x - ξ_{K-1})_+^3 - (x - ξ_K)_+^3) / (ξ_K - ξ_{K-1})
      const numA = power(knots[k]) - last;
      const denomA = lastKnot - knots[k] || 1;
      const numB = lastButOne - last;
      row.push((numA / denomA) - (numB / denom));
    }
    return row;
  });
}

function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  if (lower === upper) return sorted[lower];
  const frac = pos - lower;
  return sorted[lower] * (1 - frac) + sorted[upper] * frac;
}
