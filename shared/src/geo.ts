export type GeoPoint = {
  id?: string;
  longitude: number;
  latitude: number;
};

export type Bounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type NearestSite<T extends GeoPoint> = {
  site: T;
  distanceMeters: number;
};

const EARTH_RADIUS_METERS = 6_371_000;
const TO_RADIANS = Math.PI / 180;

function finiteCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  if (
    !finiteCoordinate(a.longitude) ||
    !finiteCoordinate(a.latitude) ||
    !finiteCoordinate(b.longitude) ||
    !finiteCoordinate(b.latitude)
  ) {
    return Number.POSITIVE_INFINITY;
  }

  const phi1 = a.latitude * TO_RADIANS;
  const phi2 = b.latitude * TO_RADIANS;
  const dPhi = (b.latitude - a.latitude) * TO_RADIANS;
  const dLambda = (b.longitude - a.longitude) * TO_RADIANS;
  const h = Math.sin(dPhi / 2) ** 2
    + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function nearestSite<T extends GeoPoint>(
  point: GeoPoint,
  sites: readonly T[],
  options: { excludeId?: string } = {},
): NearestSite<T> | null {
  let best: NearestSite<T> | null = null;
  for (const site of sites) {
    if (options.excludeId && site.id === options.excludeId) continue;
    const distance = distanceMeters(point, site);
    if (!Number.isFinite(distance)) continue;
    if (!best || distance < best.distanceMeters) {
      best = { site, distanceMeters: distance };
    }
  }
  return best;
}

export function pointInBounds(point: GeoPoint, bounds: Bounds): boolean {
  return point.longitude >= bounds.west
    && point.longitude <= bounds.east
    && point.latitude >= bounds.south
    && point.latitude <= bounds.north;
}

export function pointInPolygon(point: GeoPoint, polygon: readonly GeoPoint[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const pi = polygon[i];
    const pj = polygon[j];
    const intersects = ((pi.latitude > point.latitude) !== (pj.latitude > point.latitude))
      && point.longitude < ((pj.longitude - pi.longitude) * (point.latitude - pi.latitude))
        / (pj.latitude - pi.latitude || Number.EPSILON) + pi.longitude;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function clipLineToBounds(
  start: GeoPoint,
  end: GeoPoint,
  bounds: Bounds,
): [GeoPoint, GeoPoint] | null {
  const dx = end.longitude - start.longitude;
  const dy = end.latitude - start.latitude;
  let t0 = 0;
  let t1 = 1;
  const tests: Array<[number, number]> = [
    [-dx, start.longitude - bounds.west],
    [dx, bounds.east - start.longitude],
    [-dy, start.latitude - bounds.south],
    [dy, bounds.north - start.latitude],
  ];

  for (const [p, q] of tests) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }

  return [
    {
      id: start.id,
      longitude: start.longitude + t0 * dx,
      latitude: start.latitude + t0 * dy,
    },
    {
      id: end.id,
      longitude: start.longitude + t1 * dx,
      latitude: start.latitude + t1 * dy,
    },
  ];
}
