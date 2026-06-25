export type MeasurementPair = {
  time?: string | number | Date;
  reference: number;
  sensor: number;
};

export type PairedMeasurement = MeasurementPair & {
  index: number;
};

export type LinearFit = {
  n: number;
  slope: number;
  intercept: number;
  r2: number;
  rmse: number;
  mae: number;
  bias: number;
};

export type BlandAltmanPoint = {
  index: number;
  average: number;
  difference: number;
};

export type BlandAltmanSummary = {
  n: number;
  meanDifference: number;
  standardDeviation: number;
  lowerLimit: number;
  upperLimit: number;
  points: BlandAltmanPoint[];
};

export type RelativeExpandedUncertaintyPoint = {
  index: number;
  reference: number;
  sensor: number;
  reu: number;
};

export type RelativeExpandedUncertaintyResult = {
  n: number;
  slope: number;
  intercept: number;
  residualVariance: number;
  points: RelativeExpandedUncertaintyPoint[];
};

export type DensityPoint = {
  x: number;
  y: number;
  value: number;
};

export type BiasCorrectionResult = {
  fit: LinearFit;
  pairs: MeasurementPair[];
};

function finitePairs(pairs: MeasurementPair[]): PairedMeasurement[] {
  return pairs
    .map((pair, index) => ({ ...pair, index }))
    .filter((pair) => Number.isFinite(pair.reference) && Number.isFinite(pair.sensor));
}

function variance(values: number[], mean: number): number {
  if (values.length <= 1) return 0;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
}

/**
 * @equation rmse
 * @title Root mean squared error (RMSE)
 * @category AQI & Metrics
 * @latex \mathrm{RMSE} = \sqrt{\dfrac{1}{n}\sum_{i=1}^{n}(s_i - r_i)^2}
 * @var s_i | sensor value
 * @var r_i | reference value
 * @cite EPA Performance Targets (Duvall et al. 2021)
 */
/**
 * @equation r2
 * @title Coefficient of determination (R²)
 * @category AQI & Metrics
 * @latex R^2 = \left(\dfrac{\sum (r_i-\bar r)(s_i-\bar s)}{\sqrt{\sum (r_i-\bar r)^2}\,\sqrt{\sum (s_i-\bar s)^2}}\right)^2
 * @var r_i | reference value
 * @var s_i | sensor value
 */
/**
 * @equation nmbe
 * @title Normalized mean bias error (NMBE) & NRMSE
 * @category AQI & Metrics
 * @latex \mathrm{NMBE} = \dfrac{\frac{1}{n}\sum (s_i - r_i)}{\bar r} \qquad \mathrm{NRMSE} = \dfrac{\mathrm{RMSE}}{\bar r}
 * @var \bar r | mean reference value
 * @cite EPA Performance Targets (Duvall et al. 2021)
 */
