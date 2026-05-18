// ---------------------------------------------------------------------------
// openairStats — TS ports of the most-used openair (R, GPL-2) analytical
// primitives:
//   - modStats        : FAC2 / MB / MGE / NMB / NMGE / RMSE / r / COE / IOA
//   - taylorStats     : centered RMSE, normalized std-dev, correlation
//   - timeVariation   : diurnal / day-of-week / monthly / hour-of-week panels
//   - calendarData    : daily aggregates positioned on a year heatmap
//   - conditionalQuantile : observed quantiles within predicted-value bins
//   - correlationMatrix   : Pearson r matrix (optionally clustered)
//   - trendLevelData  : 2-D pivot table (e.g. hour × month) for heatmaps
//
// Implementations are re-derived from the published algorithms (Willmott,
// Legates, Carslaw & Ropkins 2012, Eilers 2003, etc.), not copied from the
// R source. Pure functions, no DOM dependency — safe in workers.
// ---------------------------------------------------------------------------

export type Pair = { observed: number; predicted: number };

export type ModStats = {
  n: number;
  FAC2: number;
  MB: number;
  MGE: number;
  NMB: number;
  NMGE: number;
  RMSE: number;
  r: number;
  COE: number;
  IOA: number;
};

const EMPTY_MOD_STATS: ModStats = {
  n: 0,
  FAC2: 0,
  MB: 0,
  MGE: 0,
  NMB: 0,
  NMGE: 0,
  RMSE: 0,
  r: 0,
  COE: 0,
  IOA: 0,
};

export function modStats(pairs: readonly Pair[]): ModStats {
  const usable = pairs.filter(
    (pair) => Number.isFinite(pair.observed) && Number.isFinite(pair.predicted),
  );
  const n = usable.length;
  if (n === 0) return { ...EMPTY_MOD_STATS };

  let sumObs = 0;
  let sumMod = 0;
  for (const pair of usable) {
    sumObs += pair.observed;
    sumMod += pair.predicted;
  }
  const meanObs = sumObs / n;
  const meanMod = sumMod / n;

  let sqErr = 0;
  let absErr = 0;
  let bias = 0;
  let fac2Count = 0;
  let sObs = 0;
  let sMod = 0;
  let sCross = 0;
  let absDevFromMeanObs = 0;

  for (const pair of usable) {
    const err = pair.predicted - pair.observed;
    sqErr += err * err;
    absErr += Math.abs(err);
    bias += err;

    if (pair.observed !== 0) {
      const ratio = pair.predicted / pair.observed;
      if (ratio >= 0.5 && ratio <= 2) fac2Count += 1;
    } else if (pair.predicted === 0) {
      fac2Count += 1;
    }

    const dObs = pair.observed - meanObs;
    const dMod = pair.predicted - meanMod;
    sObs += dObs * dObs;
    sMod += dMod * dMod;
    sCross += dObs * dMod;

    absDevFromMeanObs += Math.abs(pair.observed - meanObs);
  }

  const MB = bias / n;
  const MGE = absErr / n;
  const RMSE = Math.sqrt(sqErr / n);
  const NMB = meanObs !== 0 ? MB / meanObs : 0;
  const NMGE = meanObs !== 0 ? MGE / meanObs : 0;
  const r = sObs > 0 && sMod > 0 ? sCross / Math.sqrt(sObs * sMod) : 0;

  // Coefficient of efficiency (Legates & McCabe 1999, refined Willmott 2012)
  const COE = absDevFromMeanObs > 0 ? 1 - absErr / absDevFromMeanObs : 0;

  // Index of agreement (Willmott 2012, refined formulation)
  // IOA = 1 - sum|P-O| / (c * sum|O-mean(O)|)         when sum|P-O| <= c * D
  //     = c * sum|O-mean(O)| / sum|P-O| - 1            otherwise
  // with c = 2 by Willmott's convention.
  const c = 2;
  const D = absDevFromMeanObs;
  let IOA = 0;
  if (D > 0) {
    IOA = absErr <= c * D ? 1 - absErr / (c * D) : (c * D) / absErr - 1;
  }

  return {
    n,
    FAC2: fac2Count / n,
    MB,
    MGE,
    NMB,
    NMGE,
    RMSE,
    r,
    COE,
    IOA,
  };
}

// ---------------------------------------------------------------------------
// Taylor diagram statistics
// ---------------------------------------------------------------------------

export type TaylorPoint = {
  label: string;
  n: number;
  sdObs: number;
  sdMod: number;
  sdRatio: number;        // sd(model) / sd(obs)
  correlation: number;
  centeredRmse: number;
};

