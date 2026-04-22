// ---------------------------------------------------------------------------
// Bayesian linear regression for outcome-linkage analysis
//
// Implements a conjugate Normal-Inverse-Gamma Bayesian linear regression with
// optional county / group fixed-effect dummies (e.g., RUCC tier or county
// FIPS) for spatial stratification. WAIC (Watanabe 2010; Gelman et al. 2014)
// and Akaike-style WAIC weights enable Bayesian model comparison à la
// Carroll et al. 2025 (NC schools PM2.5 → outcome study).
//
// Model
// -----
//   y_i = β'·x_i + ε_i,    ε_i ~ N(0, σ²)
//   β | σ²  ~ N(β₀, σ² · V₀)
//   σ²      ~ InvGamma(a₀, b₀)
//
// Posterior (closed form):
//   V_n = (V₀⁻¹ + X'X)⁻¹
//   β_n = V_n · (V₀⁻¹·β₀ + X'y)
//   a_n = a₀ + n/2
//   b_n = b₀ + ½·(β₀'·V₀⁻¹·β₀ + y'y − β_n'·V_n⁻¹·β_n)
//
// WAIC (Eq. 11 in Gelman et al. 2014):
//   lppd        = Σᵢ log(mean_s p(yᵢ | θ_s))
//   p_waic      = Σᵢ var_s(log p(yᵢ | θ_s))
//   WAIC        = −2 · (lppd − p_waic)
//   weight_m    = exp(−½ ΔWAIC_m) / Σⱼ exp(−½ ΔWAIC_j)
//
// We sample S draws of (β, σ²) from the analytic posterior using a
// deterministic mulberry32 RNG so test results are reproducible.
// ---------------------------------------------------------------------------

export type BayesianLinearObservation = {
  id?: string;
  groupId?: string;       // e.g., county FIPS or RUCC tier
  y: number;
  x: number[];            // covariates (no intercept; will be added)
};

export type BayesianFitOptions = {
  // Posterior samples for WAIC (defaults to 1000).
  posteriorSamples?: number;
  // Add intercept column to design matrix (defaults to true).
  addIntercept?: boolean;
  // If "fixed-effects", add one dummy column per distinct groupId (excluding
  // the first as reference). If "none" (default), groupId is ignored.
  groupColumns?: "fixed-effects" | "none";
  // Mean of Gaussian prior on coefficients. Defaults to all-zeros.
  priorMean?: number[];
  // Diagonal scale of prior covariance: V₀ = priorScale² · I.
  // Defaults to 100 (weakly informative).
  priorScale?: number;
  // Inverse-gamma shape (a₀). Defaults to 0.001.
  invGammaShape?: number;
  // Inverse-gamma rate (b₀). Defaults to 0.001.
  invGammaRate?: number;
  // RNG seed for reproducible posterior draws (defaults to 42).
  seed?: number;
  // Optional names for covariates ("(Intercept)" + group dummies are appended).
  covariateNames?: string[];
  // Optional model label shown in comparison output.
  label?: string;
};

export type BayesianCoefficient = {
  name: string;
  mean: number;
  sd: number;
  p025: number;
  p975: number;
};

export type BayesianFitResult = {
  label?: string;
  n: number;
  k: number;
  covariateNames: string[];
  coefficients: BayesianCoefficient[];
  sigmaMean: number;
  sigma2Mean: number;
  rmse: number;
  rSquared: number | null;
  fitted: number[];
  residuals: number[];
  waic: number;
  lppd: number;
  pWaic: number;
  waicSe: number;
  posteriorSamples: number;
};

export type BayesianModelComparison = {
  label: string;
  n: number;
  k: number;
  waic: number;
  pWaic: number;
  lppd: number;
  waicSe: number;
  deltaWaic: number;
  weight: number;
};

