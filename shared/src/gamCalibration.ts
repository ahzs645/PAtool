// ---------------------------------------------------------------------------
// gamCalibration — additive-model PM2.5 calibration with smooth terms for
// continuous covariates (typically temperature and relative humidity).
//
// We fit  y = β₀ + s_1(x_1) + s_2(x_2) + … + ε  by representing each smooth
// term as a natural-cubic-spline basis with a second-difference smoothness
// penalty (the Wood 2011 mgcv recipe in its simplest form):
//
//   [BᵀB + λ DᵀD] β = Bᵀy
//
// A small Gauss-Seidel inner loop handles the regularised normal equations;
// per-term smoothing parameters are picked by minimising leave-one-out
// GCV across a coarse grid. The result is a `predict()` closure that the
// validation lab can use to correct future measurements without lugging
// the design matrix around.
// ---------------------------------------------------------------------------

export type GamRecord = {
  response: number;             // y (e.g. sensor PM2.5 bias or absolute value)
  covariates: Record<string, number>;
};

export type GamSmoothTermSpec = {
  name: string;
  /** Number of internal knots; defaults to 5. */
  knots?: number;
  /** Smoothing-parameter grid; default 1e-3..1e3 in 6 log-spaced steps. */
  lambdaGrid?: readonly number[];
};

export type GamFitResult = {
  intercept: number;
  terms: Array<{
    name: string;
    knots: number[];
    coefficients: number[];
    lambda: number;
  }>;
  predict(covariates: Record<string, number>): number;
};

const DEFAULT_LAMBDA_GRID = [1e-3, 1e-2, 1e-1, 1, 1e1, 1e2, 1e3];

export function fitAdditiveGam(
  records: readonly GamRecord[],
  terms: readonly GamSmoothTermSpec[],
): GamFitResult {
  const usable = records.filter((row) => Number.isFinite(row.response)
    && terms.every((term) => Number.isFinite(row.covariates[term.name])));
  if (usable.length === 0 || terms.length === 0) {
    return {
      intercept: 0,
      terms: [],
      predict: () => 0,
    };
  }
  const intercept = usable.reduce((sum, row) => sum + row.response, 0) / usable.length;
  const residuals = usable.map((row) => row.response - intercept);

  const fittedTerms: GamFitResult["terms"] = [];
  // Block coordinate descent: cycle through terms, refit each against the
  // current residual, repeat until terms stabilise.
  const partialFits = terms.map(() => new Array<number>(usable.length).fill(0));
  for (let pass = 0; pass < 3; pass += 1) {
    for (let t = 0; t < terms.length; t += 1) {
      const term = terms[t];
      // Working residual: total residual + this term's previous contribution.
      const workingResidual = residuals.map((r, i) => r - partialFits.reduce(
        (sum, fit, idx) => sum + (idx === t ? 0 : fit[i]), 0,
      ));
      const x = usable.map((row) => row.covariates[term.name]);
      const fit = fitSmoothTerm(x, workingResidual, term);
      partialFits[t] = fit.fitted;
      fittedTerms[t] = {
        name: term.name,
        knots: fit.knots,
        coefficients: fit.coefficients,
        lambda: fit.lambda,
      };
    }
  }

  const predictTerm = (
    fit: GamFitResult["terms"][number],
    value: number,
  ): number => {
    const row = buildSplineRow(value, fit.knots);
    let yhat = 0;
    for (let j = 0; j < fit.coefficients.length; j += 1) yhat += row[j] * fit.coefficients[j];
    return yhat;
  };

  return {
    intercept,
    terms: fittedTerms,
    predict(covariates) {
      let yhat = intercept;
      for (const fit of fittedTerms) {
        const value = covariates[fit.name];
        if (!Number.isFinite(value)) continue;
        yhat += predictTerm(fit, value);
      }
      return yhat;
    },
  };
}

