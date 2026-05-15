import type { PasRecord } from "./domain";

export type PasPm25Slice = "current" | "mean" | "max" | "min";

const PM25_KEYS = [
  "pm25Current",
  "pm25_10min",
  "pm25_30min",
  "pm25_1hr",
  "pm25_6hr",
  "pm25_1day",
  "pm25_1week",
] as const;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function haversineDistanceKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const radiusKm = 6371.0088;
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radiusKm * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function pasSlicePm25(record: PasRecord, slice: PasPm25Slice): number | null {
  if (slice === "current") return finite(record.pm25Current) ? record.pm25Current : null;
  const values = PM25_KEYS.map((key) => record[key]).filter(finite);
  if (!values.length) return null;
  if (slice === "max") return Math.max(...values);
  if (slice === "min") return Math.min(...values);
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function filterPasWithinRadius(
  records: ReadonlyArray<PasRecord>,
  center: { latitude: number; longitude: number },
  radiusKm: number,
): PasRecord[] {
  return records.filter((record) => haversineDistanceKm(record, center) <= radiusKm);
}

export function selectNearestPas(
  records: ReadonlyArray<PasRecord>,
  center: { latitude: number; longitude: number },
  limit: number,
): PasRecord[] {
  return [...records]
    .sort((left, right) => haversineDistanceKm(left, center) - haversineDistanceKm(right, center))
    .slice(0, Math.max(0, Math.floor(limit)));
}

export function filterPasByPm25Slice(
  records: ReadonlyArray<PasRecord>,
  slice: PasPm25Slice,
  predicate: (value: number, record: PasRecord) => boolean,
): PasRecord[] {
  return records.filter((record) => {
    const value = pasSlicePm25(record, slice);
    return value !== null && predicate(value, record);
  });
}
