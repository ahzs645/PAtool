import { formatISO } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

import type { LinearFitResult, PatPoint, PatSeries, QcResult } from "./domain";

export type AirSensorQcProfileId = "AB_00" | "AB_01" | "AB_02" | "AB_03";

export type AirSensorQcOptions = {
  profileId?: AirSensorQcProfileId;
  removeOutOfSpec?: boolean;
  minCount?: number;
  maxPValue?: number;
  maxMeanDiff?: number;
  maxMad?: number;
  maxRelativePercentDiff?: number;
  maxHumidity?: number;
};

export type AirSensorOutOfSpecSummary = {
  pm25A: number;
  pm25B: number;
  humidity: number;
  temperature: number;
  highHumidityPm: number;
};

export type AirSensorDailyChannelMetrics = {
  pm25A: number;
  pm25B: number;
  humidity: number;
  temperature: number;
};

export type AirSensorDailyMetrics = {
  date: string;
  reporting: AirSensorDailyChannelMetrics;
  valid: AirSensorDailyChannelMetrics;
  dcSignal: AirSensorDailyChannelMetrics;
  abFit: LinearFitResult | null;
  abPValue: number | null;
  airSensorIndex: number;
};

export type AirSensorSohCompatResult = {
  sensorId: string;
  samplingIntervalSeconds: number;
  expectedSamplesPerDay: number;
  metrics: AirSensorDailyMetrics[];
  averageReporting: number;
  averageValid: number;
  averageDcSignal: number;
  averageAbRSquared: number | null;
  airSensorIndex: number;
};

export type CalendarPaletteMode = "aqi" | "scaqmd";

export type CalendarPm25Day = {
  date: string;
  pm25: number | null;
  count: number;
  expectedCount: number;
  completeness: number;
  color: string;
  label: string;
};

export type CalendarPm25Result = {
  sensorId: string;
  timezone: string;
  palette: CalendarPaletteMode;
  dataThreshold: number;
  days: CalendarPm25Day[];
};

const AIRSENSOR_PM25_MAX = 2000;
const AIRSENSOR_TEMP_MIN_F = -40;
const AIRSENSOR_TEMP_MAX_F = 185;

const AQI_COLORS = [
  { max: 9, color: "#2e9d5b", label: "Good" },
  { max: 35.4, color: "#f0c419", label: "Moderate" },
  { max: 55.4, color: "#f2994a", label: "USG" },
  { max: 125.4, color: "#d64545", label: "Unhealthy" },
  { max: 225.4, color: "#7d3c98", label: "Very Unhealthy" },
  { max: Infinity, color: "#8b0000", label: "Hazardous" },
];

