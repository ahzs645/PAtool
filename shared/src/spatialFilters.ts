/**
 * `pas_filterArea` / `pas_filterNear` from AirSensor — geographic
 * filters for a sensor collection.
 */

import type { Point2D, Rect } from "./polygonClip";
import { pointInPolygon } from "./polygonClip";

export type GeoSensor = {
  id: string;
  latitude: number;
  longitude: number;
  [key: string]: unknown;
};

export function filterSensorsByBoundingBox<T extends GeoSensor>(
  sensors: ReadonlyArray<T>,
  rect: Rect,
): T[] {
  return sensors.filter((s) =>
    Number.isFinite(s.latitude) && Number.isFinite(s.longitude)
    && s.longitude >= rect.minX && s.longitude <= rect.maxX
    && s.latitude >= rect.minY && s.latitude <= rect.maxY,
  );
}

export function filterSensorsByPolygon<T extends GeoSensor>(
  sensors: ReadonlyArray<T>,
  polygon: ReadonlyArray<Point2D>,
): T[] {
  return sensors.filter((s) =>
    Number.isFinite(s.latitude) && Number.isFinite(s.longitude)
    && pointInPolygon({ x: s.longitude, y: s.latitude }, polygon),
  );
}

export type NearestSensorMatch<T extends GeoSensor> = {
  sensor: T;
  distanceKm: number;
};

const EARTH_R = 6371;
function toRad(d: number): number { return (d * Math.PI) / 180; }

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(a));
}

/** `pas_filterNear(lat, lon, radius)` — sensors within `radiusKm`. */
export function filterSensorsWithinRadius<T extends GeoSensor>(
  sensors: ReadonlyArray<T>,
  lat: number,
  lon: number,
  radiusKm: number,
): NearestSensorMatch<T>[] {
  return sensors
    .map((s) => ({ sensor: s, distanceKm: haversineKm(lat, lon, s.latitude, s.longitude) }))
    .filter((m) => Number.isFinite(m.distanceKm) && m.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

/** Pick the nearest sensor (or null). */
export function nearestSensor<T extends GeoSensor>(
  sensors: ReadonlyArray<T>,
  lat: number,
  lon: number,
): NearestSensorMatch<T> | null {
  let best: NearestSensorMatch<T> | null = null;
  for (const s of sensors) {
    const d = haversineKm(lat, lon, s.latitude, s.longitude);
    if (!Number.isFinite(d)) continue;
    if (best === null || d < best.distanceKm) best = { sensor: s, distanceKm: d };
  }
  return best;
}