export function taylorStats(
  observed: readonly number[],
  models: ReadonlyArray<{ label: string; predicted: readonly number[] }>,
): TaylorPoint[] {
  const obsClean = observed.filter((value) => Number.isFinite(value));
  const meanObs = mean(obsClean);
  const sdObs = stdev(obsClean, meanObs);
  return models.map((model) => {
    const len = Math.min(observed.length, model.predicted.length);
    const obsAligned: number[] = [];
    const modAligned: number[] = [];
    for (let i = 0; i < len; i += 1) {
      const o = observed[i];
      const p = model.predicted[i];
      if (Number.isFinite(o) && Number.isFinite(p)) {
        obsAligned.push(o);
        modAligned.push(p);
      }
    }
    if (obsAligned.length === 0) {
      return {
        label: model.label,
        n: 0,
        sdObs,
        sdMod: 0,
        sdRatio: 0,
        correlation: 0,
        centeredRmse: 0,
      };
    }
    const mObs = mean(obsAligned);
    const mMod = mean(modAligned);
    const sObs = stdev(obsAligned, mObs);
    const sMod = stdev(modAligned, mMod);
    let cov = 0;
    let centered = 0;
    for (let i = 0; i < obsAligned.length; i += 1) {
      const dObs = obsAligned[i] - mObs;
      const dMod = modAligned[i] - mMod;
      cov += dObs * dMod;
      centered += (dMod - dObs) * (dMod - dObs);
    }
    cov /= obsAligned.length;
    const correlation = sObs > 0 && sMod > 0 ? cov / (sObs * sMod) : 0;
    return {
      label: model.label,
      n: obsAligned.length,
      sdObs: sObs,
      sdMod: sMod,
      sdRatio: sObs > 0 ? sMod / sObs : 0,
      correlation,
      centeredRmse: Math.sqrt(centered / obsAligned.length),
    };
  });
}

// ---------------------------------------------------------------------------
// timeVariation — diurnal / day-of-week / monthly / hour-of-week panels
// ---------------------------------------------------------------------------

export type TimePoint = { timestamp: string; value: number };

export type TimeVariationBin = {
  key: number;
  label: string;
  count: number;
  mean: number;
  median: number;
  p25: number;
  p75: number;
};

export type TimeVariationResult = {
  hour: TimeVariationBin[];                 // 0..23 local
  weekday: TimeVariationBin[];              // 0=Sun .. 6=Sat (Date#getDay)
  month: TimeVariationBin[];                // 1..12
  hourOfWeek: TimeVariationBin[];           // 0..167
};

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function timeVariation(
  points: readonly TimePoint[],
  options: { useUtc?: boolean } = {},
): TimeVariationResult {
  const useUtc = options.useUtc ?? false;
  const hourBins = bucketise(24, (i) => i.toString().padStart(2, "0"));
  const weekdayBins = bucketise(7, (i) => WEEKDAY_LABELS[i]);
  const monthBins = bucketise(12, (i) => MONTH_LABELS[i]);
  const howBins = bucketise(168, (i) => {
    const dow = Math.floor(i / 24);
    const hour = i % 24;
    return `${WEEKDAY_LABELS[dow]} ${hour.toString().padStart(2, "0")}`;
  });

  for (const point of points) {
    if (!Number.isFinite(point.value)) continue;
    const date = new Date(point.timestamp);
    if (Number.isNaN(date.getTime())) continue;
    const hour = useUtc ? date.getUTCHours() : date.getHours();
    const dow = useUtc ? date.getUTCDay() : date.getDay();
    const month = (useUtc ? date.getUTCMonth() : date.getMonth());
    hourBins[hour].values.push(point.value);
    weekdayBins[dow].values.push(point.value);
    monthBins[month].values.push(point.value);
    howBins[dow * 24 + hour].values.push(point.value);
  }

  return {
    hour: hourBins.map(summariseBin),
    weekday: weekdayBins.map(summariseBin),
    month: monthBins.map((bin) => {
      const summary = summariseBin(bin);
      return { ...summary, key: summary.key + 1 };
    }),
    hourOfWeek: howBins.map(summariseBin),
  };
}

// ---------------------------------------------------------------------------
// calendarData — per-day aggregates for a year heatmap
// ---------------------------------------------------------------------------

export type CalendarCell = {
  date: string;     // YYYY-MM-DD
  year: number;
  month: number;    // 1..12
  day: number;      // 1..31
  weekday: number;  // 0..6 (Sun..Sat)
  weekOfMonth: number;
  count: number;
  mean: number;
  max: number;
};

