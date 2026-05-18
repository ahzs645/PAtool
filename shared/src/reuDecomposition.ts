// ---------------------------------------------------------------------------
// reuDecomposition — Relative Expanded Uncertainty (REU) decomposition into
// random / reference-uncertainty / systematic-bias components, plus a proper
// Gaussian KDE for scatter density (a replacement for the simple 2-D
// histogram in `measurementError.densityPoints`).
//
// The decomposition follows EPA's "Performance Targets" methodology and the
// quant-air-pollution package's reu_components(). For each paired
// observation we attribute:
//   - random      : residual variance from the OLS fit
//   - reference   : the supplied reference-instrument variance
//   - systematic  : deviation of the regression line from the 1:1 line
// REU = k * sqrt(random + reference + systematic) / |sensor|
// ---------------------------------------------------------------------------

import { linearFit, type MeasurementPair } from "./measurementError";

export type ReuComponentPoint = {
  reference: number;
  sensor: number;
  random: number;       // variance component
  systematic: number;   // variance component
  referenceVar: number; // variance component
  reu: number;          // % expanded uncertainty (k=2 by default)
};

export type ReuDecompositionResult = {
  n: number;
  slope: number;
  intercept: number;
  residualVariance: number;
  k: number;
  referenceUncertainty: number;
  meanReu: number;
  dqoThresholdPercent?: number;
  pointsBelowDqo: number;
  points: ReuComponentPoint[];
};

export type ReuDecompositionOptions = {
  k?: number;
  referenceUncertainty?: number;
  dqoThresholdPercent?: number;
};

export function decomposeReu(
  pairs: readonly MeasurementPair[],
  options: ReuDecompositionOptions = {},
): ReuDecompositionResult {
  const k = options.k ?? 2;
  const referenceUncertainty = options.referenceUncertainty ?? 0;
  const dqoThresholdPercent = options.dqoThresholdPercent;
  const usable = pairs.filter(
    (pair) => Number.isFinite(pair.reference) && Number.isFinite(pair.sensor),
  );
  if (usable.length < 3) {
    return {
      n: usable.length,
      slope: 0,
      intercept: 0,
      residualVariance: 0,
      k,
      referenceUncertainty,
      meanReu: 0,
      dqoThresholdPercent,
      pointsBelowDqo: 0,
      points: [],
    };
  }
  const fit = linearFit(usable);
  let rss = 0;
  for (const pair of usable) {
    const yhat = fit.intercept + fit.slope * pair.reference;
    rss += (pair.sensor - yhat) ** 2;
  }
  const residualVariance = usable.length > 2 ? rss / (usable.length - 2) : 0;
  const refVar = referenceUncertainty * referenceUncertainty;

  const points: ReuComponentPoint[] = usable.map((pair) => {
    const deviation = fit.intercept + (fit.slope - 1) * pair.reference;
    const systematic = deviation * deviation;
    const totalVariance = Math.max(0, residualVariance - refVar + systematic);
    return {
      reference: pair.reference,
      sensor: pair.sensor,
      random: Math.max(0, residualVariance - refVar),
      systematic,
      referenceVar: refVar,
      reu: pair.sensor === 0 ? Number.NaN : (k * Math.sqrt(totalVariance) * 100) / Math.abs(pair.sensor),
    };
  });
  const finitePoints = points.filter((point) => Number.isFinite(point.reu));
  const meanReu = finitePoints.length
    ? finitePoints.reduce((sum, point) => sum + point.reu, 0) / finitePoints.length
    : 0;
  const pointsBelowDqo = dqoThresholdPercent !== undefined
    ? finitePoints.filter((point) => point.reu <= dqoThresholdPercent).length
    : 0;
  return {
    n: usable.length,
    slope: fit.slope,
    intercept: fit.intercept,
    residualVariance,
    k,
    referenceUncertainty,
    meanReu,
    dqoThresholdPercent,
    pointsBelowDqo,
    points,
  };
}

// ---------------------------------------------------------------------------
// Gaussian KDE for scatter density. Returns one density estimate per input
// point using Silverman's rule-of-thumb bandwidth per axis. O(n²); for
// large inputs callers should subsample first.
// ---------------------------------------------------------------------------

export type ScatterDensityPoint = {
  x: number;
  y: number;
  density: number;
};

export function gaussianKdeDensity(
  points: ReadonlyArray<{ x: number; y: number }>,
): ScatterDensityPoint[] {
  const usable = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (usable.length === 0) return [];
  const n = usable.length;
  const meanX = usable.reduce((sum, point) => sum + point.x, 0) / n;
  const meanY = usable.reduce((sum, point) => sum + point.y, 0) / n;
  let varX = 0;
  let varY = 0;
  for (const point of usable) {
    varX += (point.x - meanX) ** 2;
    varY += (point.y - meanY) ** 2;
  }
  varX /= Math.max(1, n - 1);
  varY /= Math.max(1, n - 1);
  const sigmaX = Math.sqrt(varX) || 1;
  const sigmaY = Math.sqrt(varY) || 1;
  // Silverman's rule-of-thumb (multivariate, d=2): h = sigma * n^(-1/(d+4))
  const factor = Math.pow(n, -1 / 6);
  const hX = sigmaX * factor || 1e-6;
  const hY = sigmaY * factor || 1e-6;
  const norm = 1 / (2 * Math.PI * hX * hY * n);
  return usable.map((point) => {
    let density = 0;
    for (const other of usable) {
      const dx = (point.x - other.x) / hX;
      const dy = (point.y - other.y) / hY;
      density += Math.exp(-0.5 * (dx * dx + dy * dy));
    }
    return { x: point.x, y: point.y, density: density * norm };
  });
}
