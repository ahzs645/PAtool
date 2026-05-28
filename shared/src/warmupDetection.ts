/**
 * Detect sensor warm-up events. A warm-up is a transient period right
 * after sensor power-on or sensor blank during which the measurement
 * stabilises toward steady state. sensortoolkit masks these periods so
 * they don't bias bias/precision metrics.
 *
 * Strategy:
 *   1. Identify "starts" — boundaries between gaps and measurement
 *      windows (gaps inferred from sample spacing).
 *   2. For each start, find the index where a rolling mean of the next
 *      `lookahead` samples stabilises (Δ between consecutive rolling
 *      means falls below `stabilityThreshold` for ≥ `consecutive` steps).
 *   3. Mark all samples between the start and the stabilisation index as
 *      warm-up.
 */

import { rollingMean } from "./openairSmoothers";

export type WarmupOptions = {
  /** Number of samples to look ahead for stabilisation. */
  lookahead?: number;
  /** Absolute (or relative if normalized) delta below which we call it stable. */
  stabilityThreshold?: number;
  /** Number of consecutive sub-threshold steps required. */
  consecutive?: number;
  /** Maximum gap (in samples) treated as one continuous measurement. */
  gapThresholdSamples?: number;
};

export type WarmupEvent = {
  startIndex: number;
  endIndex: number;
  durationSamples: number;
};

export type WarmupResult = {
  events: WarmupEvent[];
  mask: boolean[];
  cleaned: Array<number | null>;
};

export function detectWarmupEvents(
  values: ReadonlyArray<number | null>,
  options: WarmupOptions = {},
): WarmupResult {
  const lookahead = Math.max(3, options.lookahead ?? 6);
  const threshold = Math.max(0, options.stabilityThreshold ?? 0.5);
  const consecutive = Math.max(2, options.consecutive ?? 3);
  const gapThreshold = Math.max(1, options.gapThresholdSamples ?? 2);

  const present = values.map((v) => typeof v === "number" && Number.isFinite(v));
  const events: WarmupEvent[] = [];
  let runStart: number | null = null;
  for (let i = 0; i <= values.length; i += 1) {
    if (i < values.length && present[i]) {
      if (runStart === null) runStart = i;
      continue;
    }
    if (runStart !== null) {
      events.push(...findWarmups(values, runStart, i, lookahead, threshold, consecutive));
      runStart = null;
    }
    // Skip leading gaps
    while (i < values.length && !present[i]) {
      let gap = 0;
      while (i + gap < values.length && !present[i + gap]) gap += 1;
      if (gap < gapThreshold) break;
      i += gap - 1;
      break;
    }
  }

  const mask = new Array(values.length).fill(false);
  for (const e of events) for (let i = e.startIndex; i <= e.endIndex; i += 1) mask[i] = true;
  const cleaned = values.map((v, i) => (mask[i] ? null : v));
  return { events, mask, cleaned };
}

function findWarmups(
  values: ReadonlyArray<number | null>,
  start: number,
  endExclusive: number,
  lookahead: number,
  threshold: number,
  consecutive: number,
): WarmupEvent[] {
  const window = values.slice(start, endExclusive);
  if (window.length < lookahead + consecutive) return [];
  const smoothed = rollingMean(window, lookahead);
  let stableCount = 0;
  for (let i = 1; i < smoothed.length; i += 1) {
    if (Math.abs(smoothed[i] - smoothed[i - 1]) < threshold) {
      stableCount += 1;
      if (stableCount >= consecutive) {
        const endIndex = start + i;
        if (endIndex - start > 0) {
          return [{ startIndex: start, endIndex, durationSamples: endIndex - start + 1 }];
        }
        return [];
      }
    } else {
      stableCount = 0;
    }
  }
  return [];
}
