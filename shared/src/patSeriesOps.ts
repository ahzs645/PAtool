import type { PatMeta, PatPoint, PatSeries } from "./domain";

export type PatArchiveStitchSegment = {
  sensorId: string;
  start: string;
  end: string;
  points: number;
  trimmedPoints: number;
};

export type PatArchiveStitchGap = {
  previous: string;
  next: string;
  missingIntervals: number;
};

export type PatArchiveStitchResult = {
  sensorId: string;
  series: PatSeries;
  segments: PatArchiveStitchSegment[];
  duplicateTimestampsRemoved: number;
  gaps: PatArchiveStitchGap[];
  inferredIntervalSeconds: number | null;
};

function patMetaFingerprint(meta: PatMeta): string {
  return JSON.stringify({
    sensorId: meta.sensorId,
    label: meta.label,
    timezone: meta.timezone,
    latitude: meta.latitude ?? null,
    longitude: meta.longitude ?? null,
  });
}

export function patDistinctSeries(series: PatSeries): PatSeries {
  const seen = new Set<string>();
  return {
    ...series,
    points: series.points.filter((point) => {
      if (seen.has(point.timestamp)) return false;
      seen.add(point.timestamp);
      return true;
    }),
  };
}

export function patJoinSeries(firstOrSeries: PatSeries | readonly PatSeries[], ...rest: PatSeries[]): PatSeries {
  const seriesList: PatSeries[] = (Array.isArray(firstOrSeries) ? [...firstOrSeries] : [firstOrSeries, ...rest]) as PatSeries[];
  if (!seriesList.length) {
    throw new Error("patJoin requires at least one PAT series.");
  }

  const metaKey = patMetaFingerprint(seriesList[0].meta);
  for (const series of seriesList) {
    if (!series.points.length) {
      throw new Error("patJoin cannot join empty PAT series.");
    }
    if (patMetaFingerprint(series.meta) !== metaKey) {
      throw new Error("patJoin requires identical PAT metadata.");
    }
  }

  const ordered = seriesList
    .map((series) => ({
      ...series,
      points: [...series.points].sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    }))
    .sort((a, b) => a.points[0].timestamp.localeCompare(b.points[0].timestamp));

  const trimmed = ordered.flatMap((series, index) => {
    const nextStart = ordered[index + 1]?.points[0]?.timestamp;
    return nextStart ? series.points.filter((point) => point.timestamp < nextStart) : series.points;
  });

  return patDistinctSeries({
    meta: ordered[0].meta,
    points: trimmed.sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
  });
}

function inferIntervalSeconds(points: readonly PatPoint[]): number | null {
  const deltas = points
    .slice(1)
    .map((point, index) => Date.parse(point.timestamp) - Date.parse(points[index].timestamp))
    .filter((delta) => Number.isFinite(delta) && delta > 0)
    .sort((a, b) => a - b);

  if (!deltas.length) return null;
  return Math.max(1, Math.round((deltas[Math.floor(deltas.length / 2)] ?? 0) / 1000));
}

function detectGaps(points: readonly PatPoint[], intervalSeconds: number | null): PatArchiveStitchGap[] {
  if (!intervalSeconds || points.length < 2) return [];
  const intervalMs = intervalSeconds * 1000;
  const toleranceMs = Math.max(1000, intervalMs * 0.2);
  const gaps: PatArchiveStitchGap[] = [];

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const next = points[index];
    const delta = Date.parse(next.timestamp) - Date.parse(previous.timestamp);
    if (Number.isFinite(delta) && delta > intervalMs + toleranceMs) {
      gaps.push({
        previous: previous.timestamp,
        next: next.timestamp,
        missingIntervals: Math.max(1, Math.round(delta / intervalMs) - 1),
      });
    }
  }

  return gaps;
}

export function stitchPatArchiveMonths(seriesList: readonly PatSeries[]): PatArchiveStitchResult {
  const originalPointCount = seriesList.reduce((sum, series) => sum + series.points.length, 0);
  const ordered = [...seriesList]
    .filter((series) => series.points.length > 0)
    .map((series) => ({
      ...series,
      points: [...series.points].sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    }))
    .sort((a, b) => a.points[0].timestamp.localeCompare(b.points[0].timestamp));

  const series = patJoinSeries(ordered);
  const inferredIntervalSeconds = inferIntervalSeconds(series.points);

  const segments = ordered.map<PatArchiveStitchSegment>((part, index) => {
    const nextStart = ordered[index + 1]?.points[0]?.timestamp;
    const trimmedPoints = nextStart ? part.points.filter((point) => point.timestamp < nextStart).length : part.points.length;
    return {
      sensorId: part.meta.sensorId,
      start: part.points[0].timestamp,
      end: part.points.at(-1)!.timestamp,
      points: part.points.length,
      trimmedPoints,
    };
  });

  return {
    sensorId: series.meta.sensorId,
    series,
    segments,
    duplicateTimestampsRemoved: originalPointCount - series.points.length,
    gaps: detectGaps(series.points, inferredIntervalSeconds),
    inferredIntervalSeconds,
  };
}
