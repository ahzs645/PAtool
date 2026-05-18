// ---------------------------------------------------------------------------
// airSensorPat — extra TS analogues of selected helpers from the R
// `AirSensor` package that complement (but do not replace) the existing
// `domain.ts` versions:
//
//   - patChannelInternalFit  : A vs B channel OLS with the rich LinearFit
//     return (slope / intercept / r² / RMSE / MAE / bias / mean abs %-diff).
//     The existing `patInternalFit` in `domain.ts` operates on a PatSeries
//     and returns only {slope, intercept, pearsonR, n} — this helper takes
//     raw samples and exposes the full LinearFit shape needed by validation
//     reports and the openair-style scatter plot.
//
//   - patChannelExternalFit  : PA channel mean vs federal reference, same
//     rationale.
//
// `pasFilterArea` / `pasFilterNear` already live in `domain.ts`; this module
// does not re-export them.
// ---------------------------------------------------------------------------

import { linearFit, type LinearFit } from "./measurementError";

export type PatChannelSample = {
  timestamp: string;
  pm25A: number | null;
  pm25B: number | null;
};

export type PatFitResult = LinearFit & {
  channel: "A-vs-B" | "external";
  /** Mean abs(A-B) percent (only set for the internal fit). */
  meanAbsPercentDiff?: number;
};

export function patChannelInternalFit(samples: readonly PatChannelSample[]): PatFitResult {
  const pairs = samples
    .filter((sample) => sample.pm25A != null && sample.pm25B != null
      && Number.isFinite(sample.pm25A) && Number.isFinite(sample.pm25B))
    .map((sample) => ({ reference: sample.pm25B as number, sensor: sample.pm25A as number }));
  const fit = linearFit(pairs);
  let absPctSum = 0;
  let absPctCount = 0;
  for (const pair of pairs) {
    const denom = (pair.reference + pair.sensor) / 2;
    if (denom > 0) {
      absPctSum += (Math.abs(pair.sensor - pair.reference) / denom) * 100;
      absPctCount += 1;
    }
  }
  return {
    ...fit,
    channel: "A-vs-B",
    meanAbsPercentDiff: absPctCount > 0 ? absPctSum / absPctCount : 0,
  };
}

export type PatExternalSample = {
  timestamp: string;
  patPm25: number | null;
  referencePm25: number | null;
};

export function patChannelExternalFit(samples: readonly PatExternalSample[]): PatFitResult {
  const pairs = samples
    .filter((sample) => sample.patPm25 != null && sample.referencePm25 != null
      && Number.isFinite(sample.patPm25) && Number.isFinite(sample.referencePm25))
    .map((sample) => ({ reference: sample.referencePm25 as number, sensor: sample.patPm25 as number }));
  return { ...linearFit(pairs), channel: "external" };
}
