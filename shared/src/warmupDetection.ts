// ---------------------------------------------------------------------------
// warmupDetection — flags the first N minutes (or first M samples) of data
// after a sensor power-on / firmware restart event. Mirrors sensortoolkit's
// `flag_warmup_data()` helper. Useful for the validation lab and for the
// EPA-style "warmup-event detection" toggle in QC profiles.
//
// A warmup event is detected when the gap between two consecutive samples
// exceeds `restartGapMinutes` (default 60 minutes). After each detected
// restart, the next `warmupMinutes` (or `warmupSampleCount`) samples are
// returned as flagged indices.
// ---------------------------------------------------------------------------

export type WarmupDetectionOptions = {
  /** A restart is inferred whenever consecutive samples are this far apart. */
  restartGapMinutes?: number;
  /** Duration (minutes) of the warmup window after a restart. */
  warmupMinutes?: number;
  /** Alternative: flag this many samples after each restart. */
  warmupSampleCount?: number;
};

export type WarmupEvent = {
  restartIndex: number;
  warmupIndices: number[];
};

const DEFAULT_GAP = 60;
const DEFAULT_WARMUP = 30;

export function detectWarmupEvents(
  timestamps: readonly string[],
  options: WarmupDetectionOptions = {},
): WarmupEvent[] {
  const restartGapMinutes = options.restartGapMinutes ?? DEFAULT_GAP;
  const warmupMinutes = options.warmupMinutes;
  const warmupSamples = options.warmupSampleCount ?? (warmupMinutes ? null : DEFAULT_WARMUP);

  const ms = timestamps.map((value) => Date.parse(value));
  const events: WarmupEvent[] = [];

  // First sample is always treated as a restart.
  if (ms.length > 0) {
    events.push({
      restartIndex: 0,
      warmupIndices: buildWarmupIndices(ms, 0, warmupMinutes, warmupSamples),
    });
  }
  for (let i = 1; i < ms.length; i += 1) {
    if (!Number.isFinite(ms[i]) || !Number.isFinite(ms[i - 1])) continue;
    const gapMinutes = (ms[i] - ms[i - 1]) / 60_000;
    if (gapMinutes > restartGapMinutes) {
      events.push({
        restartIndex: i,
        warmupIndices: buildWarmupIndices(ms, i, warmupMinutes, warmupSamples),
      });
    }
  }
  return events;
}

/**
 * Returns the union of flagged warmup indices across all detected events.
 * Handy as a quick `Set<number>` for masking a measurement array.
 */
export function warmupIndexSet(
  timestamps: readonly string[],
  options?: WarmupDetectionOptions,
): Set<number> {
  const events = detectWarmupEvents(timestamps, options);
  const set = new Set<number>();
  for (const event of events) {
    for (const idx of event.warmupIndices) set.add(idx);
  }
  return set;
}

function buildWarmupIndices(
  ms: readonly number[],
  start: number,
  warmupMinutes: number | undefined,
  warmupSamples: number | null,
): number[] {
  if (warmupMinutes !== undefined) {
    const endTime = ms[start] + warmupMinutes * 60_000;
    const indices: number[] = [];
    for (let i = start; i < ms.length; i += 1) {
      if (ms[i] > endTime) break;
      indices.push(i);
    }
    return indices;
  }
  const count = warmupSamples ?? DEFAULT_WARMUP;
  const indices: number[] = [];
  for (let i = start; i < Math.min(ms.length, start + count); i += 1) indices.push(i);
  return indices;
}