export function linearFit(pairs: MeasurementPair[]): LinearFit {
  const usable = finitePairs(pairs);
  const n = usable.length;
  if (n === 0) {
    return { n: 0, slope: 0, intercept: 0, r2: 0, rmse: 0, mae: 0, bias: 0 };
  }

  const meanX = usable.reduce((sum, pair) => sum + pair.reference, 0) / n;
  const meanY = usable.reduce((sum, pair) => sum + pair.sensor, 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  let sq = 0;
  let abs = 0;
  let bias = 0;

  for (const pair of usable) {
    const dx = pair.reference - meanX;
    const dy = pair.sensor - meanY;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;

    const error = pair.sensor - pair.reference;
    sq += error * error;
    abs += Math.abs(error);
    bias += error;
  }

  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = meanY - slope * meanX;
  const r = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;

  return {
    n,
    slope,
    intercept,
    r2: r * r,
    rmse: Math.sqrt(sq / n),
    mae: abs / n,
    bias: bias / n,
  };
}

/**
 * @equation bland-altman
 * @title Bland-Altman limits of agreement
 * @category Validation & Uncertainty
 * @latex \text{LoA} = \bar{d} \pm 1.96\,\mathrm{SD}(d), \quad d = s - r
 * @var \bar{d} | mean sensor-reference difference
 * @var \mathrm{SD}(d) | standard deviation of the differences
 * @cite Bland & Altman 1986
 */
export function blandAltman(pairs: MeasurementPair[]): BlandAltmanSummary {
  const points = finitePairs(pairs).map((pair) => ({
    index: pair.index,
    average: (pair.reference + pair.sensor) / 2,
    difference: pair.sensor - pair.reference,
  }));
  const n = points.length;
  if (n === 0) {
    return { n: 0, meanDifference: 0, standardDeviation: 0, lowerLimit: 0, upperLimit: 0, points: [] };
  }

  const meanDifference = points.reduce((sum, point) => sum + point.difference, 0) / n;
  const standardDeviation = Math.sqrt(variance(points.map((point) => point.difference), meanDifference));

  return {
    n,
    meanDifference,
    standardDeviation,
    lowerLimit: meanDifference - 1.96 * standardDeviation,
    upperLimit: meanDifference + 1.96 * standardDeviation,
    points,
  };
}

/**
 * @equation reu
 * @title Relative expanded uncertainty (REU)
 * @category Validation & Uncertainty
 * @latex \mathrm{REU} = \dfrac{k}{|x|}\sqrt{\sigma_v^{2} - u_{ref}^{2} + \big(b_0 + (m-1)\,r\big)^{2}}\times 100
 * @var \sigma_v^2 | residual variance of the sensor-reference fit
 * @var u_{ref} | reference-method uncertainty
 * @var b_0, m | fit intercept and slope; r reference value
 * @var k | coverage factor (default 2)
 * @cite EPA Performance Targets (Duvall et al. 2021)
 */
export function relativeExpandedUncertainty(
  pairs: MeasurementPair[],
  options: { k?: number; referenceUncertainty?: number; minSamples?: number } = {},
): RelativeExpandedUncertaintyResult {
  const usable = finitePairs(pairs);
  const minSamples = options.minSamples ?? 3;
  if (usable.length < minSamples) {
    return { n: usable.length, slope: 0, intercept: 0, residualVariance: 0, points: [] };
  }

  const fit = linearFit(usable);
  const k = options.k ?? 2;
  const referenceUncertainty = options.referenceUncertainty ?? 0;
  const rss = usable.reduce((sum, pair) => {
    const residual = pair.sensor - fit.intercept - fit.slope * pair.reference;
    return sum + residual * residual;
  }, 0);
  const residualVariance = usable.length > 2 ? rss / (usable.length - 2) : 0;

  const points = usable
    .map((pair) => {
      const deviationFromOneToOne = fit.intercept + (fit.slope - 1) * pair.reference;
      const uncertaintyVariance = Math.max(0, residualVariance - referenceUncertainty ** 2 + deviationFromOneToOne ** 2);
      return {
        index: pair.index,
        reference: pair.reference,
        sensor: pair.sensor,
        reu: pair.sensor === 0 ? Number.NaN : (k * Math.sqrt(uncertaintyVariance) * 100) / Math.abs(pair.sensor),
      };
    })
    .filter((point) => Number.isFinite(point.reu));

  return {
    n: usable.length,
    slope: fit.slope,
    intercept: fit.intercept,
    residualVariance,
    points,
  };
}

export function densityPoints(points: Array<{ x: number; y: number }>, bins = 32): DensityPoint[] {
  const usable = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (usable.length === 0) return [];

  const minX = Math.min(...usable.map((point) => point.x));
  const maxX = Math.max(...usable.map((point) => point.x));
  const minY = Math.min(...usable.map((point) => point.y));
  const maxY = Math.max(...usable.map((point) => point.y));
  const xSpan = maxX - minX || 1;
  const ySpan = maxY - minY || 1;
  const counts = new Map<string, number>();

  for (const point of usable) {
    const xBin = Math.min(bins - 1, Math.max(0, Math.floor(((point.x - minX) / xSpan) * bins)));
    const yBin = Math.min(bins - 1, Math.max(0, Math.floor(((point.y - minY) / ySpan) * bins)));
    const key = `${xBin}:${yBin}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return usable.map((point) => {
    const xBin = Math.min(bins - 1, Math.max(0, Math.floor(((point.x - minX) / xSpan) * bins)));
    const yBin = Math.min(bins - 1, Math.max(0, Math.floor(((point.y - minY) / ySpan) * bins)));
    return { x: point.x, y: point.y, value: counts.get(`${xBin}:${yBin}`) ?? 1 };
  });
}

export function applyLinearBiasCorrection(pairs: MeasurementPair[]): BiasCorrectionResult {
  const fit = linearFit(pairs);
  if (fit.slope === 0) return { fit, pairs: [] };

  return {
    fit,
    pairs: finitePairs(pairs).map((pair) => ({
      time: pair.time,
      reference: pair.reference,
      sensor: (pair.sensor - fit.intercept) / fit.slope,
    })),
  };
}