// -- Random number generators ---------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number): number {
  // Box-Muller — returns a single standard-normal draw per call.
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function gammaSample(shape: number, scale: number, rng: () => number): number {
  // Marsaglia-Tsang acceptance-rejection. Handles shape < 1 via boost trick.
  if (shape < 1) {
    const g = gammaSample(shape + 1, scale, rng);
    return g * Math.pow(rng() || 1e-300, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  // Hard cap iterations to avoid pathological infinite loops.
  for (let attempt = 0; attempt < 1024; attempt++) {
    let x = 0;
    let v = 0;
    do {
      x = gaussian(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    const xx = x * x;
    if (u < 1 - 0.0331 * xx * xx) return d * v * scale;
    if (Math.log(u) < 0.5 * xx + d * (1 - v + Math.log(v))) return d * v * scale;
  }
  // Fallback to mean of gamma distribution if rejection failed.
  return shape * scale;
}

function invGammaSample(shape: number, rate: number, rng: () => number): number {
  // σ² ~ InvGamma(a, b)  ↔  1/σ² ~ Gamma(a, scale=1/b)
  const g = gammaSample(shape, 1 / rate, rng);
  if (g <= 0) return rate / Math.max(shape - 1, 1e-9);
  return 1 / g;
}

// -- Linear algebra (small dense matrices) --------------------------------

type Matrix = number[][];

function transpose(A: Matrix): Matrix {
  const r = A.length;
  const c = A[0]?.length ?? 0;
  const out: Matrix = Array.from({ length: c }, () => new Array<number>(r).fill(0));
  for (let i = 0; i < r; i++) {
    for (let j = 0; j < c; j++) out[j][i] = A[i][j];
  }
  return out;
}

function matMul(A: Matrix, B: Matrix): Matrix {
  const r = A.length;
  const inner = B.length;
  const c = B[0].length;
  const out: Matrix = Array.from({ length: r }, () => new Array<number>(c).fill(0));
  for (let i = 0; i < r; i++) {
    const Arow = A[i];
    const outRow = out[i];
    for (let k = 0; k < inner; k++) {
      const aik = Arow[k];
      if (aik === 0) continue;
      const Brow = B[k];
      for (let j = 0; j < c; j++) outRow[j] += aik * Brow[j];
    }
  }
  return out;
}

function matVec(A: Matrix, v: number[]): number[] {
  const r = A.length;
  const c = v.length;
  const out = new Array<number>(r).fill(0);
  for (let i = 0; i < r; i++) {
    const Arow = A[i];
    let s = 0;
    for (let j = 0; j < c; j++) s += Arow[j] * v[j];
    out[i] = s;
  }
  return out;
}

function inverse(A: Matrix): Matrix {
  // Gauss-Jordan with partial pivoting on small dense matrices.
  const n = A.length;
  const aug: number[][] = Array.from({ length: n }, (_, i) => {
    const row = new Array<number>(2 * n).fill(0);
    for (let j = 0; j < n; j++) row[j] = A[i][j];
    row[n + i] = 1;
    return row;
  });
  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let pivotVal = Math.abs(aug[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(aug[r][col]);
      if (v > pivotVal) { pivotRow = r; pivotVal = v; }
    }
    if (pivotVal < 1e-12) {
      throw new Error("Matrix is singular and cannot be inverted.");
    }
    if (pivotRow !== col) {
      const tmp = aug[col];
      aug[col] = aug[pivotRow];
      aug[pivotRow] = tmp;
    }
    const pivot = aug[col][col];
    const pRow = aug[col];
    for (let j = 0; j < 2 * n; j++) pRow[j] /= pivot;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = aug[r][col];
      if (factor === 0) continue;
      const row = aug[r];
      for (let j = 0; j < 2 * n; j++) row[j] -= factor * pRow[j];
    }
  }
  return aug.map((row) => row.slice(n));
}

function cholesky(A: Matrix): Matrix {
  // Lower-triangular Cholesky factor L such that A = L · Lᵀ. Adds tiny jitter
  // on the diagonal if the matrix is mildly indefinite from rounding.
  const n = A.length;
  const L: Matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = A[i][j];
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      if (i === j) {
        L[i][j] = Math.sqrt(Math.max(sum, 1e-12));
      } else {
        L[i][j] = sum / L[j][j];
      }
    }
  }
  return L;
}

// -- Design matrix building -----------------------------------------------

type DesignResult = {
  X: Matrix;
  y: number[];
  names: string[];
  groupOrder: string[];
  dropped: number;
};

function buildDesign(
  observations: BayesianLinearObservation[],
  options: BayesianFitOptions,
): DesignResult {
  const addIntercept = options.addIntercept ?? true;
  const useGroups = options.groupColumns === "fixed-effects";

  const groupOrder: string[] = [];
  if (useGroups) {
    const seen = new Set<string>();
    for (const obs of observations) {
      const g = obs.groupId ?? "";
      if (!g) continue;
      if (!seen.has(g)) {
        seen.add(g);
        groupOrder.push(g);
      }
    }
  }

  const baseCount = observations[0]?.x.length ?? 0;
  const baseNames =
    options.covariateNames && options.covariateNames.length === baseCount
      ? options.covariateNames.slice()
      : Array.from({ length: baseCount }, (_, i) => `x${i + 1}`);

  const names: string[] = [];
  if (addIntercept) names.push("(Intercept)");
  names.push(...baseNames);
  if (useGroups) {
    for (let i = 1; i < groupOrder.length; i++) {
      names.push(`group=${groupOrder[i]}`);
    }
  }

  const X: Matrix = [];
  const y: number[] = [];
  let dropped = 0;
  for (const obs of observations) {
    if (!Number.isFinite(obs.y) || !obs.x.every(Number.isFinite)) {
      dropped += 1;
      continue;
    }
    const row: number[] = [];
    if (addIntercept) row.push(1);
    row.push(...obs.x);
    if (useGroups) {
      const g = obs.groupId ?? "";
      for (let i = 1; i < groupOrder.length; i++) {
        row.push(g === groupOrder[i] ? 1 : 0);
      }
    }
    X.push(row);
    y.push(obs.y);
  }
  return { X, y, names, groupOrder, dropped };
}

// -- Main fit -------------------------------------------------------------

export function fitBayesianLinearModel(
  observations: BayesianLinearObservation[],
  options: BayesianFitOptions = {},
): BayesianFitResult {
  const { X, y, names } = buildDesign(observations, options);
  const n = X.length;
  if (n === 0) {
    throw new Error("fitBayesianLinearModel: no usable observations after filtering.");
  }
  const k = X[0].length;

  const priorMean = options.priorMean ?? new Array<number>(k).fill(0);
  if (priorMean.length !== k) {
    throw new Error(
      `priorMean length (${priorMean.length}) does not match design matrix columns (${k}).`,
    );
  }
  const priorScale = options.priorScale ?? 100;
  const a0 = options.invGammaShape ?? 0.001;
  const b0 = options.invGammaRate ?? 0.001;
  const samples = Math.max(50, Math.floor(options.posteriorSamples ?? 1000));
  const seed = options.seed ?? 42;

  // V₀⁻¹ = (1 / priorScale²) · I  (diagonal precision).
  const v0InvDiag = 1 / (priorScale * priorScale);

  const Xt = transpose(X);
  const XtX = matMul(Xt, X);
  const VnInv: Matrix = Array.from({ length: k }, (_, i) =>
    XtX[i].map((v, j) => v + (i === j ? v0InvDiag : 0)),
  );
  const Vn = inverse(VnInv);
  const Xty = matVec(Xt, y);
  const rhs = Xty.map((v, i) => v + v0InvDiag * priorMean[i]);
  const betaN = matVec(Vn, rhs);

  const aN = a0 + n / 2;
  let yty = 0;
  for (const v of y) yty += v * v;
  let priorQuad = 0;
  for (let i = 0; i < k; i++) priorQuad += v0InvDiag * priorMean[i] * priorMean[i];
  const VnInvBetaN = matVec(VnInv, betaN);
  let postQuad = 0;
  for (let i = 0; i < k; i++) postQuad += betaN[i] * VnInvBetaN[i];
  const bN = Math.max(b0 + 0.5 * (priorQuad + yty - postQuad), 1e-9);

  // -- Posterior sampling --
  const rng = mulberry32(seed);
  const Lvn = cholesky(Vn);
  const betaDraws: number[][] = Array.from({ length: k }, () => new Array<number>(samples).fill(0));
  const sigma2Draws = new Array<number>(samples).fill(0);
  const logLik: number[][] = Array.from({ length: n }, () => new Array<number>(samples).fill(0));

  for (let s = 0; s < samples; s++) {
    const sigma2 = invGammaSample(aN, bN, rng);
    const sigma = Math.sqrt(Math.max(sigma2, 1e-12));
    sigma2Draws[s] = sigma2;
    const z = new Array<number>(k);
    for (let i = 0; i < k; i++) z[i] = gaussian(rng);
    const beta = new Array<number>(k);
    for (let i = 0; i < k; i++) {
      let acc = betaN[i];
      for (let j = 0; j <= i; j++) acc += sigma * Lvn[i][j] * z[j];
      beta[i] = acc;
      betaDraws[i][s] = acc;
    }
    const mu = matVec(X, beta);
    const halfLog = 0.5 * Math.log(2 * Math.PI * Math.max(sigma2, 1e-12));
    for (let i = 0; i < n; i++) {
      const r = y[i] - mu[i];
      logLik[i][s] = -halfLog - (r * r) / (2 * Math.max(sigma2, 1e-12));
    }
  }

  // -- Posterior summaries --
  const coefficients: BayesianCoefficient[] = names.map((name, i) => {
    const draws = betaDraws[i];
    const sorted = draws.slice().sort((a, b) => a - b);
    const m = sorted.reduce((s, v) => s + v, 0) / draws.length;
    let varSum = 0;
    for (const v of draws) varSum += (v - m) * (v - m);
    const sd = draws.length > 1 ? Math.sqrt(varSum / (draws.length - 1)) : 0;
    const lo = sorted[Math.max(0, Math.floor(0.025 * (sorted.length - 1)))];
    const hi = sorted[Math.min(sorted.length - 1, Math.ceil(0.975 * (sorted.length - 1)))];
    return { name, mean: m, sd, p025: lo, p975: hi };
  });

  const sigma2Mean = sigma2Draws.reduce((s, v) => s + v, 0) / sigma2Draws.length;
  const sigmaMean = Math.sqrt(Math.max(sigma2Mean, 0));

  const betaMean = coefficients.map((c) => c.mean);
  const fitted = matVec(X, betaMean);
  const residuals = y.map((v, i) => v - fitted[i]);
  let sse = 0;
  for (const r of residuals) sse += r * r;
  const rmse = Math.sqrt(sse / n);
  const yMean = y.reduce((s, v) => s + v, 0) / n;
  let sst = 0;
  for (const v of y) sst += (v - yMean) * (v - yMean);
  const rSquared = sst > 0 ? 1 - sse / sst : null;

  // -- WAIC --
  let lppd = 0;
  let pWaic = 0;
  const elpdPerObs = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const ll = logLik[i];
    let mx = -Infinity;
    for (let s = 0; s < samples; s++) if (ll[s] > mx) mx = ll[s];
    let sumExp = 0;
    for (let s = 0; s < samples; s++) sumExp += Math.exp(ll[s] - mx);
    const lppdI = mx + Math.log(sumExp / samples);
    let mean = 0;
    for (let s = 0; s < samples; s++) mean += ll[s];
    mean /= samples;
    let v = 0;
    for (let s = 0; s < samples; s++) v += (ll[s] - mean) * (ll[s] - mean);
    const pWaicI = samples > 1 ? v / (samples - 1) : 0;
    lppd += lppdI;
    pWaic += pWaicI;
    elpdPerObs[i] = lppdI - pWaicI;
  }
  const waic = -2 * (lppd - pWaic);
  const elpdMean = elpdPerObs.reduce((s, v) => s + v, 0) / n;
  let elpdVar = 0;
  for (const v of elpdPerObs) elpdVar += (v - elpdMean) * (v - elpdMean);
  elpdVar = n > 1 ? elpdVar / (n - 1) : 0;
  const waicSe = 2 * Math.sqrt(n * elpdVar);

  return {
    label: options.label,
    n,
    k,
    covariateNames: names,
    coefficients,
    sigmaMean,
    sigma2Mean,
    rmse,
    rSquared,
    fitted,
    residuals,
    waic,
    lppd,
    pWaic,
    waicSe,
    posteriorSamples: samples,
  };
}