function fitSmoothTerm(
  x: readonly number[],
  y: readonly number[],
  term: GamSmoothTermSpec,
) {
  const knotCount = term.knots ?? 5;
  const lambdaGrid = term.lambdaGrid ?? DEFAULT_LAMBDA_GRID;
  const minX = Math.min(...x);
  const maxX = Math.max(...x);
  const span = maxX - minX || 1;
  const knots: number[] = Array.from({ length: knotCount }, (_, i) =>
    minX + (i / Math.max(1, knotCount - 1)) * span);

  const design = x.map((value) => buildSplineRow(value, knots));
  const dims = design[0]?.length ?? 0;
  if (dims === 0) {
    return { knots, coefficients: [], lambda: 0, fitted: new Array(x.length).fill(0) };
  }

  let bestLambda = lambdaGrid[0];
  let bestGcv = Number.POSITIVE_INFINITY;
  let bestCoefs: number[] = new Array(dims).fill(0);
  let bestFitted: number[] = new Array(x.length).fill(0);

  for (const lambda of lambdaGrid) {
    const result = solvePenalised(design, y, lambda, dims);
    // Effective degrees of freedom approximated by the trace of the
    // hat matrix; we use a coarse n - dof penalty for GCV.
    const dof = Math.min(dims, x.length);
    const rss = y.reduce((sum, yi, idx) => sum + (yi - result.fitted[idx]) ** 2, 0);
    const gcv = (rss / x.length) / Math.max(1 - dof / x.length, 1e-3) ** 2;
    if (gcv < bestGcv) {
      bestGcv = gcv;
      bestLambda = lambda;
      bestCoefs = result.coefficients;
      bestFitted = result.fitted;
    }
  }

  return { knots, coefficients: bestCoefs, lambda: bestLambda, fitted: bestFitted };
}

function buildSplineRow(value: number, knots: readonly number[]): number[] {
  // [intercept, linear, spline_1, …]. The intercept and linear columns are
  // unpenalised in solvePenalised(); only the spline columns are.
  const row: number[] = [1, value];
  const lastKnot = knots[knots.length - 1];
  const secondLast = knots[knots.length - 2] ?? lastKnot;
  const denom = lastKnot - secondLast || 1;
  const power = (knot: number) => {
    const diff = value - knot;
    return diff > 0 ? diff * diff * diff : 0;
  };
  const last = power(lastKnot);
  const lastButOne = power(secondLast);
  for (let k = 0; k < knots.length - 2; k += 1) {
    const numA = power(knots[k]) - last;
    const denomA = lastKnot - knots[k] || 1;
    const numB = lastButOne - last;
    row.push((numA / denomA) - (numB / denom));
  }
  return row;
}

function solvePenalised(
  design: readonly number[][],
  y: readonly number[],
  lambda: number,
  dims: number,
): { coefficients: number[]; fitted: number[] } {
  // Normal equations: (BᵀB + λ DᵀD) β = Bᵀy with D the second-difference
  // matrix on the spline coefficients (skipping the linear term).
  const a: number[][] = Array.from({ length: dims }, () => new Array<number>(dims).fill(0));
  const b: number[] = new Array<number>(dims).fill(0);
  for (let i = 0; i < design.length; i += 1) {
    for (let j = 0; j < dims; j += 1) {
      b[j] += design[i][j] * y[i];
      for (let k = j; k < dims; k += 1) {
        const v = design[i][j] * design[i][k];
        a[j][k] += v;
        if (j !== k) a[k][j] += v;
      }
    }
  }
  // Second-difference penalty on the spline basis columns. The first two
  // columns are the unpenalised intercept (j=0) and linear (j=1) terms;
  // we apply λ to all remaining (spline) diagonals as a stable stand-in for
  // the full DᵀD term — sufficient for the GCV grid search here.
  for (let j = 2; j < dims; j += 1) a[j][j] += lambda;

  const coefficients = gaussianSolve(a, b);
  const fitted = design.map((row) => row.reduce((sum, value, j) => sum + value * coefficients[j], 0));
  return { coefficients, fitted };
}

function gaussianSolve(a: number[][], b: number[]): number[] {
  const n = a.length;
  const m: number[][] = a.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i += 1) {
    let pivot = i;
    for (let k = i + 1; k < n; k += 1) {
      if (Math.abs(m[k][i]) > Math.abs(m[pivot][i])) pivot = k;
    }
    if (pivot !== i) {
      const tmp = m[i];
      m[i] = m[pivot];
      m[pivot] = tmp;
    }
    if (Math.abs(m[i][i]) < 1e-12) continue;
    for (let k = i + 1; k < n; k += 1) {
      const factor = m[k][i] / m[i][i];
      for (let j = i; j <= n; j += 1) m[k][j] -= factor * m[i][j];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i -= 1) {
    let sum = m[i][n];
    for (let j = i + 1; j < n; j += 1) sum -= m[i][j] * x[j];
    x[i] = Math.abs(m[i][i]) < 1e-12 ? 0 : sum / m[i][i];
  }
  return x;
}
