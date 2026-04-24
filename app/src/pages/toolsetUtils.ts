import type { AreaBounds, InterpolationPoint, PasCollection, PasRecord } from "@patool/shared";

export const SENSOR_VALUE_FIELDS: Array<{ value: keyof PasRecord; label: string }> = [
  { value: "pm25Current", label: "PM2.5 current" },
  { value: "pm25_10min", label: "PM2.5 10 min" },
  { value: "pm25_30min", label: "PM2.5 30 min" },
  { value: "pm25_1hr", label: "PM2.5 1 hour" },
  { value: "pm25_6hr", label: "PM2.5 6 hour" },
  { value: "pm25_1day", label: "PM2.5 1 day" },
];

export function buildOutdoorInterpolationPoints(
  collection: PasCollection | undefined,
  field: keyof PasRecord,
  limit = 80,
): InterpolationPoint[] {
  if (!collection) return [];
  const points: InterpolationPoint[] = [];
  for (const record of collection.records) {
    if (record.locationType === "inside") continue;
    const value = record[field];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    if (!Number.isFinite(record.latitude) || !Number.isFinite(record.longitude)) continue;
    points.push({
      id: record.uniqueId ?? record.id,
      x: record.longitude,
      y: record.latitude,
      value,
      elevationMeters: record.elevationMeters,
    });
  }
  points.sort((a, b) => `${a.id ?? ""}`.localeCompare(`${b.id ?? ""}`));

  if (limit <= 0 || points.length <= limit) return points;
  const stride = points.length / limit;
  const sampled: InterpolationPoint[] = [];
  for (let i = 0; i < limit; i++) {
    sampled.push(points[Math.floor(i * stride)]);
  }
  return sampled;
}

export function deriveCollectionBounds(collection: PasCollection | undefined): AreaBounds | null {
  if (!collection) return null;
  const coords = collection.records.filter(
    (record) => Number.isFinite(record.latitude) && Number.isFinite(record.longitude),
  );
  if (!coords.length) return null;
  const padding = 0.1;
  return {
    north: Math.max(...coords.map((record) => record.latitude)) + padding,
    south: Math.min(...coords.map((record) => record.latitude)) - padding,
    east: Math.max(...coords.map((record) => record.longitude)) + padding,
    west: Math.min(...coords.map((record) => record.longitude)) - padding,
  };
}

export function formatMetric(value: number | null | undefined, digits = 2): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "-";
}

export function percent(value: number | null | undefined, digits = 0): string {
  return typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : "-";
}
