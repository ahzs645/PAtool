// ---------------------------------------------------------------------------
// pollenInteraction — biteSizedAQ helper: jointly summarise PM2.5 and
// pollen concentrations and detect their interaction in a daily series.
//
// The function returns:
//   - paired-day stats (count, Spearman ρ on log-pollen vs PM2.5),
//   - a 2-D contingency table (high/low PM2.5 × high/low pollen) for
//     symptom-overlap analyses, and
//   - a quick interaction score `interactionScore = corr × meanProduct` to
//     rank days where both factors are simultaneously elevated.
// ---------------------------------------------------------------------------

export type PollenPm25Day = {
  date: string;
  pm25: number;
  pollenGrainsPerM3: number;
};

export type PollenInteractionResult = {
  n: number;
  spearmanCorrelation: number;
  meanPm25: number;
  meanPollen: number;
  meanLogPollen: number;
  contingency: {
    highHigh: number;
    highLow: number;
    lowHigh: number;
    lowLow: number;
  };
  thresholds: { pm25: number; pollen: number };
  interactionScore: number;
  jointHighDays: string[];
};

export function pollenPm25Interaction(
  days: readonly PollenPm25Day[],
  options: { pm25Threshold?: number; pollenThreshold?: number } = {},
): PollenInteractionResult {
  const usable = days.filter((row) => Number.isFinite(row.pm25) && Number.isFinite(row.pollenGrainsPerM3));
  if (usable.length === 0) {
    return {
      n: 0,
      spearmanCorrelation: 0,
      meanPm25: 0,
      meanPollen: 0,
      meanLogPollen: 0,
      contingency: { highHigh: 0, highLow: 0, lowHigh: 0, lowLow: 0 },
      thresholds: { pm25: options.pm25Threshold ?? 0, pollen: options.pollenThreshold ?? 0 },
      interactionScore: 0,
      jointHighDays: [],
    };
  }
  const pm25Values = usable.map((row) => row.pm25);
  const pollenValues = usable.map((row) => row.pollenGrainsPerM3);
  const logPollen = pollenValues.map((value) => Math.log(value + 1));
  const meanPm25 = mean(pm25Values);
  const meanPollen = mean(pollenValues);
  const meanLogPollen = mean(logPollen);
  const pm25Threshold = options.pm25Threshold ?? quantile(pm25Values, 0.75);
  const pollenThreshold = options.pollenThreshold ?? quantile(pollenValues, 0.75);
  let highHigh = 0;
  let highLow = 0;
  let lowHigh = 0;
  let lowLow = 0;
  const jointHigh: string[] = [];
  for (const row of usable) {
    const highPm = row.pm25 >= pm25Threshold;
    const highPollen = row.pollenGrainsPerM3 >= pollenThreshold;
    if (highPm && highPollen) {
      highHigh += 1;
      jointHigh.push(row.date);
    } else if (highPm) {
      highLow += 1;
    } else if (highPollen) {
      lowHigh += 1;
    } else {
      lowLow += 1;
    }
  }
  const correlation = spearman(pm25Values, logPollen);
  return {
    n: usable.length,
    spearmanCorrelation: correlation,
    meanPm25,
    meanPollen,
    meanLogPollen,
    contingency: { highHigh, highLow, lowHigh, lowLow },
    thresholds: { pm25: pm25Threshold, pollen: pollenThreshold },
    interactionScore: correlation * meanPm25 * meanLogPollen,
    jointHighDays: jointHigh,
  };
}

function mean(values: readonly number[]): number {
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
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

function spearman(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  const ra = rank(a);
  const rb = rank(b);
  const meanR = (ra.length + 1) / 2;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < ra.length; i += 1) {
    const dxa = ra[i] - meanR;
    const dxb = rb[i] - meanR;
    num += dxa * dxb;
    da += dxa * dxa;
    db += dxb * dxb;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

function rank(values: readonly number[]): number[] {
  const indexed = values.map((value, index) => ({ value, index }));
  indexed.sort((x, y) => x.value - y.value);
  const ranks = new Array<number>(values.length).fill(0);
  for (let i = 0; i < indexed.length; ) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].value === indexed[i].value) j += 1;
    const average = (i + j) / 2 + 1;     // 1-based rank
    for (let k = i; k <= j; k += 1) ranks[indexed[k].index] = average;
    i = j + 1;
  }
  return ranks;
}
