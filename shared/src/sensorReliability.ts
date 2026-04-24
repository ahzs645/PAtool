import {
  applyPurpleAirCorrection,
  calculateEnhancedSohIndex,
  evaluateChannelAgreement,
  reducedMajorAxisRegression,
  type ChannelQcProfileId,
  type PatPoint,
  type PatSeries,
} from "./domain";

export type SensorReliabilityCategory = "pass" | "watch" | "fail";

export type SensorReliabilityIssue = {
  code: string;
  severity: SensorReliabilityCategory;
  message: string;
  count?: number;
};

export type SensorReliabilityCompleteness = {
  observedPoints: number;
  expectedPoints: number;
  reportingCompleteness: number;
  channelACompleteness: number;
  channelBCompleteness: number;
  pairedCompleteness: number;
  humidityCompleteness: number;
};

export type SensorReliabilityAgreement = {
  profileId: ChannelQcProfileId;
  pairedPoints: number;
  validPairs: number;
  invalidPairs: number;
  unavailablePairs: number;
  agreementFraction: number;
  meanAbsoluteDifference: number | null;
  meanRelativePercentDifference: number | null;
  category: SensorReliabilityCategory;
};

export type SensorReliabilityRmaRegression = {
  slope: number;
  intercept: number;
  pearsonR: number;
  n: number;
  category: SensorReliabilityCategory;
} | null;

export type BarkjohnAvailabilitySummary = {
  inputBasis: "cf_1";
  profileId: "epa-barkjohn-2021-cf1";
  cf1Availability: number;
  rhAvailability: number;
  correctedAvailability: number;
  cf1Points: number;
  rhPoints: number;
  correctedPoints: number;
};

export type SensorReliabilityDriftTrend = {
  days: number;
  metric: "meanAbsoluteChannelDelta";
  slopePerDay: number | null;
  startValue: number | null;
  endValue: number | null;
  direction: "improving" | "stable" | "degrading" | "unavailable";
  category: SensorReliabilityCategory;
};

export type SensorReliabilityReport = {
  sensorId: string;
  label: string;
  category: SensorReliabilityCategory;
  completeness: SensorReliabilityCompleteness;
  agreement: SensorReliabilityAgreement;
  rmaRegression: SensorReliabilityRmaRegression;
  barkjohn: BarkjohnAvailabilitySummary;
  drift: SensorReliabilityDriftTrend;
  sohIndex: {
    index: number;
    status: "excellent" | "good" | "watch" | "poor";
  };
  issues: SensorReliabilityIssue[];
};

export type SensorReliabilityOptions = {
  agreementProfileId?: ChannelQcProfileId;
  expectedIntervalMinutes?: number;
  completenessPassThreshold?: number;
  completenessWatchThreshold?: number;
  agreementPassThreshold?: number;
  agreementWatchThreshold?: number;
  barkjohnPassThreshold?: number;
  barkjohnWatchThreshold?: number;
  rmaSlopeTolerancePass?: number;
  rmaSlopeToleranceWatch?: number;
  rmaPearsonPassThreshold?: number;
  rmaPearsonWatchThreshold?: number;
  driftDeltaPerDayWatchThreshold?: number;
  driftDeltaPerDayFailThreshold?: number;
};

const DEFAULT_OPTIONS = {
  agreementProfileId: "barkjohn-daily" as const,
  completenessPassThreshold: 0.8,
  completenessWatchThreshold: 0.6,
  agreementPassThreshold: 0.9,
  agreementWatchThreshold: 0.75,
  barkjohnPassThreshold: 0.8,
  barkjohnWatchThreshold: 0.6,
  rmaSlopeTolerancePass: 0.1,
  rmaSlopeToleranceWatch: 0.25,
  rmaPearsonPassThreshold: 0.9,
  rmaPearsonWatchThreshold: 0.75,
  driftDeltaPerDayWatchThreshold: 0.5,
  driftDeltaPerDayFailThreshold: 1.5,
};

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function round(value: number, digits = 3): number {
  return Number(value.toFixed(digits));
}

function fraction(numerator: number, denominator: number): number {
  return denominator > 0 ? round(numerator / denominator, 4) : 0;
}

