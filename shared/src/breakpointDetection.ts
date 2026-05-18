// ---------------------------------------------------------------------------
// breakpointDetection — Chow / Bai-Perron style breakpoint search analogous
// to the `strucchange` R package's `breakpoints()` function. We minimise the
// sum of squared residuals of piecewise-linear fits with a dynamic-program
// search over candidate change-points. Returns the chosen indices, the
// corresponding linear segments, and a BIC score for selecting the number
// of breakpoints.
//
// This is intended as a drop-in replacement for the sliding-window heuristic
// that PAtool currently uses for drift detection.
// ---------------------------------------------------------------------------

export type BreakpointSeriesPoint = { x: number; y: number };

export type LinearSegment = {
  startIndex: number;
  endIndex: number;
  slope: number;
  intercept: number;
  rss: number;
};

export type BreakpointResult = {
  breakpoints: number[];        // indices (1-based to match strucchange semantics)
  segments: LinearSegment[];
  rss: number;
  bic: number;
};

export type BreakpointOptions = {
  maxBreakpoints?: number;
  minSegmentSize?: number;
};

export function detectBreakpoints(
  series: readonly BreakpointSeriesPoint[],
  options: BreakpointOptions = {},
): BreakpointResult {
  const minSeg = options.minSegmentSize ?? Math.max(5, Math.floor(series.length * 0.1));
  const maxBp = options.maxBreakpoints ?? 3;
  const n = series.length;
  if (n < 2 * minSeg) {
    return naiveSingleSegment(series);
  }

  // Pre-compute RSS for every contiguous slice [i, j] (inclusive bounds).
  const rss: Float64Array = new Float64Array(n * n);
  const slope: Float64Array = new Float64Array(n * n);
  const intercept: Float64Array = new Float64Array(n * n);
  for (let i = 0; i < n; i += 1) {
    for (let j = i; j < n; j += 1) {
      const len = j - i + 1;
      if (len < 2) {
        rss[i * n + j] = 0;
        continue;
      }
      const fit = simpleFit(series, i, j);
      slope[i * n + j] = fit.slope;
      intercept[i * n + j] = fit.intercept;
      rss[i * n + j] = fit.rss;
    }
  }

  // Dynamic program: bestRss[k][j] = minimal RSS for series[0..j] split into
  // k+1 segments. bestPrev[k][j] = chosen left-end of the last segment.
  const bestRss: number[][] = Array.from({ length: maxBp + 1 }, () => new Array<number>(n).fill(Number.POSITIVE_INFINITY));
  const bestPrev: number[][] = Array.from({ length: maxBp + 1 }, () => new Array<number>(n).fill(-1));

  for (let j = minSeg - 1; j < n; j += 1) {
    bestRss[0][j] = rss[0 * n + j];
    bestPrev[0][j] = 0;
  }
  for (let k = 1; k <= maxBp; k += 1) {
    for (let j = (k + 1) * minSeg - 1; j < n; j += 1) {
      for (let i = k * minSeg; i <= j - minSeg + 1; i += 1) {
        const score = bestRss[k - 1][i - 1] + rss[i * n + j];
        if (score < bestRss[k][j]) {
          bestRss[k][j] = score;
          bestPrev[k][j] = i;
        }
      }
    }
  }

  // Pick the best k by BIC: BIC(k) = n * log(rss/n) + (k+1) * (2) * log(n)
  // (per Bai & Perron 2003, with two parameters per segment.)
  let bestK = 0;
  let bestBic = Number.POSITIVE_INFINITY;
  for (let k = 0; k <= maxBp; k += 1) {
    const totalRss = bestRss[k][n - 1];
    if (!Number.isFinite(totalRss)) continue;
    const bic = n * Math.log(Math.max(totalRss, 1e-12) / n) + (k + 1) * 2 * Math.log(n);
    if (bic < bestBic) {
      bestBic = bic;
      bestK = k;
    }
  }

  // Reconstruct segments.
  const breakIndices: number[] = [];
  const segments: LinearSegment[] = [];
  let endIdx = n - 1;
  for (let k = bestK; k >= 0; k -= 1) {
    const startIdx = bestPrev[k][endIdx];
    segments.unshift({
      startIndex: startIdx,
      endIndex: endIdx,
      slope: slope[startIdx * n + endIdx],
      intercept: intercept[startIdx * n + endIdx],
      rss: rss[startIdx * n + endIdx],
    });
    if (k > 0) breakIndices.unshift(startIdx);
    endIdx = startIdx - 1;
    if (endIdx < 0) break;
  }

  return {
    breakpoints: breakIndices.map((idx) => idx + 1),
    segments,
    rss: bestRss[bestK][n - 1],
    bic: bestBic,
  };
}

function simpleFit(series: readonly BreakpointSeriesPoint[], start: number, end: number) {
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  const n = end - start + 1;
  for (let i = start; i <= end; i += 1) {
    sumX += series[i].x;
    sumY += series[i].y;
    sumXY += series[i].x * series[i].y;
    sumXX += series[i].x * series[i].x;
  }
  const denom = n * sumXX - sumX * sumX;
  const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
  const intercept = (sumY - slope * sumX) / n;
  let rss = 0;
  for (let i = start; i <= end; i += 1) {
    const yhat = intercept + slope * series[i].x;
    rss += (series[i].y - yhat) ** 2;
  }
  return { slope, intercept, rss };
}

function naiveSingleSegment(series: readonly BreakpointSeriesPoint[]): BreakpointResult {
  if (series.length === 0) {
    return { breakpoints: [], segments: [], rss: 0, bic: 0 };
  }
  const fit = simpleFit(series, 0, series.length - 1);
  return {
    breakpoints: [],
    segments: [{
      startIndex: 0,
      endIndex: series.length - 1,
      slope: fit.slope,
      intercept: fit.intercept,
      rss: fit.rss,
    }],
    rss: fit.rss,
    bic: series.length * Math.log(Math.max(fit.rss, 1e-12) / Math.max(series.length, 1)) + 2 * Math.log(Math.max(series.length, 1)),
  };
}
