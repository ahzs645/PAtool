/**
 * Smoothers ported from openair: Whittaker, Gaussian kernel, Kolmogorov–
 * Zurbenko, rolling mean, and rolling quantile. Designed for hourly
 * pollutant series. All work on `number[]`; nulls/NaNs are linearly
 * interpolated before smoothing so the output length always matches the
 * input.
 */

export type SmootherSeries = ReadonlyArray<number | null>;

function fillGaps(values: SmootherSeries): number[] {
  const filled = values.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null));
  let last: number | null = null;
  for (let i = 0; i < filled.length; i += 1) {
    if (filled[i] === null) continue;
    last = filled[i];
    break;
  }
  if (last === null) return new Array(filled.length).fill(0);

  let prev = last;
  let prevIdx = -1;
  const out: number[] = new Array(filled.length).fill(0);
  for (let i = 0; i < filled.length; i += 1) {
    if (filled[i] !== null) {
      if (prevIdx >= 0 && i - prevIdx > 1) {
        for (let j = prevIdx + 1; j < i; j += 1) {
          const t = (j - prevIdx) / (i - prevIdx);
          out[j] = prev + (filled[i]! - prev) * t;
        }
      }
      out[i] = filled[i]!;
      prev = filled[i]!;
      prevIdx = i;
    }
  }
  for (let j = prevIdx + 1; j < filled.length; j += 1) out[j] = prev;
  return out;
}

/**
 * Rolling mean with a centered window. `window` is the total span (odd or
 * even). Edge points use the partial window available.
 */
export function rollingMean(values: SmootherSeries, window: number): number[] {
  if (window < 1) return fillGaps(values);
  const filled = fillGaps(values);
  const half = Math.floor(window / 2);
  const out: number[] = new Array(filled.length).fill(0);
  for (let i = 0; i < filled.length; i += 1) {
    const start = Math.max(0, i - half);
    const end = Math.min(filled.length, i + half + 1);
    let sum = 0;
    for (let k = start; k < end; k += 1) sum += filled[k];
    out[i] = sum / (end - start);
  }
  return out;
}

/**
 * Rolling quantile (e.g. median = 0.5). Useful for openair's percentile
 * rose / trend bands.
 */
export function rollingQuantile(values: SmootherSeries, window: number, q: number): number[] {
  if (window < 1) return fillGaps(values);
  const filled = fillGaps(values);
  const half = Math.floor(window / 2);
  const out: number[] = new Array(filled.length).fill(0);
  for (let i = 0; i < filled.length; i += 1) {
    const start = Math.max(0, i - half);
    const end = Math.min(filled.length, i + half + 1);
    const window_ = filled.slice(start, end).sort((a, b) => a - b);
    const pos = Math.min(window_.length - 1, Math.max(0, q * (window_.length - 1)));
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    out[i] = lo === hi ? window_[lo] : window_[lo] + (window_[hi] - window_[lo]) * (pos - lo);
  }
  return out;
}

/**
 * Symmetric Gaussian kernel smoother. `bandwidth` is in samples; effective
 * half-width is ~3·bandwidth.
 */
export function gaussianSmooth(values: SmootherSeries, bandwidth = 5): number[] {
  if (bandwidth <= 0) return fillGaps(values);
  const filled = fillGaps(values);
  const half = Math.max(1, Math.ceil(bandwidth * 3));
  const weights: number[] = [];
  for (let k = -half; k <= half; k += 1) {
    weights.push(Math.exp(-(k * k) / (2 * bandwidth * bandwidth)));
  }
  const out: number[] = new Array(filled.length).fill(0);
  for (let i = 0; i < filled.length; i += 1) {
    let sum = 0;
    let weightSum = 0;
    for (let k = -half; k <= half; k += 1) {
      const j = i + k;
      if (j < 0 || j >= filled.length) continue;
      const w = weights[k + half];
      sum += filled[j] * w;
      weightSum += w;
    }
    out[i] = weightSum > 0 ? sum / weightSum : filled[i];
  }
  return out;
}

/**
 * Kolmogorov–Zurbenko filter: iterated moving averages. `window` is the
 * MA window in samples; `iterations` is the iteration count. KZ(m, k) is a
 * common openair pattern for separating weather-scale signal from trend.
 */
export function kzFilter(values: SmootherSeries, window: number, iterations = 3): number[] {
  let series = fillGaps(values);
  for (let iter = 0; iter < iterations; iter += 1) {
    series = rollingMean(series, window);
  }
  return series;
}

/**
 * Whittaker–Eilers smoother (penalized least squares, second-difference
 * penalty). `lambda` controls smoothness — larger ≈ smoother. Implemented
 * via Cholesky on the pentadiagonal normal equations.
 */
export function whittakerSmooth(values: SmootherSeries, lambda = 100): number[] {
  const y = fillGaps(values);
  const n = y.length;
  if (n < 3) return y;

  // Build pentadiagonal A = I + λ·D²ᵀD² as five diagonals (a2,a1,a0,a1,a2).
  const a0 = new Array<number>(n).fill(1);
  const a1 = new Array<number>(n).fill(0);
  const a2 = new Array<number>(n).fill(0);
  // D² has 1, -2, 1 at rows 0..n-3
  for (let i = 0; i < n; i += 1) {
    let d = 0;
    if (i >= 0 && i <= n - 3) d += 1;
    if (i >= 1 && i <= n - 2) d += 4;
    if (i >= 2 && i <= n - 1) d += 1;
    a0[i] += lambda * d;
  }
  for (let i = 0; i < n - 1; i += 1) {
    let d = 0;
    if (i >= 0 && i <= n - 3) d += -2;
    if (i >= 1 && i <= n - 2) d += -2;
    a1[i] += lambda * d;
  }
  for (let i = 0; i < n - 2; i += 1) {
    a2[i] += lambda * 1;
  }

  // Cholesky LDLᵀ with bandwidth 2.
  const l1 = new Array<number>(n).fill(0);
  const l2 = new Array<number>(n).fill(0);
  const d = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    let di = a0[i];
    if (i >= 1) di -= l1[i - 1] * l1[i - 1] * d[i - 1];
    if (i >= 2) di -= l2[i - 2] * l2[i - 2] * d[i - 2];
    d[i] = di || 1e-12;
    if (i + 1 < n) {
      let v = a1[i];
      if (i >= 1) v -= l2[i - 1] * l1[i - 1] * d[i - 1];
      l1[i] = v / d[i];
    }
    if (i + 2 < n) {
      l2[i] = a2[i] / d[i];
    }
  }

  // Forward solve Lz = y.
  const z = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    let zi = y[i];
    if (i >= 1) zi -= l1[i - 1] * z[i - 1];
    if (i >= 2) zi -= l2[i - 2] * z[i - 2];
    z[i] = zi;
  }
  // Diagonal divide.
  for (let i = 0; i < n; i += 1) z[i] /= d[i];
  // Backward solve Lᵀ x = z.
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i -= 1) {
    let xi = z[i];
    if (i + 1 < n) xi -= l1[i] * x[i + 1];
    if (i + 2 < n) xi -= l2[i] * x[i + 2];
    x[i] = xi;
  }
  return x;
}
