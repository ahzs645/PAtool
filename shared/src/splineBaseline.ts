/**
 * Spline quantile-regression baseline, ported from SENTINEL's
 * `getBaseline.R`. The original uses `quantreg::rq()` with a B-spline
 * basis. Here we approximate the same behaviour with:
 *
 *   1. A natural-cubic-spline basis on `df` knots placed at equally
 *      spaced quantiles of the input timeline.
 *   2. Quantile-regression weights solved by IRLS (iteratively
 *      reweighted least squares) targeting the τ-quantile.
 *
 * `df` defaults to `max(3, ceil(durationHours / 3))` — one spline knot
 * per 3 hours, matching SENTINEL's duration-scaled df rule.
 *
 * The signature is intentionally compatible with `baseline.ts`:
 *
 *   const { baseline, corrected } = estimateSplineQuantileBaseline(values, { tau: 0.02 });
 */

export type SplineBaselineOptions = {
  /** Target quantile (0–1). Default 0.02 (SENTINEL convention). */
  tau?: number;
  /** Knot count; otherwise derived from duration. */
  df?: number;
  /** Approximate sample-to-hour ratio; used only when df is auto. */
  samplesPerHour?: number;
  /** IRLS iterations. Default 25. */
  iterations?: number;
};

export type SplineBaselineResult = {
  baseline: number[];
  corrected: Array<number | null>;
  df: number;
};

function fillGaps(values: ReadonlyArray<number | null>): number[] {
  const out = values.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null));
  let prev: number | null = null;
  for (let i = 0; i < out.length; i += 1) if (out[i] !== null) { prev = out[i]; break; }
  if (prev === null) return new Array(out.length).fill(0);
  for (let i = 0; i < out.length; i += 1) {
    if (out[i] === null) out[i] = prev;
    else prev = out[i];
  }
  return out as number[];
}

function naturalCubicBasis(x: number[], knots: number[]): number[][] {
  // Build a truncated power basis: 1, x, then (x − ξⱼ)³₊ − (x − ξₖ)³₊ adjustments.
  const k = knots.length;
  const n = x.length;
  const basis: number[][] = Array.from({ length: n }, () => new Array(k + 2).fill(0));
  const last = knots[k - 1];
  const secondLast = knots[k - 2] ?? knots[0];
  const denom = last - secondLast || 1;
  for (let i = 0; i < n; i += 1) {
    basis[i][0] = 1;
    basis[i][1] = x[i];
    for (let j = 0; j < k - 2; j += 1) {
      const trunc = (z: number, knot: number) => {
        const v = z - knot;
        return v > 0 ? v * v * v : 0;
      };
      basis[i][j + 2] = (trunc(x[i], knots[j]) - trunc(x[i], last)) / denom
        - (trunc(x[i], secondLast) - trunc(x[i], last)) / denom;
    }
  }
  return basis;
}

function solveWeighted(basis: number[][], y: number[], weights: number[]): number[] {
  const cols = basis[0].length;
  const ata: number[][] = Array.from({ length: cols }, () => new Array(cols).fill(0));
  const aty: number[] = new Array(cols).fill(0);
  for (let i = 0; i < basis.length; i += 1) {
    const w = weights[i];
    for (let j = 0; j < cols; j += 1) {
      aty[j] += basis[i][j] * y[i] * w;
      for (let k = 0; k < cols; k += 1) ata[j][k] += basis[i][j] * basis[i][k] * w;
    }
  }
  // Tikhonov-regularised solve.
  for (let i = 0; i < cols; i += 1) ata[i][i] += 1e-9;
  return gauss(ata, aty);
}

function gauss(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m: number[][] = a.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i += 1) {
    let pivot = i;
    for (let k = i + 1; k < n; k += 1) {
      if (Math.abs(m[k][i]) > Math.abs(m[pivot][i])) pivot = k;
    }
    [m[i], m[pivot]] = [m[pivot], m[i]];
    const p = m[i][i] || 1e-12;
    for (let k = i; k <= n; k += 1) m[i][k] /= p;
    for (let k = 0; k < n; k += 1) {
      if (k === i) continue;
      const factor = m[k][i];
      for (let j = i; j <= n; j += 1) m[k][j] -= factor * m[i][j];
    }
  }
  return m.map((row) => row[n]);
}

export function estimateSplineQuantileBaseline(
  values: ReadonlyArray<number | null>,
  options: SplineBaselineOptions = {},
): SplineBaselineResult {
  const tau = Math.min(0.99, Math.max(0.01, options.tau ?? 0.02));
  const filled = fillGaps(values);
  const samplesPerHour = options.samplesPerHour ?? 1;
  const autoDf = Math.max(3, Math.ceil(filled.length / Math.max(1, samplesPerHour) / 3));
  const df = Math.max(3, Math.floor(options.df ?? autoDf));
  const iterations = Math.max(5, options.iterations ?? 25);

  // Equally spaced knots along index.
  const knots = Array.from({ length: df }, (_, i) => (i + 1) * (filled.length / (df + 1)));
  const x = filled.map((_, i) => i);
  const basis = naturalCubicBasis(x, knots);
  // IRLS targeting the τ-quantile loss.
  let beta = new Array<number>(basis[0].length).fill(0);
  let residuals = filled.slice();
  for (let iter = 0; iter < iterations; iter += 1) {
    const weights = residuals.map((r) => {
      const e = Math.abs(r) || 1e-6;
      return r < 0 ? (1 - tau) / e : tau / e;
    });
    beta = solveWeighted(basis, filled, weights);
    residuals = filled.map((y, i) => y - basis[i].reduce((s, v, j) => s + v * beta[j], 0));
  }
  const baseline = basis.map((row) => row.reduce((s, v, j) => s + v * beta[j], 0));
  return {
    baseline: baseline.map((v) => Number(v.toFixed(6))),
    corrected: values.map((v, i) =>
      typeof v === "number" && Number.isFinite(v)
        ? Number((v - baseline[i]).toFixed(6))
        : null,
    ),
    df,
  };
}
