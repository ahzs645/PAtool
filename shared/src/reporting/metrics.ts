import { formatInTimeZone } from "date-fns-tz";

import type { PatPoint, PatSeries } from "../domain";
import {
  DEFAULT_PURPLEAIR_REPORT_QC_SETTINGS,
  type ReportDailyMetric,
  type ReportDiurnalProfile,
  type ReportMonthlyMetric,
  type ReportPeriod,
  type ReportQcSettings,
  type ReportSeason,
  type ReportSeasonalCapture,
  type ReportSensorMetrics,
} from "./types";

type HourlyMetric = {
  sensorId: string;
  timestamp: string;
  date: string;
  month: string;
  season: ReportSeason;
  seasonYear: number;
  hour: number;
  meanPm25: number;
};

type DateRange = {
  startDate: string | null;
  endDate: string | null;
};

const SEASONS: readonly ReportSeason[] = ["winter", "spring", "summer", "fall"];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function round(value: number | null, digits = 3): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values: readonly number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: readonly number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const clamped = Math.max(0, Math.min(1, fraction));
  const position = (sorted.length - 1) * clamped;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function parseBoundary(value: string | undefined, endOfDay: boolean): number | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    parsed.setUTCHours(23, 59, 59, 999);
  }
  return parsed.getTime();
}

function pointWithinPeriod(point: PatPoint, period: ReportPeriod): boolean {
  const timestamp = new Date(point.timestamp).getTime();
  if (!Number.isFinite(timestamp)) return false;
  const start = parseBoundary(period.start, false);
  const end = parseBoundary(period.end, true);
  if (start !== null && timestamp < start) return false;
  if (end !== null && timestamp > end) return false;
  return true;
}

function dateKeyForTimestamp(timestamp: string, timezone: string): string | null {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return null;
  return formatInTimeZone(date, timezone, "yyyy-MM-dd");
}

function dateKeyForBoundary(value: string | undefined, timezone: string): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return dateKeyForTimestamp(value, timezone);
}

function nextDateKey(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function enumerateDateKeys(startDate: string | null, endDate: string | null): string[] {
  if (!startDate || !endDate || startDate > endDate) return [];
  const keys: string[] = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    keys.push(cursor);
    cursor = nextDateKey(cursor);
  }
  return keys;
}

function reportSeasonForMonth(month: number): ReportSeason {
  if (month === 12 || month <= 2) return "winter";
  if (month <= 5) return "spring";
  if (month <= 8) return "summer";
  return "fall";
}

function reportSeasonYear(year: number, month: number): number {
  if (month === 12) return year;
  if (month <= 2) return year - 1;
  return year;
}

function dateParts(dateKey: string): { year: number; month: number } {
  return {
    year: Number(dateKey.slice(0, 4)),
    month: Number(dateKey.slice(5, 7)),
  };
}

function seasonBucketKey(dateKey: string): string {
  const { year, month } = dateParts(dateKey);
  return `${reportSeasonYear(year, month)}:${reportSeasonForMonth(month)}`;
}

function validPointPm25(point: PatPoint, qc: ReportQcSettings): number | null {
  if (!isFiniteNumber(point.pm25A) || !isFiniteNumber(point.pm25B)) return null;

  const average = (point.pm25A + point.pm25B) / 2;
  if (!Number.isFinite(average) || average < 0) return null;

  const absoluteDifference = Math.abs(point.pm25A - point.pm25B);
  if (
    absoluteDifference > qc.absoluteChannelDifference &&
    absoluteDifference > qc.relativeChannelDifference * Math.max(average, 0.001)
  ) {
    return null;
  }

  const humidity = point.humidity;
  if (isFiniteNumber(humidity)) {
    if (humidity < qc.minRelativeHumidity || humidity > qc.maxRelativeHumidity) return null;
  } else if (qc.requireRelativeHumidity) {
    return null;
  }

  return average;
}

function computeDateRange(series: PatSeries, period: ReportPeriod, hourly: readonly HourlyMetric[]): DateRange {
  const timezone = series.meta.timezone;
  const firstHourly = hourly[0]?.date ?? null;
  const lastHourly = hourly.at(-1)?.date ?? null;
  const firstPointDate = series.points.find((point) => pointWithinPeriod(point, period));
  const lastPointDate = [...series.points].reverse().find((point) => pointWithinPeriod(point, period));

  return {
    startDate:
      dateKeyForBoundary(period.start, timezone) ??
      firstHourly ??
      (firstPointDate ? dateKeyForTimestamp(firstPointDate.timestamp, timezone) : null),
    endDate:
      dateKeyForBoundary(period.end, timezone) ??
      lastHourly ??
      (lastPointDate ? dateKeyForTimestamp(lastPointDate.timestamp, timezone) : null),
  };
}

