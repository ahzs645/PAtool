import { formatInTimeZone } from "date-fns-tz";

import type { PatPoint, PatSeries } from "./domain";

export type PmWindowStats = {
  count: number;
  mean: number | null;
  min: number | null;
  minTime: string | null;
  max: number | null;
  maxTime: string | null;
  std: number | null;
};

export type DailySummary = {
  date: string;
  nObservations: number;
  humidityMean: number | null;
  temperatureMean: number | null;
  pressureMean: number | null;
  minutesAboveEpaThreshold: number;
  fullDay: PmWindowStats;
  morningRush: PmWindowStats;
  eveningRush: PmWindowStats;
  daytimeAmbient: PmWindowStats;
  nighttimeAmbient: PmWindowStats;
};

export type DailySummaryOptions = {
  epaDailyThreshold?: number;
  assumedMinutesPerObservation?: number;
};

const DEFAULT_EPA_THRESHOLD = 12;
const DEFAULT_MINUTES_PER_OBSERVATION = 10;

type WindowBounds = { startHour: number; endHour: number; endMinute?: number };

const WINDOWS: Record<"morningRush" | "eveningRush" | "daytimeAmbient" | "nighttimeAmbient", WindowBounds> = {
  morningRush: { startHour: 6, endHour: 9 },
  eveningRush: { startHour: 15, endHour: 18, endMinute: 30 },
  daytimeAmbient: { startHour: 12, endHour: 15 },
  nighttimeAmbient: { startHour: 0, endHour: 3, endMinute: 1 },
};

function pointPm25(point: PatPoint): number | null {
  const a = point.pm25A;
  const b = point.pm25B;
  if (a === null && b === null) return null;
  if (a === null) return b ?? null;
  if (b === null) return a ?? null;
  return (a + b) / 2;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function std(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values) ?? 0;
  let sqSum = 0;
  for (const v of values) sqSum += (v - m) * (v - m);
  return Math.sqrt(sqSum / (values.length - 1));
}

function round(value: number | null, digits = 3): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function localTimeOfDay(timestamp: string, timezone: string): string {
  return formatInTimeZone(new Date(timestamp), timezone, "HH:mm:ss");
}

function localHourMinute(timestamp: string, timezone: string): { hour: number; minute: number } {
  const hm = formatInTimeZone(new Date(timestamp), timezone, "HH:mm");
  const [h, m] = hm.split(":");
  return { hour: Number(h), minute: Number(m) };
}

function inWindow(hour: number, minute: number, window: WindowBounds): boolean {
  if (hour < window.startHour) return false;
  if (hour > window.endHour) return false;
  if (hour === window.endHour && window.endMinute !== undefined && minute > window.endMinute) {
    return false;
  }
  return true;
}

function computeWindowStats(
  points: PatPoint[],
  timezone: string,
  window: WindowBounds,
): PmWindowStats {
  const filtered: Array<{ ts: string; value: number }> = [];
  for (const point of points) {
    const pm = pointPm25(point);
    if (pm === null) continue;
    const { hour, minute } = localHourMinute(point.timestamp, timezone);
    if (!inWindow(hour, minute, window)) continue;
    filtered.push({ ts: point.timestamp, value: pm });
  }

  return statsFromPmPoints(filtered, timezone);
}

function statsFromPmPoints(
  entries: Array<{ ts: string; value: number }>,
  timezone: string,
): PmWindowStats {
  if (entries.length === 0) {
    return { count: 0, mean: null, min: null, minTime: null, max: null, maxTime: null, std: null };
  }

  let min = Infinity;
  let max = -Infinity;
  let minTs = entries[0].ts;
  let maxTs = entries[0].ts;
  const values: number[] = [];
  for (const entry of entries) {
    values.push(entry.value);
    if (entry.value < min) {
      min = entry.value;
      minTs = entry.ts;
    }
    if (entry.value > max) {
      max = entry.value;
      maxTs = entry.ts;
    }
  }

  return {
    count: entries.length,
    mean: round(mean(values), 3),
    min: round(min, 3),
    minTime: localTimeOfDay(minTs, timezone),
    max: round(max, 3),
    maxTime: localTimeOfDay(maxTs, timezone),
    std: round(std(values), 3),
  };
}

function groupByLocalDate(series: PatSeries): Map<string, PatPoint[]> {
  const buckets = new Map<string, PatPoint[]>();
  for (const point of series.points) {
    const day = formatInTimeZone(new Date(point.timestamp), series.meta.timezone, "yyyy-MM-dd");
    const existing = buckets.get(day);
    if (existing) existing.push(point);
    else buckets.set(day, [point]);
  }
  return buckets;
}

export function computeDailySummaries(
  series: PatSeries,
  options: DailySummaryOptions = {},
): DailySummary[] {
  const threshold = options.epaDailyThreshold ?? DEFAULT_EPA_THRESHOLD;
  const minutesPerObs = options.assumedMinutesPerObservation ?? DEFAULT_MINUTES_PER_OBSERVATION;
  const buckets = groupByLocalDate(series);
  const tz = series.meta.timezone;

  const summaries: DailySummary[] = [];
  for (const [date, points] of buckets) {
    const pmEntries: Array<{ ts: string; value: number }> = [];
    const humidity: number[] = [];
    const temperature: number[] = [];
    const pressure: number[] = [];
    let minutesAbove = 0;

    for (const point of points) {
      const pm = pointPm25(point);
      if (pm !== null) {
        pmEntries.push({ ts: point.timestamp, value: pm });
        if (pm > threshold) minutesAbove += minutesPerObs;
      }
      if (point.humidity !== null && point.humidity !== undefined) humidity.push(point.humidity);
      if (point.temperature !== null && point.temperature !== undefined) temperature.push(point.temperature);
      if (point.pressure !== null && point.pressure !== undefined) pressure.push(point.pressure);
    }

    summaries.push({
      date,
      nObservations: points.length,
      humidityMean: round(mean(humidity), 3),
      temperatureMean: round(mean(temperature), 3),
      pressureMean: round(mean(pressure), 3),
      minutesAboveEpaThreshold: minutesAbove,
      fullDay: statsFromPmPoints(pmEntries, tz),
      morningRush: computeWindowStats(points, tz, WINDOWS.morningRush),
      eveningRush: computeWindowStats(points, tz, WINDOWS.eveningRush),
      daytimeAmbient: computeWindowStats(points, tz, WINDOWS.daytimeAmbient),
      nighttimeAmbient: computeWindowStats(points, tz, WINDOWS.nighttimeAmbient),
    });
  }

  summaries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return summaries;
}
