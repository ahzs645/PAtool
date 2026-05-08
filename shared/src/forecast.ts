/**
 * Lightweight forecast baselines for PM2.5 sensor series.
 *
 * The full PAtool forecast story (graph attention + transformer; see
 * AirPhyNet 2024 https://arxiv.org/html/2402.03784v2 and KriGNN 2025
 * https://ieeexplore.ieee.org/document/11415914/) requires either a
 * cloud-served ONNX model or a worker bundling a lightweight
 * Gaussian-process surrogate. Until that lands, this module ships
 * transparent baselines so the forecast page has something honest to
 * show:
 *
 * - **Persistence**: tomorrow's hourly PM2.5 = the matching hour from
 *   yesterday. Surprisingly hard to beat at short horizons.
 * - **Hour-of-day climatology**: the mean/median across the last `n` days
 *   for each hour. Captures diurnal cycle when the persistence is
 *   noisy.
 * - **Exponential smoothing**: simple Holt-Winters-style level + season
 *   recurrence; useful when there's a clear trend.
 *
 * Each baseline returns a sequence of hourly forecasts paired with a
 * 1.96·σ prediction interval whose σ comes from in-sample residuals.
 * For ML-backed forecasts, plug an ONNX session into the same return
 * shape and the existing UI keeps working unchanged.
 */

export type ForecastSamplePoint = {
  /** ISO 8601 timestamp of the historical observation. */
  timestamp: string;
  /** Observed PM2.5 in µg/m³. */
  pm25: number;
};

export type ForecastPoint = {
  timestamp: string;
  pm25: number;
  /** 1.96·σ half-width (~95% PI). */
  pi95Half: number;
  source: "persistence" | "diurnal-climatology" | "exponential-smoothing" | "model";
};

export type ForecastInput = {
  history: ReadonlyArray<ForecastSamplePoint>;
  horizonHours: number;
};

const HOUR_MS = 3600 * 1000;

function toHour(timestamp: string): number {
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.getUTCHours() : 0;
}

function residualStd(values: ReadonlyArray<number>, predictions: ReadonlyArray<number>): number {
  let sumSq = 0;
  let n = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    const p = predictions[i];
    if (!Number.isFinite(v) || !Number.isFinite(p)) continue;
    const r = v - p;
    sumSq += r * r;
    n += 1;
  }
  return n > 1 ? Math.sqrt(sumSq / (n - 1)) : 0;
}

/**
 * Predict the next `horizonHours` hours using same-hour-yesterday
 * persistence. Returns one row per future hour starting one hour after
 * the last observation.
 */
export function persistenceForecast(input: ForecastInput): ForecastPoint[] {
  const { history, horizonHours } = input;
  if (history.length === 0 || horizonHours <= 0) return [];

  const lastTs = new Date(history[history.length - 1].timestamp).getTime();
  const usable = history.filter((point) => Number.isFinite(point.pm25));

  // In-sample residuals: predict each point as the same hour 24h earlier.
  const observed: number[] = [];
  const predicted: number[] = [];
  const byTimestamp = new Map(usable.map((point) => [point.timestamp, point.pm25]));
  for (const point of usable) {
    const t = new Date(point.timestamp).getTime() - 24 * HOUR_MS;
    const sourceTimestamp = new Date(t).toISOString();
    if (byTimestamp.has(sourceTimestamp)) {
      observed.push(point.pm25);
      predicted.push(byTimestamp.get(sourceTimestamp)!);
    }
  }
  const sigma = residualStd(observed, predicted);
  const halfWidth = 1.96 * sigma;

  const result: ForecastPoint[] = [];
  for (let i = 1; i <= horizonHours; i += 1) {
    const futureTs = lastTs + i * HOUR_MS;
    const sourceTs = futureTs - 24 * HOUR_MS;
    const value = byTimestamp.get(new Date(sourceTs).toISOString())
      ?? usable[usable.length - 1].pm25;
    result.push({
      timestamp: new Date(futureTs).toISOString(),
      pm25: Math.max(0, value),
      pi95Half: halfWidth,
      source: "persistence",
    });
  }
  return result;
}

/**
 * Predict the next `horizonHours` hours using the average value at each
 * hour-of-day across the entire history.
 */