export function calendarData(
  points: readonly TimePoint[],
  options: { useUtc?: boolean } = {},
): CalendarCell[] {
  const useUtc = options.useUtc ?? false;
  const buckets = new Map<string, { date: Date; values: number[] }>();
  for (const point of points) {
    if (!Number.isFinite(point.value)) continue;
    const date = new Date(point.timestamp);
    if (Number.isNaN(date.getTime())) continue;
    const key = useUtc
      ? `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`
      : `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
    const bucket = buckets.get(key) ?? { date, values: [] };
    bucket.values.push(point.value);
    buckets.set(key, bucket);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, bucket]) => {
      const [yearStr, monthStr, dayStr] = key.split("-");
      const year = Number(yearStr);
      const month = Number(monthStr);
      const day = Number(dayStr);
      const ref = new Date(Date.UTC(year, month - 1, day));
      const weekday = ref.getUTCDay();
      const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
      const offset = firstOfMonth.getUTCDay();
      const weekOfMonth = Math.floor((offset + day - 1) / 7);
      return {
        date: key,
        year,
        month,
        day,
        weekday,
        weekOfMonth,
        count: bucket.values.length,
        mean: round(mean(bucket.values), 4),
        max: bucket.values.length ? Math.max(...bucket.values) : 0,
      };
    });
}

// ---------------------------------------------------------------------------
// conditionalQuantile — bin observations by predicted value, return quantiles
// ---------------------------------------------------------------------------

export type ConditionalQuantileBin = {
  predictedCenter: number;
  count: number;
  median: number;
  p25: number;
  p75: number;
  p10: number;
  p90: number;
};

export function conditionalQuantile(
  pairs: readonly Pair[],
  bins = 10,
): ConditionalQuantileBin[] {
  const usable = pairs.filter(
    (pair) => Number.isFinite(pair.observed) && Number.isFinite(pair.predicted),
  );
  if (usable.length === 0 || bins <= 0) return [];
  const predicted = usable.map((pair) => pair.predicted);
  const min = Math.min(...predicted);
  const max = Math.max(...predicted);
  if (min === max) {
    return [{
      predictedCenter: min,
      count: usable.length,
      median: quantile(usable.map((pair) => pair.observed), 0.5),
      p25: quantile(usable.map((pair) => pair.observed), 0.25),
      p75: quantile(usable.map((pair) => pair.observed), 0.75),
      p10: quantile(usable.map((pair) => pair.observed), 0.1),
      p90: quantile(usable.map((pair) => pair.observed), 0.9),
    }];
  }
  const width = (max - min) / bins;
  const buckets: number[][] = Array.from({ length: bins }, () => []);
  for (const pair of usable) {
    const idx = Math.min(bins - 1, Math.floor((pair.predicted - min) / width));
    buckets[idx].push(pair.observed);
  }
  return buckets.map((values, idx) => ({
    predictedCenter: round(min + (idx + 0.5) * width, 4),
    count: values.length,
    median: values.length ? quantile(values, 0.5) : 0,
    p25: values.length ? quantile(values, 0.25) : 0,
    p75: values.length ? quantile(values, 0.75) : 0,
    p10: values.length ? quantile(values, 0.1) : 0,
    p90: values.length ? quantile(values, 0.9) : 0,
  }));
}

// ---------------------------------------------------------------------------
// correlationMatrix — Pearson r matrix with optional single-linkage clustering
// ---------------------------------------------------------------------------

export type CorrelationMatrix = {
  variables: string[];
  matrix: number[][];
  order: number[]; // permutation index into variables
};

export function correlationMatrix(
  series: ReadonlyArray<{ label: string; values: readonly number[] }>,
  options: { cluster?: boolean } = {},
): CorrelationMatrix {
  const labels = series.map((s) => s.label);
  const len = series.reduce((acc, s) => Math.min(acc, s.values.length), Number.POSITIVE_INFINITY);
  const trimmed = series.map((s) => s.values.slice(0, len === Number.POSITIVE_INFINITY ? 0 : len));
  const m = labels.length;
  const matrix: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(0));
  for (let i = 0; i < m; i += 1) {
    matrix[i][i] = 1;
    for (let j = i + 1; j < m; j += 1) {
      const r = pearsonR(trimmed[i], trimmed[j]);
      matrix[i][j] = r;
      matrix[j][i] = r;
    }
  }
  const order = options.cluster ? singleLinkageOrder(matrix) : labels.map((_, i) => i);
  return { variables: labels, matrix, order };
}

// ---------------------------------------------------------------------------
// trendLevelData — 2-D pivot table for level (heatmap) plots
// ---------------------------------------------------------------------------

export type TrendLevelAxis = "hour" | "weekday" | "month" | "year";
export type TrendLevelCell = {
  xKey: number;
  yKey: number;
  count: number;
  value: number; // aggregated statistic
};

export function trendLevelData(
  points: readonly TimePoint[],
  x: TrendLevelAxis,
  y: TrendLevelAxis,
  options: { statistic?: "mean" | "median" | "max"; useUtc?: boolean } = {},
): TrendLevelCell[] {
  const statistic = options.statistic ?? "mean";
  const useUtc = options.useUtc ?? false;
  const buckets = new Map<string, { xKey: number; yKey: number; values: number[] }>();
  for (const point of points) {
    if (!Number.isFinite(point.value)) continue;
    const date = new Date(point.timestamp);
    if (Number.isNaN(date.getTime())) continue;
    const xKey = extractAxis(date, x, useUtc);
    const yKey = extractAxis(date, y, useUtc);
    const key = `${xKey}:${yKey}`;
    const bucket = buckets.get(key) ?? { xKey, yKey, values: [] };
    bucket.values.push(point.value);
    buckets.set(key, bucket);
  }
  return [...buckets.values()].map((bucket) => ({
    xKey: bucket.xKey,
    yKey: bucket.yKey,
    count: bucket.values.length,
    value: round(
      statistic === "mean"
        ? mean(bucket.values)
        : statistic === "median"
          ? quantile(bucket.values, 0.5)
          : Math.max(...bucket.values),
      4,
    ),
  }));
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function bucketise(n: number, labeller: (i: number) => string) {
  return Array.from({ length: n }, (_, i) => ({
    key: i,
    label: labeller(i),
    values: [] as number[],
  }));
}

function summariseBin(bin: { key: number; label: string; values: number[] }): TimeVariationBin {
  const values = bin.values;
  return {
    key: bin.key,
    label: bin.label,
    count: values.length,
    mean: values.length ? round(mean(values), 4) : 0,
    median: values.length ? round(quantile(values, 0.5), 4) : 0,
    p25: values.length ? round(quantile(values, 0.25), 4) : 0,
    p75: values.length ? round(quantile(values, 0.75), 4) : 0,
  };
}

function extractAxis(date: Date, axis: TrendLevelAxis, useUtc: boolean): number {
  switch (axis) {
    case "hour":
      return useUtc ? date.getUTCHours() : date.getHours();
    case "weekday":
      return useUtc ? date.getUTCDay() : date.getDay();
    case "month":
      return (useUtc ? date.getUTCMonth() : date.getMonth()) + 1;
    case "year":
      return useUtc ? date.getUTCFullYear() : date.getFullYear();
  }
}

function pearsonR(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let sa = 0;
  let sb = 0;
  let count = 0;
  for (let i = 0; i < n; i += 1) {
    if (Number.isFinite(a[i]) && Number.isFinite(b[i])) {
      sa += a[i];
      sb += b[i];
      count += 1;
    }
  }
  if (count === 0) return 0;
  const ma = sa / count;
  const mb = sb / count;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i += 1) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) continue;
    const xa = a[i] - ma;
    const xb = b[i] - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

// Approximate single-linkage ordering: greedy nearest-neighbour traversal
// of the |1 - r| dissimilarity matrix, starting from variable 0.
function singleLinkageOrder(matrix: readonly number[][]): number[] {
  const n = matrix.length;
  if (n <= 1) return matrix.map((_, i) => i);
  const visited = new Set<number>([0]);
  const order: number[] = [0];
  while (order.length < n) {
    let bestNext = -1;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let j = 0; j < n; j += 1) {
      if (visited.has(j)) continue;
      for (const i of visited) {
        const dist = 1 - matrix[i][j];
        if (dist < bestDist) {
          bestDist = dist;
          bestNext = j;
        }
      }
    }
    if (bestNext < 0) break;
    visited.add(bestNext);
    order.push(bestNext);
  }
  return order;
}

function mean(values: readonly number[]): number {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function stdev(values: readonly number[], avg: number): number {
  if (values.length === 0) return 0;
  let s = 0;
  for (const value of values) s += (value - avg) * (value - avg);
  return Math.sqrt(s / values.length);
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

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function round(value: number, digits = 3): number {
  if (!Number.isFinite(value)) return value;
  return Number(value.toFixed(digits));
}
