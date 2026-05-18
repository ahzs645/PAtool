// ---------------------------------------------------------------------------
// openairSmoothers — TS ports of common air-quality smoothing helpers:
//   - rollingMean       : centred / trailing window mean over a numeric series
//   - gaussianSmooth    : Gaussian-kernel convolution (truncated at 3σ)
//   - kzFilter          : Kolmogorov–Zurbenko (repeated moving average)
//   - whittakerSmooth   : Whittaker–Eilers penalized-least-squares smoother
//                         (banded LDLᵀ solver, no matrix library required)
//
// Inputs are plain numeric arrays so callers can plug in any time series; null
// values are skipped (smoothed output is `null` where the window contains too
// few finite points to support the algorithm).
// ---------------------------------------------------------------------------

export type Smoothable = ReadonlyArray<number | null | undefined>;

export type RollingMeanOptions = {
  align?: "center" | "trailing";
  minObservations?: number;
};

export function rollingMean(values: Smoothable, window: number, options: RollingMeanOptions = {}): Array<number | null> {
  if (window <= 0 || values.length === 0) return values.map(() => null);
  const align = options.align ?? "center";
  const minObs = options.minObservations ?? Math.ceil(window * 0.75);
  const result: Array<number | null> = new Array(values.length).fill(null);
  for (let i = 0; i < values.length; i += 1) {
    let start: number;
    let end: number;
    if (align === "center") {
      start = i - Math.floor(window / 2);
      end = start + window;
    } else {
      start = i - window + 1;
      end = i + 1;
    }
    start = Math.max(0, start);
    end = Math.min(values.length, end);
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j += 1) {
      const value = values[j];
      if (typeof value === "number" && Number.isFinite(value)) {
        sum += value;
        count += 1;
      }
    }
    result[i] = count >= minObs ? sum / count : null;
  }
  return result;
}

export type GaussianSmoothOptions = {
  sigma: number;
  truncate?: number; // kernel radius in sigmas (default 3)
};

export function gaussianSmooth(values: Smoothable, options: GaussianSmoothOptions): Array<number | null> {
  const { sigma } = options;
  if (sigma <= 0 || values.length === 0) return values.map(() => null);
  const truncate = options.truncate ?? 3;
  const radius = Math.max(1, Math.ceil(truncate * sigma));
  const kernel: number[] = [];
  let kernelSum = 0;
  for (let k = -radius; k <= radius; k += 1) {
    const w = Math.exp(-(k * k) / (2 * sigma * sigma));
    kernel.push(w);
    kernelSum += w;
  }
  for (let i = 0; i < kernel.length; i += 1) kernel[i] /= kernelSum;

  const result: Array<number | null> = new Array(values.length).fill(null);
  for (let i = 0; i < values.length; i += 1) {
    let weighted = 0;
    let weightUsed = 0;
    for (let k = -radius; k <= radius; k += 1) {
      const idx = i + k;
      if (idx < 0 || idx >= values.length) continue;
      const value = values[idx];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      const w = kernel[k + radius];
      weighted += value * w;
      weightUsed += w;
    }
    result[i] = weightUsed > 0 ? weighted / weightUsed : null;
  }
  return result;
}

// Kolmogorov–Zurbenko filter: `iterations` passes of a centred rolling mean.
// Equivalent to the openair / kza-R implementation; widely used to extract
// baseline / long-term components from AQ series.
export function kzFilter(values: Smoothable, window: number, iterations = 3): Array<number | null> {
  if (window <= 0 || iterations <= 0) return values.map(() => null);
  let current: Array<number | null> = values.map((v) =>
    typeof v === "number" && Number.isFinite(v) ? v : null,
  );
  for (let pass = 0; pass < iterations; pass += 1) {
    current = rollingMean(current, window, { align: "center", minObservations: 1 });
  }
  return current;
}