// -- Model comparison -----------------------------------------------------

export function compareBayesianModels(fits: BayesianFitResult[]): BayesianModelComparison[] {
  if (fits.length === 0) return [];
  const finiteWaics = fits.map((f) => f.waic).filter(Number.isFinite);
  if (finiteWaics.length === 0) {
    return fits.map((f, i) => ({
      label: f.label ?? `model-${i + 1}`,
      n: f.n,
      k: f.k,
      waic: f.waic,
      pWaic: f.pWaic,
      lppd: f.lppd,
      waicSe: f.waicSe,
      deltaWaic: NaN,
      weight: 0,
    }));
  }
  const minWaic = Math.min(...finiteWaics);
  const numers = fits.map((f) => (Number.isFinite(f.waic) ? Math.exp(-0.5 * (f.waic - minWaic)) : 0));
  const denom = numers.reduce((s, v) => s + v, 0);
  return fits
    .map((f, i) => ({
      label: f.label ?? `model-${i + 1}`,
      n: f.n,
      k: f.k,
      waic: f.waic,
      pWaic: f.pWaic,
      lppd: f.lppd,
      waicSe: f.waicSe,
      deltaWaic: f.waic - minWaic,
      weight: denom > 0 ? numers[i] / denom : 0,
    }))
    .sort((a, b) => {
      if (!Number.isFinite(a.deltaWaic) && !Number.isFinite(b.deltaWaic)) return 0;
      if (!Number.isFinite(a.deltaWaic)) return 1;
      if (!Number.isFinite(b.deltaWaic)) return -1;
      return a.deltaWaic - b.deltaWaic;
    });
}