export function diurnalClimatologyForecast(input: ForecastInput): ForecastPoint[] {
  const { history, horizonHours } = input;
  if (history.length === 0 || horizonHours <= 0) return [];

  const sums = new Array<number>(24).fill(0);
  const counts = new Array<number>(24).fill(0);
  for (const point of history) {
    if (!Number.isFinite(point.pm25)) continue;
    const hour = toHour(point.timestamp);
    sums[hour] += point.pm25;
    counts[hour] += 1;
  }
  const climatology = sums.map((sum, i) => (counts[i] > 0 ? sum / counts[i] : 0));

  const observed: number[] = [];
  const predicted: number[] = [];
  for (const point of history) {
    if (!Number.isFinite(point.pm25)) continue;
    observed.push(point.pm25);
    predicted.push(climatology[toHour(point.timestamp)]);
  }
  const sigma = residualStd(observed, predicted);
  const halfWidth = 1.96 * sigma;

  const lastTs = new Date(history[history.length - 1].timestamp).getTime();
  const result: ForecastPoint[] = [];
  for (let i = 1; i <= horizonHours; i += 1) {
    const futureTs = lastTs + i * HOUR_MS;
    const hour = new Date(futureTs).getUTCHours();
    result.push({
      timestamp: new Date(futureTs).toISOString(),
      pm25: Math.max(0, climatology[hour]),
      pi95Half: halfWidth,
      source: "diurnal-climatology",
    });
  }
  return result;
}

/**
 * Predict using simple seasonal exponential smoothing (level + 24-hour
 * season). Beats persistence when the level is shifting and the season is
 * stable. Falls back to persistence when history is shorter than 24 h.
 */
export function exponentialSmoothingForecast(
  input: ForecastInput,
  options: { levelAlpha?: number; seasonGamma?: number } = {},
): ForecastPoint[] {
  const { history, horizonHours } = input;
  if (history.length < 48 || horizonHours <= 0) return persistenceForecast(input);

  const alpha = options.levelAlpha ?? 0.2;
  const gamma = options.seasonGamma ?? 0.1;
  const period = 24;

  const usable = history.filter((point) => Number.isFinite(point.pm25));
  let level = usable.slice(0, period).reduce((sum, point) => sum + point.pm25, 0) / period;
  const season = new Array<number>(period).fill(0);
  for (let i = 0; i < period; i += 1) {
    season[i] = usable[i].pm25 - level;
  }

  const inSamplePredictions: number[] = [];
  for (let i = period; i < usable.length; i += 1) {
    const seasonal = season[i % period];
    const prediction = level + seasonal;
    inSamplePredictions.push(prediction);
    const value = usable[i].pm25;
    const newLevel = alpha * (value - seasonal) + (1 - alpha) * level;
    season[i % period] = gamma * (value - newLevel) + (1 - gamma) * seasonal;
    level = newLevel;
  }
  const sigma = residualStd(usable.slice(period).map((point) => point.pm25), inSamplePredictions);
  const halfWidth = 1.96 * sigma;

  const lastTs = new Date(usable[usable.length - 1].timestamp).getTime();
  const result: ForecastPoint[] = [];
  for (let i = 1; i <= horizonHours; i += 1) {
    const futureTs = lastTs + i * HOUR_MS;
    const seasonal = season[(usable.length + i - 1) % period];
    result.push({
      timestamp: new Date(futureTs).toISOString(),
      pm25: Math.max(0, level + seasonal),
      pi95Half: halfWidth,
      source: "exponential-smoothing",
    });
  }
  return result;
}

export const FORECAST_METHOD_NOTES = {
  "ml-stgnn": {
    title: "Spatio-temporal graph neural network (planned)",
    summary:
      "AirPhyNet/KriGNN-style GNN over the sensor graph with a transformer temporal head. Inference runs in a Cloudflare Worker (or local dev server) with ONNX Runtime Web; weights live in object storage and are warm-cached per region. The frontend signs a request with the chosen sensor IDs and target horizon and renders the same `ForecastPoint[]` shape returned by the baselines below — no UI rewrite required when this lands.",
  },
  persistence: {
    title: "Same-hour persistence",
    summary: "Tomorrow's hourly PM2.5 = the matching hour from yesterday.",
  },
  "diurnal-climatology": {
    title: "Hour-of-day climatology",
    summary: "Average value seen at each hour of day across the supplied history.",
  },
  "exponential-smoothing": {
    title: "Holt-Winters seasonal smoothing",
    summary: "Level + 24-hour season exponentially smoothed; falls back to persistence if history is too short.",
  },
} as const;