function computeHourlyMetrics(series: PatSeries, qc: ReportQcSettings, period: ReportPeriod): HourlyMetric[] {
  const timezone = series.meta.timezone;
  const buckets = new Map<string, number[]>();

  for (const point of series.points) {
    if (!pointWithinPeriod(point, period)) continue;
    const value = validPointPm25(point, qc);
    if (value === null) continue;
    const date = new Date(point.timestamp);
    const hourKey = formatInTimeZone(date, timezone, "yyyy-MM-dd'T'HH");
    const values = buckets.get(hourKey) ?? [];
    values.push(value);
    buckets.set(hourKey, values);
  }

  return [...buckets.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([hourKey, values]) => {
      const date = hourKey.slice(0, 10);
      const { year, month } = dateParts(date);
      return {
        sensorId: series.meta.sensorId,
        timestamp: `${hourKey}:00`,
        date,
        month: date.slice(0, 7),
        season: reportSeasonForMonth(month),
        seasonYear: reportSeasonYear(year, month),
        hour: Number(hourKey.slice(11, 13)),
        meanPm25: mean(values) ?? 0,
      };
    });
}

function computeDailyMetrics(
  sensorId: string,
  hourly: readonly HourlyMetric[],
  expectedDates: readonly string[],
  qc: ReportQcSettings,
): ReportDailyMetric[] {
  const byDate = new Map<string, HourlyMetric[]>();
  for (const row of hourly) {
    const existing = byDate.get(row.date) ?? [];
    existing.push(row);
    byDate.set(row.date, existing);
  }

  const dates = expectedDates.length ? expectedDates : [...byDate.keys()].sort();
  return dates.map((date) => {
    const rows = byDate.get(date) ?? [];
    const validHourCount = rows.length;
    const meetsDailyCapture = validHourCount >= qc.minDailyValidHours;
    return {
      sensorId,
      date,
      meanPm25: meetsDailyCapture ? round(mean(rows.map((row) => row.meanPm25))) : null,
      validHourCount,
      meetsDailyCapture,
    };
  });
}

function countExpectedByMonth(expectedDates: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const date of expectedDates) {
    const month = date.slice(0, 7);
    counts.set(month, (counts.get(month) ?? 0) + 1);
  }
  return counts;
}

function computeMonthlyMetrics(
  sensorId: string,
  daily: readonly ReportDailyMetric[],
  expectedDates: readonly string[],
  qc: ReportQcSettings,
): ReportMonthlyMetric[] {
  const expectedByMonth = countExpectedByMonth(expectedDates);
  const months = new Set([...expectedByMonth.keys(), ...daily.map((row) => row.date.slice(0, 7))]);

  return [...months]
    .sort()
    .map((month) => {
      const rows = daily.filter((row) => row.date.startsWith(month) && row.meanPm25 !== null);
      const values = rows.map((row) => row.meanPm25).filter(isFiniteNumber);
      const expectedDailyCount = expectedByMonth.get(month) ?? rows.length;
      return {
        sensorId,
        month,
        meanPm25: round(mean(values)),
        p98DailyPm25: round(percentile(values, qc.percentile)),
        validDailyCount: values.length,
        expectedDailyCount,
        captureFraction: expectedDailyCount > 0 ? round(values.length / expectedDailyCount, 4) ?? 0 : 0,
      };
    });
}