function average(values: readonly number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pointTime(point: PatPoint): number | null {
  const time = new Date(point.timestamp).getTime();
  return Number.isFinite(time) ? time : null;
}

function inferExpectedPoints(series: PatSeries, expectedIntervalMinutes?: number): number {
  const points = series.points;
  if (!points.length) return 0;
  if (points.length === 1) return 1;

  const times = points.map(pointTime).filter((time): time is number => time !== null).sort((a, b) => a - b);
  if (times.length < 2) return points.length;

  const deltas = times
    .slice(1)
    .map((time, index) => time - times[index])
    .filter((delta) => delta > 0)
    .sort((a, b) => a - b);
  if (!deltas.length) return points.length;

  const intervalMs = expectedIntervalMinutes
    ? expectedIntervalMinutes * 60_000
    : deltas[Math.floor(deltas.length / 2)];
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return points.length;

  return Math.max(points.length, Math.floor((times[times.length - 1] - times[0]) / intervalMs) + 1);
}

function meanCf1(point: PatPoint): number | null {
  const values = [point.pm25Cf1A, point.pm25Cf1B].filter(finiteNumber);
  const result = average(values);
  return result === null ? null : round(result);
}

function categoryRank(category: SensorReliabilityCategory): number {
  return category === "fail" ? 2 : category === "watch" ? 1 : 0;
}

function worstCategory(categories: readonly SensorReliabilityCategory[]): SensorReliabilityCategory {
  return categories.reduce<SensorReliabilityCategory>(
    (worst, category) => (categoryRank(category) > categoryRank(worst) ? category : worst),
    "pass",
  );
}

function thresholdCategory(value: number, passThreshold: number, watchThreshold: number): SensorReliabilityCategory {
  if (value >= passThreshold) return "pass";
  return value >= watchThreshold ? "watch" : "fail";
}

export function summarizeSensorReliabilityCompleteness(
  series: PatSeries,
  options: Pick<SensorReliabilityOptions, "expectedIntervalMinutes"> = {},
): SensorReliabilityCompleteness {
  const observedPoints = series.points.length;
  const expectedPoints = inferExpectedPoints(series, options.expectedIntervalMinutes);
  const denominator = Math.max(expectedPoints, observedPoints, 1);
  const channelAPoints = series.points.filter((point) => finiteNumber(point.pm25A)).length;
  const channelBPoints = series.points.filter((point) => finiteNumber(point.pm25B)).length;
  const pairedPoints = series.points.filter((point) => finiteNumber(point.pm25A) && finiteNumber(point.pm25B)).length;
  const humidityPoints = series.points.filter((point) => finiteNumber(point.humidity)).length;

  return {
    observedPoints,
    expectedPoints,
    reportingCompleteness: fraction(observedPoints, denominator),
    channelACompleteness: fraction(channelAPoints, denominator),
    channelBCompleteness: fraction(channelBPoints, denominator),
    pairedCompleteness: fraction(pairedPoints, denominator),
    humidityCompleteness: fraction(humidityPoints, denominator),
  };
}

export function summarizeSensorReliabilityAgreement(
  series: PatSeries,
  options: Pick<
    SensorReliabilityOptions,
    "agreementProfileId" | "agreementPassThreshold" | "agreementWatchThreshold"
  > = {},
): SensorReliabilityAgreement {
  const resolved = { ...DEFAULT_OPTIONS, ...options };
  let validPairs = 0;
  let unavailablePairs = 0;
  const absoluteDifferences: number[] = [];
  const relativeDifferences: number[] = [];

  for (const point of series.points) {
    const agreement = evaluateChannelAgreement(point.pm25A, point.pm25B, resolved.agreementProfileId);
    if (agreement.level === "unavailable") {
      unavailablePairs++;
      continue;
    }
    if (agreement.valid) validPairs++;
    if (agreement.absoluteDifference !== null) absoluteDifferences.push(agreement.absoluteDifference);
    if (agreement.relativePercentDifference !== null) relativeDifferences.push(agreement.relativePercentDifference);
  }

  const pairedPoints = absoluteDifferences.length;
  const agreementFraction = fraction(validPairs, pairedPoints);

  return {
    profileId: resolved.agreementProfileId,
    pairedPoints,
    validPairs,
    invalidPairs: pairedPoints - validPairs,
    unavailablePairs,
    agreementFraction,
    meanAbsoluteDifference: average(absoluteDifferences) === null ? null : round(average(absoluteDifferences)!),
    meanRelativePercentDifference: average(relativeDifferences) === null ? null : round(average(relativeDifferences)!),
    category: thresholdCategory(
      agreementFraction,
      resolved.agreementPassThreshold,
      resolved.agreementWatchThreshold,
    ),
  };
}

export function summarizeSensorReliabilityRmaRegression(
  series: PatSeries,
  options: Pick<
    SensorReliabilityOptions,
    "rmaSlopeTolerancePass" | "rmaSlopeToleranceWatch" | "rmaPearsonPassThreshold" | "rmaPearsonWatchThreshold"
  > = {},
): SensorReliabilityRmaRegression {
  const resolved = { ...DEFAULT_OPTIONS, ...options };
  const pairs = series.points.filter((point) => finiteNumber(point.pm25A) && finiteNumber(point.pm25B));
  const regression = reducedMajorAxisRegression(
    pairs.map((point) => point.pm25A!),
    pairs.map((point) => point.pm25B!),
  );
  if (!regression) return null;

  const slopeDistance = Math.abs(regression.slope - 1);
  const pearson = Math.abs(regression.pearsonR);
  const category =
    slopeDistance <= resolved.rmaSlopeTolerancePass && pearson >= resolved.rmaPearsonPassThreshold
      ? "pass"
      : slopeDistance <= resolved.rmaSlopeToleranceWatch && pearson >= resolved.rmaPearsonWatchThreshold
        ? "watch"
        : "fail";

  return {
    slope: round(regression.slope, 6),
    intercept: round(regression.intercept, 6),
    pearsonR: round(regression.pearsonR, 6),
    n: regression.n,
    category,
  };
}

export function summarizeBarkjohnAvailability(series: PatSeries): BarkjohnAvailabilitySummary {
  let cf1Points = 0;
  let rhPoints = 0;
  let correctedPoints = 0;

  for (const point of series.points) {
    const cf1 = meanCf1(point);
    const humidity = finiteNumber(point.humidity) ? point.humidity : null;
    if (cf1 !== null) cf1Points++;
    if (humidity !== null) rhPoints++;
    if (
      cf1 !== null &&
      humidity !== null &&
      applyPurpleAirCorrection({
        pm25: cf1,
        humidity,
        inputBasis: "cf_1",
        profileId: "epa-barkjohn-2021-cf1",
      }) !== null
    ) {
      correctedPoints++;
    }
  }

  const denominator = Math.max(series.points.length, 1);
  return {
    inputBasis: "cf_1",
    profileId: "epa-barkjohn-2021-cf1",
    cf1Availability: fraction(cf1Points, denominator),
    rhAvailability: fraction(rhPoints, denominator),
    correctedAvailability: fraction(correctedPoints, denominator),
    cf1Points,
    rhPoints,
    correctedPoints,
  };
}

function trendSlope(xs: readonly number[], ys: readonly number[]): number | null {
  if (xs.length !== ys.length || xs.length < 3) return null;
  const meanX = average(xs);
  const meanY = average(ys);
  if (meanX === null || meanY === null) return null;
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - meanX;
    numerator += dx * (ys[i] - meanY);
    denominator += dx * dx;
  }
  return denominator === 0 ? null : numerator / denominator;
}

