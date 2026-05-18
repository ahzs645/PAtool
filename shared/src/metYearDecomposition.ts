// ---------------------------------------------------------------------------
// metYearDecomposition — TS analogue of rmweather's
// `rmw_predict_nested_sets_by_year`: for a fitted air-quality model, predict
// every observation as though every year had the *same* meteorology, then
// average the predictions across the resampled-meteorology pool. The result
// quantifies the "meteorology-normalised" trend (e.g. "what would the 2025
// concentration have been if it had had 2020 weather?").
//
// The actual prediction engine is injected — this module is agnostic to
// whether the underlying model is a random forest, GAM, or anything else.
// It supplies the scaffolding: per-year splits, sampling without
// replacement, optional `trainingOnly` guard against meteorology
// extrapolation, and aggregation.
// ---------------------------------------------------------------------------

export type MetRecord = {
  timestamp: string;
  value: number;
  /** Free-form feature bag; the predictor reads what it needs. */
  features: Record<string, number>;
};

export type ModelPredictor = (rows: readonly MetRecord[]) => number[];

export type MetYearDecompositionOptions = {
  /** Number of bootstrap iterations. Default 100. */
  iterations?: number;
  /** Years to use as the "swap" pool. Default: all years present in records. */
  swapYears?: readonly number[];
  /** If true, only swap meteorology rows from years already in the model's
   *  training set (guards against predicting on out-of-range conditions). */
  trainingOnly?: boolean;
  /** Set of years considered in-sample for training. Required when trainingOnly. */
  trainingYears?: readonly number[];
  /** Random seed for reproducibility. */
  seed?: number;
};

export type MetYearDecompositionResult = {
  perYearMean: Map<number, number>;       // year → mean meteorology-normalised concentration
  perYearObservedMean: Map<number, number>;
  perYearPredictedMean: Map<number, number>;
  iterations: number;
  swapYears: number[];
};

export function decomposeMetYears(
  records: readonly MetRecord[],
  predict: ModelPredictor,
  options: MetYearDecompositionOptions = {},
): MetYearDecompositionResult {
  const iterations = options.iterations ?? 100;
  const records_ = records.filter((row) => Number.isFinite(row.value));
  const yearsInRecord = new Set<number>();
  for (const row of records_) {
    const year = new Date(row.timestamp).getUTCFullYear();
    if (!Number.isNaN(year)) yearsInRecord.add(year);
  }
  let swapYears = options.swapYears ? [...options.swapYears] : [...yearsInRecord].sort((a, b) => a - b);
  if (options.trainingOnly) {
    const trainingYears = new Set(options.trainingYears ?? swapYears);
    swapYears = swapYears.filter((year) => trainingYears.has(year));
  }
  if (swapYears.length === 0) {
    return {
      perYearMean: new Map(),
      perYearObservedMean: new Map(),
      perYearPredictedMean: new Map(),
      iterations,
      swapYears: [],
    };
  }

  // Bucket records by year so we can resample meteorology features from a
  // chosen swap-year while preserving the target year's emission pattern.
  const byYear = new Map<number, MetRecord[]>();
  for (const row of records_) {
    const year = new Date(row.timestamp).getUTCFullYear();
    if (Number.isNaN(year)) continue;
    const bucket = byYear.get(year) ?? [];
    bucket.push(row);
    byYear.set(year, bucket);
  }

  const rng = mulberry32(options.seed ?? 12345);

  const perYearAccum = new Map<number, { sum: number; count: number }>();
  const perYearPredicted = new Map<number, { sum: number; count: number }>();
  const perYearObserved = new Map<number, { sum: number; count: number }>();

  for (const [year, rows] of byYear.entries()) {
    // Baseline predicted on actual data
    const baselinePredictions = predict(rows);
    accumulate(perYearObserved, year, rows.map((r) => r.value));
    accumulate(perYearPredicted, year, baselinePredictions);

    // Resampling loop
    for (let iter = 0; iter < iterations; iter += 1) {
      const swapYear = swapYears[Math.floor(rng() * swapYears.length)];
      const swapPool = byYear.get(swapYear);
      if (!swapPool || swapPool.length === 0) continue;
      const swapped = rows.map((row) => ({
        ...row,
        features: swapPool[Math.floor(rng() * swapPool.length)].features,
      }));
      const predictions = predict(swapped);
      accumulate(perYearAccum, year, predictions);
    }
  }

  return {
    perYearMean: finaliseAccumulator(perYearAccum),
    perYearObservedMean: finaliseAccumulator(perYearObserved),
    perYearPredictedMean: finaliseAccumulator(perYearPredicted),
    iterations,
    swapYears,
  };
}

/**
 * Filter records so that any feature vector outside the training set's
 * per-feature bounding box is dropped. Use this with `decomposeMetYears`
 * (or any partial-dependence calculation) to avoid extrapolating outside
 * the data the model saw at training time.
 */
export function guardTrainingOnly(
  records: readonly MetRecord[],
  trainingRecords: readonly MetRecord[],
): MetRecord[] {
  const featureKeys = new Set<string>();
  for (const row of trainingRecords) {
    for (const key of Object.keys(row.features)) featureKeys.add(key);
  }
  const bounds = new Map<string, { min: number; max: number }>();
  for (const key of featureKeys) {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const row of trainingRecords) {
      const v = row.features[key];
      if (Number.isFinite(v)) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    bounds.set(key, { min, max });
  }
  return records.filter((row) => {
    for (const [key, range] of bounds.entries()) {
      const v = row.features[key];
      if (!Number.isFinite(v)) return false;
      if (v < range.min || v > range.max) return false;
    }
    return true;
  });
}

function accumulate(target: Map<number, { sum: number; count: number }>, year: number, values: readonly number[]) {
  const bucket = target.get(year) ?? { sum: 0, count: 0 };
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    bucket.sum += value;
    bucket.count += 1;
  }
  target.set(year, bucket);
}

function finaliseAccumulator(input: Map<number, { sum: number; count: number }>): Map<number, number> {
  const out = new Map<number, number>();
  for (const [year, bucket] of input.entries()) {
    if (bucket.count > 0) out.set(year, bucket.sum / bucket.count);
  }
  return out;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}