function computeSeasonalCapture(
  sensorId: string,
  daily: readonly ReportDailyMetric[],
  expectedDates: readonly string[],
  qc: ReportQcSettings,
): ReportSeasonalCapture[] {
  const expectedBySeason = new Map<string, number>();
  for (const date of expectedDates) {
    const key = seasonBucketKey(date);
    expectedBySeason.set(key, (expectedBySeason.get(key) ?? 0) + 1);
  }

  const validBySeason = new Map<string, number>();
  for (const row of daily) {
    if (row.meanPm25 === null) continue;
    const key = seasonBucketKey(row.date);
    validBySeason.set(key, (validBySeason.get(key) ?? 0) + 1);
  }

  const keys = new Set([...expectedBySeason.keys(), ...validBySeason.keys()]);
  return [...keys]
    .sort()
    .map((key) => {
      const [seasonYearRaw, seasonRaw] = key.split(":");
      const validDailyCount = validBySeason.get(key) ?? 0;
      const expectedDailyCount = expectedBySeason.get(key) ?? validDailyCount;
      const captureFraction = expectedDailyCount > 0 ? validDailyCount / expectedDailyCount : 0;
      return {
        sensorId,
        season: seasonRaw as ReportSeason,
        seasonYear: Number(seasonYearRaw),
        validDailyCount,
        expectedDailyCount,
        captureFraction: round(captureFraction, 4) ?? 0,
        meetsThreshold: captureFraction >= qc.seasonalCaptureThreshold,
      };
    })
    .sort((left, right) => {
      if (left.seasonYear !== right.seasonYear) return left.seasonYear - right.seasonYear;
      return SEASONS.indexOf(left.season) - SEASONS.indexOf(right.season);
    });
}

function computeDiurnalProfiles(sensorId: string, hourly: readonly HourlyMetric[]): ReportDiurnalProfile[] {
  const groups = new Map<string, number[]>();
  for (const row of hourly) {
    const key = `${row.seasonYear}:${row.season}:${row.hour}`;
    const values = groups.get(key) ?? [];
    values.push(row.meanPm25);
    groups.set(key, values);
  }

  return [...groups.entries()]
    .map(([key, values]) => {
      const [seasonYearRaw, seasonRaw, hourRaw] = key.split(":");
      return {
        sensorId,
        season: seasonRaw as ReportSeason,
        seasonYear: Number(seasonYearRaw),
        hour: Number(hourRaw),
        meanPm25: round(mean(values)),
        count: values.length,
      };
    })
    .sort((left, right) => {
      if (left.seasonYear !== right.seasonYear) return left.seasonYear - right.seasonYear;
      const seasonDelta = SEASONS.indexOf(left.season) - SEASONS.indexOf(right.season);
      return seasonDelta || left.hour - right.hour;
    });
}

export function computeReportSensorMetrics(
  series: PatSeries,
  period: ReportPeriod = {},
  qcSettings: Partial<ReportQcSettings> = {},
): ReportSensorMetrics {
  const qc = { ...DEFAULT_PURPLEAIR_REPORT_QC_SETTINGS, ...qcSettings };
  const hourly = computeHourlyMetrics(series, qc, period);
  const range = computeDateRange(series, period, hourly);
  const expectedDates = enumerateDateKeys(range.startDate, range.endDate);
  const daily = computeDailyMetrics(series.meta.sensorId, hourly, expectedDates, qc);
  const validDailyValues = daily.map((row) => row.meanPm25).filter(isFiniteNumber);
  const expectedDailyCount = expectedDates.length || daily.length;
  const validDailyCount = validDailyValues.length;
  const warnings: string[] = [];

  if (validDailyCount === 0) {
    warnings.push("No valid daily means after QC and data-capture rules.");
  }
  if (expectedDailyCount > 0 && validDailyCount / expectedDailyCount < qc.annualCaptureThreshold) {
    warnings.push("Daily capture is below the annual/report-period threshold.");
  }

  return {
    sensorId: series.meta.sensorId,
    label: series.meta.label,
    timezone: series.meta.timezone,
    firstTimestamp: hourly[0]?.timestamp ?? null,
    lastTimestamp: hourly.at(-1)?.timestamp ?? null,
    validHourlyCount: hourly.length,
    validDailyCount,
    expectedDailyCount,
    dailyCaptureFraction: expectedDailyCount > 0 ? round(validDailyCount / expectedDailyCount, 4) ?? 0 : 0,
    meanPm25: round(mean(validDailyValues)),
    medianDailyPm25: round(percentile(validDailyValues, 0.5)),
    p98DailyPm25: round(percentile(validDailyValues, qc.percentile)),
    monthly: computeMonthlyMetrics(series.meta.sensorId, daily, expectedDates, qc),
    seasonalCapture: computeSeasonalCapture(series.meta.sensorId, daily, expectedDates, qc),
    diurnalProfiles: computeDiurnalProfiles(series.meta.sensorId, hourly),
    daily,
    warnings,
  };
}