export function summarizeSensorReliabilityDrift(
  series: PatSeries,
  options: Pick<SensorReliabilityOptions, "driftDeltaPerDayWatchThreshold" | "driftDeltaPerDayFailThreshold"> = {},
): SensorReliabilityDriftTrend {
  const resolved = { ...DEFAULT_OPTIONS, ...options };
  const metrics = calculateEnhancedSohIndex(series).metrics
    .filter((metric) => Number.isFinite(new Date(`${metric.date}T00:00:00Z`).getTime()))
    .sort((a, b) => a.date.localeCompare(b.date));
  const xs = metrics.map((metric) => new Date(`${metric.date}T00:00:00Z`).getTime() / 86_400_000);
  const ys = metrics.map((metric) => metric.meanAbsoluteChannelDelta);
  const slope = trendSlope(xs, ys);
  const startValue = ys.length ? round(ys[0]) : null;
  const endValue = ys.length ? round(ys[ys.length - 1]) : null;

  if (slope === null) {
    return {
      days: metrics.length,
      metric: "meanAbsoluteChannelDelta",
      slopePerDay: null,
      startValue,
      endValue,
      direction: "unavailable",
      category: "watch",
    };
  }

  const roundedSlope = round(slope, 6);
  const direction =
    roundedSlope > resolved.driftDeltaPerDayWatchThreshold
      ? "degrading"
      : roundedSlope < -resolved.driftDeltaPerDayWatchThreshold
        ? "improving"
        : "stable";
  const category =
    roundedSlope >= resolved.driftDeltaPerDayFailThreshold
      ? "fail"
      : roundedSlope >= resolved.driftDeltaPerDayWatchThreshold
        ? "watch"
        : "pass";

  return {
    days: metrics.length,
    metric: "meanAbsoluteChannelDelta",
    slopePerDay: roundedSlope,
    startValue,
    endValue,
    direction,
    category,
  };
}