// Whittaker–Eilers smoother (Eilers 2003): minimise
//   sum_i (y_i - z_i)^2  +  lambda * sum_i (Δ^d z_i)^2
// with a banded LDLᵀ solve. We support d ∈ {1, 2} (default 2 = quadratic
// penalty, like openair::smoothTrend).
export type WhittakerSmoothOptions = {
  lambda: number;
  differenceOrder?: 1 | 2;
};

export function whittakerSmooth(values: Smoothable, options: WhittakerSmoothOptions): Array<number | null> {
  const { lambda } = options;
  const order = options.differenceOrder ?? 2;
  const n = values.length;
  if (n === 0) return [];

  const weights = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const value = values[i];
    if (typeof value === "number" && Number.isFinite(value)) {
      y[i] = value;
      weights[i] = 1;
    } else {
      y[i] = 0;
      weights[i] = 0;
    }
  }

  // A = W + lambda * D'D where D is the d-th order forward-difference matrix.
  // Bandwidth = order. Use a symmetric banded matrix with `order + 1` diagonals.
  const bandWidth = order + 1; // diagonals: main + `order` super-diagonals
  // a[i][k] = A[i, i+k] for k=0..order. We store row-major.
  const a: Float64Array[] = Array.from({ length: n }, () => new Float64Array(bandWidth));

  // Add weights to main diagonal
  for (let i = 0; i < n; i += 1) a[i][0] = weights[i];

  // Build D'D contribution. The k-th order difference has coefficients given
  // by signed binomial(order, j). For each row i where the difference operator
  // is defined (i <= n - order - 1), add lambda * c_j * c_k to A[i+j, i+k].
  const coeffs = differenceCoefficients(order);
  for (let i = 0; i + order < n; i += 1) {
    for (let j = 0; j <= order; j += 1) {
      for (let k = j; k <= order; k += 1) {
        const row = i + j;
        const col = i + k;
        a[row][col - row] += lambda * coeffs[j] * coeffs[k];
      }
    }
  }

  // Symmetric banded LDLᵀ factorisation in-place.
  // L is unit lower-triangular with bandwidth `order`; D is diagonal.
  // a[i][0] stores D_i; a[i][k>0] stores L[i+k][i] * D[i] after factorisation
  // (so we recover L[r][c] = a[c][r - c] / D[c] for r > c, |r - c| <= order).
  for (let i = 0; i < n; i += 1) {
    for (let k = 1; k <= order && i - k >= 0; k += 1) {
      const Lik = a[i - k][k] / a[i - k][0];
      // subtract L[i][i-k] * D[i-k] * L[i+j][i-k] from a[i][j], j=0..order-k
      for (let j = 0; j <= order - k; j += 1) {
        const rowOffset = j; // column = i + j
        const Ljk = a[i - k][k + j] / a[i - k][0]; // L[i+j][i-k]
        a[i][rowOffset] -= Lik * a[i - k][0] * Ljk;
      }
    }
  }

  // Solve L z = y (forward), then D L' x = z (diagonal scale + back-substitute).
  const z = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    let acc = y[i];
    for (let k = 1; k <= order && i - k >= 0; k += 1) {
      const Lik = a[i - k][k] / a[i - k][0];
      acc -= Lik * z[i - k];
    }
    z[i] = acc;
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i -= 1) {
    const D = a[i][0];
    let acc = z[i] / (D || 1);
    for (let k = 1; k <= order && i + k < n; k += 1) {
      const Lki = a[i][k] / D; // L[i+k][i]
      acc -= Lki * x[i + k];
    }
    x[i] = acc;
  }

  const result: Array<number | null> = new Array(n);
  for (let i = 0; i < n; i += 1) {
    result[i] = Number.isFinite(x[i]) ? x[i] : null;
  }
  return result;
}

function differenceCoefficients(order: 1 | 2): number[] {
  // Signed coefficients of Δ^order:
  //   order 1: [-1, 1]
  //   order 2: [ 1, -2, 1]
  if (order === 1) return [-1, 1];
  return [1, -2, 1];
}
