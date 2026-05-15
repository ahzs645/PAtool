import { formatInTimeZone } from "date-fns-tz";

import { calculateNowCast, type NowCastResult, type PatPoint, type PatSeries } from "./domain";

export type PatCurrentStatus = {
  sensorId: string;
  label: string;
  timezone: string;
  generatedAt: string;
  lastValidTimestamp: string | null;
  lastValidLocalTime: string | null;
  previousValidTimestamp: string | null;
  latencyMinutes: number | null;
  currentPm25: number | null;
  previousPm25: number | null;
  deltaPm25: number | null;
  yesterdayMeanPm25: number | null;
  nowCast: NowCastResult;
  status: "current" | "stale" | "offline" | "empty";
};

export type PatCurrentStatusOptions = {
  now?: string | Date;
  staleAfterMinutes?: number;
};

function pointPm25(point: PatPoint): number | null {
  const a = point.pm25A;
  const b = point.pm25B;
  if (a === null && b === null) return null;
  if (a === null || a === undefined) return b ?? null;
  if (b === null || b === undefined) return a ?? null;
  return (a + b) / 2;
}

function round(value: number | null, digits = 3): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function summarizePatCurrentStatus(
  series: PatSeries,
  options: PatCurrentStatusOptions = {},
): PatCurrentStatus {
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  const generatedAt = now.toISOString();
  const staleAfterMinutes = options.staleAfterMinutes ?? 180;
  const points = [...series.points].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const valid = points
    .map((point) => ({ point, pm25: pointPm25(point) }))
    .filter((entry): entry is { point: PatPoint; pm25: number } => typeof entry.pm25 === "number" && Number.isFinite(entry.pm25));
  const last = valid.at(-1) ?? null;
  const previous = valid.at(-2) ?? null;
  const latencyMinutes = last
    ? Math.max(0, (now.getTime() - new Date(last.point.timestamp).getTime()) / 60_000)
    : null;
  const yesterday = formatInTimeZone(new Date(now.getTime() - 24 * 60 * 60 * 1000), series.meta.timezone, "yyyy-MM-dd");
  const yesterdayValues = valid
    .filter((entry) => formatInTimeZone(new Date(entry.point.timestamp), series.meta.timezone, "yyyy-MM-dd") === yesterday)
    .map((entry) => entry.pm25);
  const currentPm25 = last?.pm25 ?? null;
  const previousPm25 = previous?.pm25 ?? null;

  return {
    sensorId: series.meta.sensorId,
    label: series.meta.label,
    timezone: series.meta.timezone,
    generatedAt,
    lastValidTimestamp: last?.point.timestamp ?? null,
    lastValidLocalTime: last ? formatInTimeZone(new Date(last.point.timestamp), series.meta.timezone, "yyyy-MM-dd HH:mm zzz") : null,
    previousValidTimestamp: previous?.point.timestamp ?? null,
    latencyMinutes: round(latencyMinutes, 1),
    currentPm25: round(currentPm25, 3),
    previousPm25: round(previousPm25, 3),
    deltaPm25: round(currentPm25 !== null && previousPm25 !== null ? currentPm25 - previousPm25 : null, 3),
    yesterdayMeanPm25: round(mean(yesterdayValues), 3),
    nowCast: calculateNowCast(valid.map((entry) => ({ timestamp: entry.point.timestamp, pm25: entry.pm25 }))),
    status: points.length === 0
      ? "empty"
      : !last
        ? "offline"
        : latencyMinutes !== null && latencyMinutes > staleAfterMinutes
          ? "stale"
          : "current",
  };
}