function buildIssues(
  report: Omit<SensorReliabilityReport, "category" | "issues">,
  options: Required<Pick<
    SensorReliabilityOptions,
    | "completenessPassThreshold"
    | "completenessWatchThreshold"
    | "barkjohnPassThreshold"
    | "barkjohnWatchThreshold"
  >>,
): SensorReliabilityIssue[] {
  const issues: SensorReliabilityIssue[] = [];

  if (report.completeness.pairedCompleteness < options.completenessWatchThreshold) {
    issues.push({
      code: "low-paired-completeness",
      severity: "fail",
      message: "Paired A/B PM2.5 completeness is below the fail threshold.",
    });
  } else if (report.completeness.pairedCompleteness < options.completenessPassThreshold) {
    issues.push({
      code: "reduced-paired-completeness",
      severity: "watch",
      message: "Paired A/B PM2.5 completeness is below the pass threshold.",
    });
  }

  if (report.agreement.category !== "pass") {
    issues.push({
      code: "channel-disagreement",
      severity: report.agreement.category,
      message: "A/B channel agreement falls below the configured reliability threshold.",
      count: report.agreement.invalidPairs,
    });
  }

  if (report.rmaRegression === null) {
    issues.push({
      code: "rma-unavailable",
      severity: "watch",
      message: "RMA regression is unavailable because fewer than three finite A/B pairs were present.",
    });
  } else if (report.rmaRegression.category !== "pass") {
    issues.push({
      code: "rma-out-of-range",
      severity: report.rmaRegression.category,
      message: "A/B RMA regression slope or correlation is outside the pass range.",
    });
  }

  if (report.barkjohn.correctedAvailability < options.barkjohnWatchThreshold) {
    issues.push({
      code: "barkjohn-unavailable",
      severity: "fail",
      message: "EPA/Barkjohn-corrected PM2.5 availability is below the fail threshold.",
    });
  } else if (report.barkjohn.correctedAvailability < options.barkjohnPassThreshold) {
    issues.push({
      code: "barkjohn-limited",
      severity: "watch",
      message: "EPA/Barkjohn-corrected PM2.5 availability is below the pass threshold.",
    });
  }

  if (report.drift.category !== "pass") {
    issues.push({
      code: report.drift.direction === "unavailable" ? "drift-unavailable" : "drift-degrading",
      severity: report.drift.category,
      message: report.drift.direction === "unavailable"
        ? "Drift trend needs at least three daily SOH buckets."
        : "Mean absolute A/B channel delta is increasing over time.",
    });
  }

  if (report.sohIndex.status === "poor") {
    issues.push({
      code: "soh-poor",
      severity: "fail",
      message: "Enhanced state-of-health index is poor.",
    });
  } else if (report.sohIndex.status === "watch") {
    issues.push({
      code: "soh-watch",
      severity: "watch",
      message: "Enhanced state-of-health index is in watch status.",
    });
  }

  return issues;
}

export function summarizeSensorReliability(
  series: PatSeries,
  options: SensorReliabilityOptions = {},
): SensorReliabilityReport {
  const resolved = { ...DEFAULT_OPTIONS, ...options };
  const completeness = summarizeSensorReliabilityCompleteness(series, resolved);
  const agreement = summarizeSensorReliabilityAgreement(series, resolved);
  const rmaRegression = summarizeSensorReliabilityRmaRegression(series, resolved);
  const barkjohn = summarizeBarkjohnAvailability(series);
  const drift = summarizeSensorReliabilityDrift(series, resolved);
  const soh = calculateEnhancedSohIndex(series);

  const baseReport = {
    sensorId: series.meta.sensorId,
    label: series.meta.label,
    completeness,
    agreement,
    rmaRegression,
    barkjohn,
    drift,
    sohIndex: {
      index: soh.index,
      status: soh.status,
    },
  };
  const issues = buildIssues(baseReport, resolved);
  const category = worstCategory([
    thresholdCategory(
      completeness.pairedCompleteness,
      resolved.completenessPassThreshold,
      resolved.completenessWatchThreshold,
    ),
    agreement.category,
    rmaRegression?.category ?? "watch",
    thresholdCategory(
      barkjohn.correctedAvailability,
      resolved.barkjohnPassThreshold,
      resolved.barkjohnWatchThreshold,
    ),
    drift.category,
    soh.status === "poor" ? "fail" : soh.status === "watch" ? "watch" : "pass",
    ...issues.map((issue) => issue.severity),
  ]);

  return {
    ...baseReport,
    category,
    issues,
  };
}
