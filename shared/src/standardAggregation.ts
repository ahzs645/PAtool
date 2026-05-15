export type TimeBucket = "hour" | "day" | "month";

export type MeasurementRow = {
  id: string;
  timestamp: string;
  value: number | null;
  longitude?: number;
  latitude?: number;
  flagged?: boolean;
};

export type AggregatedMeasurementRow = {
  id: string;
  bucket: string;
  count: number;
  missing: number;
  flagged: number;
  mean: number | null;
  min: number | null;
  p25: number | null;
  median: number | null;
  p75: number | null;
  max: number | null;
  longitude?: number;
  latitude?: number;
};

export type SiteSummaryRow = {
  id: string;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  count: number;
  missingPercent: number;
  mean: number | null;
  min: number | null;
  p25: number | null;
  median: number | null;
  p75: number | null;
  max: number | null;
};

function bucketTimestamp(timestamp: string, bucket: TimeBucket): string {
  if (bucket === "hour") return timestamp.slice(0, 13);
  if (bucket === "month") return timestamp.slice(0, 7);
  return timestamp.slice(0, 10);
}

function quantile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function stats(values: readonly number[]): Pick<AggregatedMeasurementRow, "mean" | "min" | "p25" | "median" | "p75" | "max"> {
  const usable = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (usable.length === 0) {
    return { mean: null, min: null, p25: null, median: null, p75: null, max: null };
  }
  return {
    mean: usable.reduce((sum, value) => sum + value, 0) / usable.length,
    min: usable[0],
    p25: quantile(usable, 0.25),
    median: quantile(usable, 0.5),
    p75: quantile(usable, 0.75),
    max: usable[usable.length - 1],
  };
}

export function aggregateMeasurements(
  rows: readonly MeasurementRow[],
  bucket: TimeBucket,
): AggregatedMeasurementRow[] {
  const groups = new Map<string, MeasurementRow[]>();
  for (const row of rows) {
    const key = `${row.id}\u0000${bucketTimestamp(row.timestamp, bucket)}`;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  return [...groups.values()]
    .map((group) => {
      const first = group[0];
      const values = group
        .map((row) => row.value)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
      return {
        id: first.id,
        bucket: bucketTimestamp(first.timestamp, bucket),
        count: values.length,
        missing: group.length - values.length,
        flagged: group.filter((row) => row.flagged).length,
        ...stats(values),
        longitude: first.longitude,
        latitude: first.latitude,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id) || a.bucket.localeCompare(b.bucket));
}

export function summarizeSites(rows: readonly MeasurementRow[]): SiteSummaryRow[] {
  const groups = new Map<string, MeasurementRow[]>();
  for (const row of rows) {
    const group = groups.get(row.id);
    if (group) group.push(row);
    else groups.set(row.id, [row]);
  }

  return [...groups.entries()]
    .map(([id, group]) => {
      const timestamps = group.map((row) => row.timestamp).sort();
      const values = group
        .map((row) => row.value)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
      return {
        id,
        firstTimestamp: timestamps[0] ?? null,
        lastTimestamp: timestamps.at(-1) ?? null,
        count: values.length,
        missingPercent: group.length === 0 ? 0 : ((group.length - values.length) / group.length) * 100,
        ...stats(values),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}
