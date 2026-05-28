/**
 * rmweather-style extensions for PAtool's weather-normalisation pipeline:
 *
 *   - `meteorologicalYearDecomposition`: counterfactual analysis answering
 *     "what would the trend look like if every year had reference-year
 *     meteorology?". Mirrors `rmw_predict_nested_sets_by_year`.
 *
 *   - `strucchangeBreakpoints`: binary-segmentation-style change-point
 *     detection on a residual series, mirroring `rmw_find_breakpoints`.
 *     Replaces PAtool's sliding-window scoring with a recursive
 *     least-squares split.
 *
 *   - `partialDependenceTrainingOnly`: helper that re-samples the grid
 *     for partial-dependence within the training-data envelope so the
 *     resulting curves don't extrapolate.
 */

import londonFixture from "./generated/rmweather_london_fixture.json";

export type DatedObservation = {
  timestamp: string;
  observed: number;
  /** Optional meteorological covariates indexed by name. */
  meteorology?: Record<string, number>;
};

export type MeteorologicalYearOptions = {
  referenceYear: number;
  predict: (covariates: Record<string, number>) => number;
};

export type MeteorologicalYearPoint = {
  timestamp: string;
  observed: number;
  counterfactual: number;
  reference: number;
  delta: number;
};

/**
 * For each observation in `series`, look up the meteorology that the
 * reference year contributed at the same calendar timestamp (matching
 * month-day-hour) and produce a counterfactual prediction.
 */
export function meteorologicalYearDecomposition(
  series: ReadonlyArray<DatedObservation>,
  options: MeteorologicalYearOptions,
): MeteorologicalYearPoint[] {
  const referenceMap = new Map<string, Record<string, number>>();
  for (const row of series) {
    const t = new Date(row.timestamp);
    if (t.getUTCFullYear() !== options.referenceYear) continue;
    referenceMap.set(calendarKey(t), row.meteorology ?? {});
  }
  return series.map((row) => {
    const t = new Date(row.timestamp);
    const refMet = referenceMap.get(calendarKey(t));
    const counterfactual = refMet ? options.predict(refMet) : row.observed;
    const reference = row.meteorology ? options.predict(row.meteorology) : row.observed;
    return {
      timestamp: row.timestamp,
      observed: row.observed,
      counterfactual,
      reference,
      delta: row.observed - counterfactual,
    };
  });
}

function calendarKey(t: Date): string {
  return `${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}T${String(t.getUTCHours()).padStart(2, "0")}`;
}

export type Breakpoint = {
  index: number;
  timestamp?: string;
  splitMean: { left: number; right: number };
  improvement: number;
};

export type StrucchangeOptions = {
  maxBreakpoints?: number;
  minSegmentSize?: number;
  improvementThreshold?: number;
  timestamps?: ReadonlyArray<string>;
};

/**
 * Binary-segmentation breakpoint detection: recursively splits the
 * residual series at the index that maximises the reduction in
 * within-segment sum-of-squares, subject to a minimum segment size and
 * a per-split improvement threshold.
 */
export function strucchangeBreakpoints(
  values: ReadonlyArray<number>,
  options: StrucchangeOptions = {},
): Breakpoint[] {
  const maxK = Math.max(1, options.maxBreakpoints ?? 5);
  const minSeg = Math.max(5, options.minSegmentSize ?? Math.max(10, Math.floor(values.length / 20)));
  const threshold = options.improvementThreshold ?? 0;
  const found: Breakpoint[] = [];
  const stack: Array<{ start: number; end: number }> = [{ start: 0, end: values.length }];
  while (stack.length > 0 && found.length < maxK) {
    const { start, end } = stack.pop()!;
    if (end - start < minSeg * 2) continue;
    const baseRss = rss(values, start, end);
    let bestIdx = -1;
    let bestRss = baseRss;
    for (let i = start + minSeg; i <= end - minSeg; i += 1) {
      const r = rss(values, start, i) + rss(values, i, end);
      if (r < bestRss) {
        bestRss = r;
        bestIdx = i;
      }
    }
    const improvement = baseRss - bestRss;
    if (bestIdx === -1 || improvement <= threshold) continue;
    const leftMean = mean(values, start, bestIdx);
    const rightMean = mean(values, bestIdx, end);
    found.push({
      index: bestIdx,
      timestamp: options.timestamps?.[bestIdx],
      splitMean: { left: leftMean, right: rightMean },
      improvement,
    });
    stack.push({ start, end: bestIdx });
    stack.push({ start: bestIdx, end });
  }
  return found.sort((a, b) => a.index - b.index);
}

function mean(values: ReadonlyArray<number>, start: number, end: number): number {
  let sum = 0;
  for (let i = start; i < end; i += 1) sum += values[i];
  return (end - start) === 0 ? 0 : sum / (end - start);
}

function rss(values: ReadonlyArray<number>, start: number, end: number): number {
  const m = mean(values, start, end);
  let s = 0;
  for (let i = start; i < end; i += 1) s += (values[i] - m) ** 2;
  return s;
}

export type PartialDependenceQuery = {
  variable: string;
  /** Training-set values for the variable (used to bound the grid). */
  trainingValues: ReadonlyArray<number>;
  /** Optional explicit grid; otherwise derived from quantiles. */
  grid?: ReadonlyArray<number>;
  /** Predict y given a fixed value of `variable`. */
  predict: (value: number) => number;
};

export type PartialDependencePoint = {
  variable: string;
  value: number;
  partialDependency: number;
  insideTrainingRange: boolean;
};

/**
 * Compute partial dependence restricted to the training-data envelope.
 * Grid points outside [min(trainingValues), max(trainingValues)] are
 * dropped, preventing extrapolation that openair/rmweather warn about.
 */
export function partialDependenceTrainingOnly(query: PartialDependenceQuery): PartialDependencePoint[] {
  const training = query.trainingValues.filter(Number.isFinite);
  if (training.length === 0) return [];
  const min = Math.min(...training);
  const max = Math.max(...training);
  const grid = query.grid ?? defaultQuantileGrid(training);
  return grid
    .filter((v) => v >= min && v <= max)
    .map((value) => ({
      variable: query.variable,
      value,
      partialDependency: query.predict(value),
      insideTrainingRange: true,
    }));
}

function defaultQuantileGrid(values: ReadonlyArray<number>): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  return Array.from({ length: 20 }, (_, i) => sorted[Math.min(n - 1, Math.floor((i / 19) * (n - 1)))]);
}

export type LondonFixtureRow = {
  date: string;
  no2: number;
  pm10: number;
  ws: number;
  wd: number;
  air_temp: number;
  rh: number;
};

export function loadLondonFixture(): LondonFixtureRow[] {
  return (londonFixture as { rows: LondonFixtureRow[] }).rows.map((row) => ({ ...row }));
}
