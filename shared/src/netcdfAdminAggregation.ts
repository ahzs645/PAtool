/**
 * NetCDF → administrative-unit aggregation scaffold, ported from
 * biteSizedAQ's `process_yearly_raw_pop_weighted_pol()`. Operates on
 * already-decoded raster cell rows so it can run in the worker without
 * NetCDF parsing. A separate adapter is expected to feed (lat, lon,
 * value, populationWeight) tuples — for example using a thin WASM
 * NetCDF reader or pre-baked CSV exports.
 *
 * The aggregation strategy:
 *   1. For each admin unit, find raster cells intersecting it (point-
 *      in-polygon for cell centroids).
 *   2. Compute the population-weighted mean of the cell values.
 *   3. If an admin unit captures zero cells, run a second pass at finer
 *      resolution (`process_uncaptured_uids` logic): use nearest-cell
 *      fallback within `fallbackRadiusKm`.
 */

import { pointInPolygon, type Point2D } from "./polygonClip";

export type RasterCell = {
  lat: number;
  lon: number;
  value: number;
  populationWeight?: number;
};

export type AdminUnit = {
  uid: string;
  polygon: ReadonlyArray<Point2D>; // (x=lon, y=lat)
};

export type AdminAggregationOptions = {
  /** Fallback radius (km) when an admin unit captures zero cells. */
  fallbackRadiusKm?: number;
};

export type AdminAggregationRow = {
  uid: string;
  cellsCaptured: number;
  populationWeightedValue: number | null;
  fallbackUsed: boolean;
};

export type AdminAggregationResult = {
  rows: AdminAggregationRow[];
  capturedCells: number;
  uncapturedUnits: number;
};

const EARTH_R = 6371;
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(a));
}

export function aggregateToAdminUnits(
  cells: ReadonlyArray<RasterCell>,
  units: ReadonlyArray<AdminUnit>,
  options: AdminAggregationOptions = {},
): AdminAggregationResult {
  const fallbackKm = Math.max(0, options.fallbackRadiusKm ?? 25);
  let captured = 0;
  let uncapturedUnits = 0;
  const rows: AdminAggregationRow[] = units.map((unit) => {
    const matched = cells.filter((c) => pointInPolygon({ x: c.lon, y: c.lat }, unit.polygon));
    captured += matched.length;
    if (matched.length === 0) {
      const candidates = cells
        .map((c) => ({ c, d: nearestUnitDistance(unit, c) }))
        .sort((a, b) => a.d - b.d);
      const within = candidates.filter((p) => p.d <= fallbackKm);
      if (within.length === 0) {
        uncapturedUnits += 1;
        return { uid: unit.uid, cellsCaptured: 0, populationWeightedValue: null, fallbackUsed: true };
      }
      const value = popWeightedMean(within.map((p) => p.c));
      return { uid: unit.uid, cellsCaptured: within.length, populationWeightedValue: value, fallbackUsed: true };
    }
    return {
      uid: unit.uid,
      cellsCaptured: matched.length,
      populationWeightedValue: popWeightedMean(matched),
      fallbackUsed: false,
    };
  });
  return { rows, capturedCells: captured, uncapturedUnits };
}

function popWeightedMean(cells: ReadonlyArray<RasterCell>): number | null {
  if (cells.length === 0) return null;
  let num = 0;
  let den = 0;
  for (const c of cells) {
    const w = c.populationWeight ?? 1;
    num += c.value * w;
    den += w;
  }
  return den === 0 ? null : num / den;
}

function nearestUnitDistance(unit: AdminUnit, cell: RasterCell): number {
  let best = Infinity;
  for (const p of unit.polygon) {
    const d = haversineKm(p.y, p.x, cell.lat, cell.lon);
    if (d < best) best = d;
  }
  return best;
}