const SCAQMD_COLORS = [
  { max: 12, color: "#abebff", label: "Very Low" },
  { max: 35, color: "#3b8aff", label: "Low" },
  { max: 55, color: "#002ade", label: "Medium" },
  { max: 75, color: "#9f00de", label: "High" },
  { max: Infinity, color: "#6b0096", label: "Very High" },
];

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function mean(values: readonly number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function standardDeviation(values: readonly number[]): number | null {
  const avg = mean(values);
  if (avg === null || values.length < 2) return null;
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function linearFit(xs: readonly number[], ys: readonly number[]): LinearFitResult | null {
  if (xs.length !== ys.length || xs.length < 3) return null;
  const xMean = mean(xs);
  const yMean = mean(ys);
  if (xMean === null || yMean === null) return null;
  let ssXX = 0;
  let ssXY = 0;
  let ssYY = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const dx = xs[i] - xMean;
    const dy = ys[i] - yMean;
    ssXX += dx * dx;
    ssXY += dx * dy;
    ssYY += dy * dy;
  }
  if (ssXX === 0) return null;
  return {
    slope: round(ssXY / ssXX, 6),
    intercept: round(yMean - (ssXY / ssXX) * xMean, 6),
    rSquared: ssYY === 0 ? 0 : round((ssXY * ssXY) / (ssXX * ssYY), 6),
    n: xs.length,
  };
}

function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

function welchPValue(a: readonly number[], b: readonly number[]): number | null {
  if (a.length < 2 || b.length < 2) return null;
  const ma = mean(a);
  const mb = mean(b);
  const sa = standardDeviation(a);
  const sb = standardDeviation(b);
  if (ma === null || mb === null || sa === null || sb === null) return null;
  const se = Math.sqrt((sa * sa) / a.length + (sb * sb) / b.length);
  if (se === 0) return 1;
  const t = Math.abs((ma - mb) / se);
  return round(2 * (1 - normalCdf(t)), 6);
}

function inferSamplingIntervalSeconds(points: readonly PatPoint[]): number {
  const deltas = points
    .slice(1)
    .map((point, index) => new Date(point.timestamp).getTime() - new Date(points[index].timestamp).getTime())
    .filter((delta) => delta > 0)
    .sort((a, b) => a - b);
  if (!deltas.length) return 3600;
  return Math.max(1, Math.round((deltas[Math.floor(deltas.length / 2)] ?? 3_600_000) / 1000));
}

function dayBuckets(series: PatSeries): Map<string, PatPoint[]> {
  const buckets = new Map<string, PatPoint[]>();
  for (const point of series.points) {
    const key = formatInTimeZone(new Date(point.timestamp), series.meta.timezone, "yyyy-MM-dd");
    const bucket = buckets.get(key) ?? [];
    bucket.push(point);
    buckets.set(key, bucket);
  }
  return buckets;
}

function isValidPm(value: number | null | undefined): value is number {
  return finite(value) && value >= 0 && value <= AIRSENSOR_PM25_MAX;
}

function isValidHumidity(value: number | null | undefined): value is number {
  return finite(value) && value >= 0 && value <= 100;
}

function isValidTemperature(value: number | null | undefined): value is number {
  return finite(value) && value >= AIRSENSOR_TEMP_MIN_F && value <= AIRSENSOR_TEMP_MAX_F;
}

function pct(count: number, denominator: number): number {
  return round((count / Math.max(denominator, 1)) * 100);
}

function channelCounts(points: readonly PatPoint[], expected: number): AirSensorDailyChannelMetrics {
  return {
    pm25A: pct(points.filter((point) => finite(point.pm25A)).length, expected),
    pm25B: pct(points.filter((point) => finite(point.pm25B)).length, expected),
    humidity: pct(points.filter((point) => finite(point.humidity)).length, expected),
    temperature: pct(points.filter((point) => finite(point.temperature)).length, expected),
  };
}

function validCounts(points: readonly PatPoint[]): AirSensorDailyChannelMetrics {
  return {
    pm25A: pct(points.filter((point) => isValidPm(point.pm25A)).length, points.filter((point) => finite(point.pm25A)).length),
    pm25B: pct(points.filter((point) => isValidPm(point.pm25B)).length, points.filter((point) => finite(point.pm25B)).length),
    humidity: pct(points.filter((point) => isValidHumidity(point.humidity)).length, points.filter((point) => finite(point.humidity)).length),
    temperature: pct(points.filter((point) => isValidTemperature(point.temperature)).length, points.filter((point) => finite(point.temperature)).length),
  };
}

function dcCounts(points: readonly PatPoint[]): AirSensorDailyChannelMetrics {
  const countDc = (selector: (point: PatPoint) => number | null | undefined) => {
    const hourly = new Map<string, number[]>();
    for (const point of points) {
      const key = point.timestamp.slice(0, 13);
      const value = selector(point);
      if (!finite(value)) continue;
      const bucket = hourly.get(key) ?? [];
      bucket.push(value);
      hourly.set(key, bucket);
    }
    const values = [...hourly.values()];
    return pct(values.filter((bucket) => bucket.length > 1 && standardDeviation(bucket) === 0).length, 24);
  };

  return {
    pm25A: countDc((point) => point.pm25A),
    pm25B: countDc((point) => point.pm25B),
    humidity: countDc((point) => point.humidity),
    temperature: countDc((point) => point.temperature),
  };
}

function averageChannelMetric(metrics: readonly AirSensorDailyChannelMetrics[]): number {
  const values = metrics.flatMap((metric) => [metric.pm25A, metric.pm25B, metric.humidity, metric.temperature]);
  return round(mean(values) ?? 0);
}

export function summarizeAirSensorOutOfSpec(series: PatSeries, maxHumidity = 95): AirSensorOutOfSpecSummary {
  return series.points.reduce<AirSensorOutOfSpecSummary>(
    (summary, point) => {
      if (finite(point.pm25A) && !isValidPm(point.pm25A)) summary.pm25A += 1;
      if (finite(point.pm25B) && !isValidPm(point.pm25B)) summary.pm25B += 1;
      if (finite(point.humidity) && !isValidHumidity(point.humidity)) summary.humidity += 1;
      if (finite(point.temperature) && !isValidTemperature(point.temperature)) summary.temperature += 1;
      if (finite(point.humidity) && point.humidity > maxHumidity && (finite(point.pm25A) || finite(point.pm25B))) {
        summary.highHumidityPm += 1;
      }
      return summary;
    },
    { pm25A: 0, pm25B: 0, humidity: 0, temperature: 0, highHumidityPm: 0 },
  );
}

export function calculateAirSensorDailyMetrics(
  series: PatSeries,
  options: { samplingIntervalSeconds?: number } = {},
): AirSensorSohCompatResult {
  const samplingIntervalSeconds = options.samplingIntervalSeconds ?? inferSamplingIntervalSeconds(series.points);
  const expectedSamplesPerDay = Math.max(1, Math.round((24 * 3600) / samplingIntervalSeconds));
  const metrics = [...dayBuckets(series).entries()].map<AirSensorDailyMetrics>(([date, points]) => {
    const pairs = points.filter((point) => isValidPm(point.pm25A) && isValidPm(point.pm25B));
    const a = pairs.map((point) => point.pm25A!);
    const b = pairs.map((point) => point.pm25B!);
    const abFit = linearFit(a, b);
    const reporting = channelCounts(points, expectedSamplesPerDay);
    const valid = validCounts(points);
    const dcSignal = dcCounts(points);
    const meanReporting = mean([reporting.pm25A, reporting.pm25B, reporting.humidity, reporting.temperature]) ?? 0;
    const airSensorIndex = meanReporting < 75 ? 0 : round((abFit?.rSquared ?? 0) * 100);

    return {
      date,
      reporting,
      valid,
      dcSignal,
      abFit,
      abPValue: welchPValue(a, b),
      airSensorIndex,
    };
  });

  const r2Values = metrics.map((metric) => metric.abFit?.rSquared).filter(finite);
  const airSensorIndex = round(mean(metrics.map((metric) => metric.airSensorIndex)) ?? 0);

  return {
    sensorId: series.meta.sensorId,
    samplingIntervalSeconds,
    expectedSamplesPerDay,
    metrics,
    averageReporting: averageChannelMetric(metrics.map((metric) => metric.reporting)),
    averageValid: averageChannelMetric(metrics.map((metric) => metric.valid)),
    averageDcSignal: averageChannelMetric(metrics.map((metric) => metric.dcSignal)),
    averageAbRSquared: r2Values.length ? round(mean(r2Values)!, 4) : null,
    airSensorIndex,
  };
}

function pointMeanPm25(point: PatPoint): number | null {
  if (isValidPm(point.pm25A) && isValidPm(point.pm25B)) return (point.pm25A + point.pm25B) / 2;
  if (isValidPm(point.pm25A)) return point.pm25A;
  if (isValidPm(point.pm25B)) return point.pm25B;
  return null;
}

function calendarBand(value: number | null, palette: CalendarPaletteMode): Pick<CalendarPm25Day, "color" | "label"> {
  if (value === null) return { color: "#94a3b8", label: "Insufficient data" };
  const bands = palette === "scaqmd" ? SCAQMD_COLORS : AQI_COLORS;
  const band = bands.find((entry) => value <= entry.max) ?? bands.at(-1)!;
  return { color: band.color, label: band.label };
}

export function buildCalendarPm25(
  series: PatSeries,
  options: { palette?: CalendarPaletteMode; dataThreshold?: number; samplingIntervalSeconds?: number } = {},
): CalendarPm25Result {
  const palette = options.palette ?? "aqi";
  const dataThreshold = options.dataThreshold ?? 50;
  const samplingIntervalSeconds = options.samplingIntervalSeconds ?? inferSamplingIntervalSeconds(series.points);
  const expectedCount = Math.max(1, Math.round((24 * 3600) / samplingIntervalSeconds));

  const days = [...dayBuckets(series).entries()].map<CalendarPm25Day>(([date, points]) => {
    const values = points.map(pointMeanPm25).filter(finite);
    const completeness = pct(values.length, expectedCount);
    const pm25 = completeness >= dataThreshold ? round(mean(values) ?? 0) : null;
    const band = calendarBand(pm25, palette);

    return {
      date,
      pm25,
      count: values.length,
      expectedCount,
      completeness,
      color: band.color,
      label: band.label,
    };
  });

  return {
    sensorId: series.meta.sensorId,
    timezone: series.meta.timezone,
    palette,
    dataThreshold,
    days,
  };
}

function bucketHour(series: PatSeries, point: PatPoint): string {
  const day = formatInTimeZone(new Date(point.timestamp), series.meta.timezone, "yyyy-MM-dd");
  const hour = formatInTimeZone(new Date(point.timestamp), series.meta.timezone, "HH");
  return formatISO(fromZonedTime(`${day}T${hour}:00:00`, series.meta.timezone));
}

export function runAirSensorQc(series: PatSeries, options: AirSensorQcOptions = {}): QcResult {
  const {
    profileId = "AB_03",
    removeOutOfSpec = false,
    minCount = 20,
    maxPValue = 1e-4,
    maxMeanDiff = 10,
    maxMad = 5,
    maxRelativePercentDiff = 61,
    maxHumidity = 95,
  } = options;
  const outOfSpec = summarizeAirSensorOutOfSpec(series, maxHumidity);
  const failedHours = new Set<string>();
  const hourly = new Map<string, PatPoint[]>();

  for (const point of series.points) {
    const bucket = hourly.get(bucketHour(series, point)) ?? [];
    bucket.push(point);
    hourly.set(bucketHour(series, point), bucket);
  }

  for (const [hour, points] of hourly.entries()) {
    const pairs = points.filter((point) => isValidPm(point.pm25A) && isValidPm(point.pm25B));
    const a = pairs.map((point) => point.pm25A!);
    const b = pairs.map((point) => point.pm25B!);
    if (profileId === "AB_00" && (a.length < minCount || b.length < minCount)) failedHours.add(hour);
    if (profileId === "AB_01" || profileId === "AB_02" || profileId === "AB_03") {
      const p = welchPValue(a, b);
      const meanDiff = Math.abs((mean(a) ?? 0) - (mean(b) ?? 0));
      if (a.length < minCount || b.length < minCount || (p !== null && p < maxPValue && meanDiff > maxMeanDiff)) {
        failedHours.add(hour);
      }
    }
    if (profileId === "AB_02" || profileId === "AB_03") {
      const diffs = pairs.map((point) => Math.abs(point.pm25A! - point.pm25B!));
      const med = median(diffs) ?? 0;
      const mad = median(diffs.map((diff) => Math.abs(diff - med))) ?? 0;
      const relDiff = pairs
        .map((point) => {
          const denominator = point.pm25A! + point.pm25B!;
          return denominator > 0 ? (Math.abs(point.pm25A! - point.pm25B!) * 2 * 100) / denominator : 0;
        })
        .filter(finite);
      if (mad > maxMad || (mean(relDiff) ?? 0) > maxRelativePercentDiff) failedHours.add(hour);
    }
  }

  const flagged = new Set<number>();
  series.points.forEach((point, index) => {
    if (!isValidPm(point.pm25A) || !isValidPm(point.pm25B)) flagged.add(index);
    if (finite(point.humidity) && (!isValidHumidity(point.humidity) || point.humidity > maxHumidity)) flagged.add(index);
    if (finite(point.temperature) && !isValidTemperature(point.temperature)) flagged.add(index);
    if (failedHours.has(bucketHour(series, point))) flagged.add(index);
  });

  let removedPoints = 0;
  const cleanedSeries: PatSeries = {
    ...series,
    points: series.points.map((point, index) => {
      if (!removeOutOfSpec || !flagged.has(index)) return point;
      removedPoints += 1;
      return { ...point, pm25A: null, pm25B: null };
    }),
  };

  const flaggedPoints = flagged.size;
  const status = flaggedPoints === 0 ? "ok" : flaggedPoints / Math.max(series.points.length, 1) > 0.2 ? "fail" : "warning";

  return {
    sensorId: series.meta.sensorId,
    totalPoints: series.points.length,
    flaggedPoints,
    removedPoints,
    status,
    issues: [
      { code: "airsensor-ab-profile", message: `${profileId} hourly A/B profile flagged incompatible channel behavior.`, count: failedHours.size },
      { code: "pm25-out-of-spec", message: "PM2.5 values outside AirSensor physical bounds [0, 2000].", count: outOfSpec.pm25A + outOfSpec.pm25B },
      { code: "humidity-out-of-spec", message: "Humidity values outside [0, 100] or above PM interpretation threshold.", count: outOfSpec.humidity + outOfSpec.highHumidityPm },
      { code: "temperature-out-of-spec", message: "Temperature values outside [-40, 185] F.", count: outOfSpec.temperature },
    ].filter((issue) => issue.count > 0),
    cleanedSeries,
  };
}
