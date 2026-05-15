import type { SentinelNormalizedRecord } from "./sentinelIngest";
import type { SentinelQaFlag } from "./qaFlags";

export type MeasurementRow = {
  id: string;
  timestamp: string;
  value: number | null;
  longitude?: number;
  latitude?: number;
  flagged?: boolean;
};

export type MeasurementAggregatePeriod = "hour" | "day";

export type MeasurementAggregate = {
  id: string;
  bucket: string;
  count: number;
  missing: number;
  flagged: number;
  mean: number | null;
  min: number | null;
  max: number | null;
};

export type SentinelAggregatedRecord = {
  sensorId: string;
  timestamp: string;
  signal: number | null;
  correctedSignal?: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  temperature: number | null;
  humidity: number | null;
  latitude: number | null;
  longitude: number | null;
  canister: string | null;
  qaFlags: SentinelQaFlag[];
  count: number;
};

export type SentinelAggregationOptions = {
  intervalMinutes?: number;
  baseline?: readonly number[];
};

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number | null, digits = 3): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function finite(values: Array<number | null>): number[] {
  return values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function bucketStart(timestamp: string, intervalMinutes: number): string {
  const date = new Date(timestamp);
  const intervalMs = intervalMinutes * 60_000;
  return new Date(Math.floor(date.getTime() / intervalMs) * intervalMs).toISOString();
}

function uniqueText(values: Array<string | null>): string | null {
  const unique = [...new Set(values.filter((value): value is string => Boolean(value)))];
  return unique.length ? unique.join(", ") : null;
}

function uniqueFlags(records: readonly SentinelNormalizedRecord[]): SentinelQaFlag[] {
  return [...new Set(records.flatMap((record) => record.qaFlags))];
}

function measurementBucket(timestamp: string, period: MeasurementAggregatePeriod): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return timestamp;
  return period === "day" ? date.toISOString().slice(0, 10) : date.toISOString().slice(0, 13);
}

export function aggregateMeasurements(
  rows: readonly MeasurementRow[],
  period: MeasurementAggregatePeriod = "hour",
): MeasurementAggregate[] {
  const buckets = new Map<string, MeasurementRow[]>();
  for (const row of rows) {
    const bucket = measurementBucket(row.timestamp, period);
    const key = `${row.id}::${bucket}`;
    buckets.set(key, [...(buckets.get(key) ?? []), row]);
  }

  return [...buckets.entries()]
    .map<MeasurementAggregate>(([key, bucketRows]) => {
      const [id, bucket] = key.split("::");
      const values = bucketRows
        .map((row) => row.value)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
      return {
        id,
        bucket,
        count: values.length,
        missing: bucketRows.length - values.length,
        flagged: bucketRows.filter((row) => row.flagged).length,
        mean: round(mean(values)),
        min: values.length ? round(Math.min(...values)) : null,
        max: values.length ? round(Math.max(...values)) : null,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id) || a.bucket.localeCompare(b.bucket));
}

export function aggregateSentinelRecords(
  records: readonly SentinelNormalizedRecord[],
  options: SentinelAggregationOptions = {},
): SentinelAggregatedRecord[] {
  const interval = options.intervalMinutes ?? 5;
  const buckets = new Map<string, SentinelNormalizedRecord[]>();

  records.forEach((record, index) => {
    if (!record.timestamp || !Number.isFinite(new Date(record.timestamp).getTime())) return;
    const key = `${record.sensorId}::${bucketStart(record.timestamp, interval)}`;
    const enriched = options.baseline?.[index] === undefined
      ? record
      : { ...record, signal: record.signal === null ? null : record.signal - options.baseline[index] };
    buckets.set(key, [...(buckets.get(key) ?? []), enriched]);
  });

  const aggregated = [...buckets.entries()].map<SentinelAggregatedRecord>(([key, bucket]) => {
    const [, timestamp] = key.split("::");
    const windU: number[] = [];
    const windV: number[] = [];
    for (const record of bucket) {
      if (record.windSpeed === null || record.windDirection === null) continue;
      windU.push(record.windSpeed * Math.sin((2 * Math.PI * record.windDirection) / 360));
      windV.push(record.windSpeed * Math.cos((2 * Math.PI * record.windDirection) / 360));
    }
    const u = mean(windU);
    const v = mean(windV);
    const windDirection = u === null || v === null ? null : (Math.atan2(-u, -v) * 180) / Math.PI + 180;

    return {
      sensorId: bucket[0].sensorId,
      timestamp,
      signal: round(mean(finite(bucket.map((record) => record.signal)))),
      windSpeed: round(mean(finite(bucket.map((record) => record.windSpeed)))),
      windDirection: round(windDirection === null ? null : ((windDirection % 360) + 360) % 360),
      temperature: round(mean(finite(bucket.map((record) => record.temperature)))),
      humidity: round(mean(finite(bucket.map((record) => record.humidity)))),
      latitude: round(mean(finite(bucket.map((record) => record.latitude))), 6),
      longitude: round(mean(finite(bucket.map((record) => record.longitude))), 6),
      canister: uniqueText(bucket.map((record) => record.canister)),
      qaFlags: uniqueFlags(bucket),
      count: bucket.length,
    };
  });

  return aggregated.sort((a, b) => a.sensorId.localeCompare(b.sensorId) || a.timestamp.localeCompare(b.timestamp));
}
