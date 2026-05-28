/**
 * Quant-air-pollution-style REU decomposition + DQO overlays + Gaussian
 * KDE for scatter colouring. Each piece supplements PAtool's existing
 * `measurementError.ts`.
 *
 * REU formula (Crilley 2020; quantr/quantpy):
 *   REU = k * sqrt(σ_v² − u_ref² + ec) * 100 / sensor_value
 *
 *   - σ_v²  = residual variance from regression  (random component)
 *   - u_ref² = reference instrument uncertainty   (reference component)
 *   - ec    = (intercept + (slope − 1) · ref)²    (systematic / bias component)
 *
 * This module exposes the three components separately so they can be
 * shown as stacked bars or as percent-of-budget pie slices in the UI.
 */

import { linearFit, type MeasurementPair } from "./measurementError";
import benchmarksFixture from "./generated/quant_air_pollution_benchmarks.json";

export type ReuDecompositionPoint = {
  reference: number;
  sensor: number;
  randomComponent: number;
  referenceComponent: number;
  biasComponent: number;
  reuPercent: number;
};

export type ReuDecompositionOptions = {
  k?: number;
  referenceUncertainty?: number;
  /** EPA/EU DQO line (e.g. 25% for PM2.5 indicative). */
  dqoPercent?: number;
};

export type ReuDecompositionResult = {
  n: number;
  fit: ReturnType<typeof linearFit>;
  residualVariance: number;
  dqoPercent: number;
  points: ReuDecompositionPoint[];
  shareAboveDqo: number;
};

export function reuWithDecomposition(
  pairs: ReadonlyArray<MeasurementPair>,
  options: ReuDecompositionOptions = {},
): ReuDecompositionResult {
  const usable = pairs.filter((p) => Number.isFinite(p.reference) && Number.isFinite(p.sensor));
  if (usable.length === 0) {
    return {
      n: 0,
      fit: linearFit([]),
      residualVariance: 0,
      dqoPercent: options.dqoPercent ?? 25,
      points: [],
      shareAboveDqo: 0,
    };
  }
  const fit = linearFit(usable as MeasurementPair[]);
  const k = options.k ?? 2;
  const uRef = options.referenceUncertainty ?? 0;
  const dqo = options.dqoPercent ?? 25;
  const rss = usable.reduce((sum, p) => {
    const residual = p.sensor - fit.intercept - fit.slope * p.reference;
    return sum + residual * residual;
  }, 0);
  const residualVariance = usable.length > 2 ? rss / (usable.length - 2) : 0;

  const points: ReuDecompositionPoint[] = [];
  let above = 0;
  for (const pair of usable) {
    const sensor = pair.sensor;
    const ec = (fit.intercept + (fit.slope - 1) * pair.reference) ** 2;
    const rawVar = Math.max(0, residualVariance - uRef * uRef + ec);
    const reu = sensor === 0 ? 0 : (k * Math.sqrt(rawVar) * 100) / Math.abs(sensor);
    const denom = sensor === 0 ? 1 : Math.abs(sensor);
    const randomComponent = (k * Math.sqrt(residualVariance) * 100) / denom;
    const referenceComponent = (k * Math.sqrt(uRef * uRef) * 100) / denom;
    const biasComponent = (k * Math.sqrt(ec) * 100) / denom;
    if (reu > dqo) above += 1;
    points.push({
      reference: pair.reference,
      sensor,
      randomComponent,
      referenceComponent,
      biasComponent,
      reuPercent: reu,
    });
  }
  return {
    n: usable.length,
    fit,
    residualVariance,
    dqoPercent: dqo,
    points,
    shareAboveDqo: usable.length === 0 ? 0 : above / usable.length,
  };
}

export type GaussianKdeOptions = {
  bandwidth?: number;
  grid?: number;
};

export type GaussianKdePoint = {
  x: number;
  y: number;
  density: number;
};

/**
 * 2D Gaussian KDE with Scott's-rule default bandwidth. Returns densities
 * at each data point (not on a grid) — what scatter colouring needs.
 */
export function gaussianKde2d(
  points: ReadonlyArray<{ x: number; y: number }>,
  options: GaussianKdeOptions = {},
): GaussianKdePoint[] {
  const usable = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const n = usable.length;
  if (n === 0) return [];
  const meanX = usable.reduce((s, p) => s + p.x, 0) / n;
  const meanY = usable.reduce((s, p) => s + p.y, 0) / n;
  const sdX = Math.sqrt(usable.reduce((s, p) => s + (p.x - meanX) ** 2, 0) / n) || 1;
  const sdY = Math.sqrt(usable.reduce((s, p) => s + (p.y - meanY) ** 2, 0) / n) || 1;
  const bandwidth = options.bandwidth ?? Math.pow(n, -1 / 6); // Scott
  const hx = bandwidth * sdX;
  const hy = bandwidth * sdY;
  return usable.map((q) => {
    let sum = 0;
    for (const p of usable) {
      const dx = (q.x - p.x) / hx;
      const dy = (q.y - p.y) / hy;
      sum += Math.exp(-0.5 * (dx * dx + dy * dy));
    }
    return {
      x: q.x,
      y: q.y,
      density: sum / (n * 2 * Math.PI * hx * hy),
    };
  });
}

export type QuantBenchmarkDataset = {
  id: string;
  label: string;
  pollutant: string;
  units: string;
  rows: Array<{ reference: number; sensor: number }>;
};

export function loadQuantBenchmarkDatasets(): QuantBenchmarkDataset[] {
  return (benchmarksFixture as { datasets: QuantBenchmarkDataset[] }).datasets.map((d) => ({
    ...d,
    rows: d.rows.map((r) => ({ ...r })),
  }));
}
