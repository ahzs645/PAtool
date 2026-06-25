/**
 * Temporal aggregation helpers for the ASNAT network-summary "compare two
 * datasets" view (Barkjohn et al. 2025): daily patterns by hour-of-day and
 * day-of-week, plus averages by month-of-year. Each helper buckets a
 * timestamped series and returns the per-bucket mean and sample count.
 */

export type TimestampedValue = { timestamp: string; value: number | null | undefined };

export type PatternPoint = { key: number; label: string; mean: number | null; count: number };

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shifted(timestamp: string, offsetHours: number): Date | null {
  const t = Date.parse(timestamp);
  if (Number.isNaN(t)) return null;
  return new Date(t + offsetHours * 3_600_000);
}

function bucketMeans(
  values: readonly TimestampedValue[],
  size: number,
  labels: string[],
  bucketOf: (date: Date) => number,
  offsetHours: number,
): PatternPoint[] {
  const sums = new Array<number>(size).fill(0);
  const counts = new Array<number>(size).fill(0);
  for (const entry of values) {
    if (typeof entry.value !== "number" || !Number.isFinite(entry.value)) continue;
    const date = shifted(entry.timestamp, offsetHours);
    if (!date) continue;
    const bucket = bucketOf(date);
    sums[bucket] += entry.value;
    counts[bucket] += 1;
  }
  return Array.from({ length: size }, (_, i) => ({
    key: i,
    label: labels[i],
    mean: counts[i] > 0 ? sums[i] / counts[i] : null,
    count: counts[i],
  }));
}

export function byHourOfDay(values: readonly TimestampedValue[], offsetHours = 0): PatternPoint[] {
  return bucketMeans(values, 24, Array.from({ length: 24 }, (_, i) => `${i}:00`), (date) => date.getUTCHours(), offsetHours);
}

export function byDayOfWeek(values: readonly TimestampedValue[], offsetHours = 0): PatternPoint[] {
  return bucketMeans(values, 7, WEEKDAY_LABELS, (date) => date.getUTCDay(), offsetHours);
}

export function byMonthOfYear(values: readonly TimestampedValue[], offsetHours = 0): PatternPoint[] {
  return bucketMeans(values, 12, MONTH_LABELS, (date) => date.getUTCMonth(), offsetHours);
}

export type ComparisonPatterns = {
  hourOfDay: { a: PatternPoint[]; b: PatternPoint[] };
  dayOfWeek: { a: PatternPoint[]; b: PatternPoint[] };
  monthOfYear: { a: PatternPoint[]; b: PatternPoint[] };
};

/** Build all three temporal comparisons for two timestamped datasets. */
export function comparisonPatterns(
  a: readonly TimestampedValue[],
  b: readonly TimestampedValue[],
  offsetHours = 0,
): ComparisonPatterns {
  return {
    hourOfDay: { a: byHourOfDay(a, offsetHours), b: byHourOfDay(b, offsetHours) },
    dayOfWeek: { a: byDayOfWeek(a, offsetHours), b: byDayOfWeek(b, offsetHours) },
    monthOfYear: { a: byMonthOfYear(a, offsetHours), b: byMonthOfYear(b, offsetHours) },
  };
}
