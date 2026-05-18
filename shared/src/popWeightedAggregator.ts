// ---------------------------------------------------------------------------
// popWeightedAggregator — algorithm-side of biteSizedAQ's
// `process_yearly_raw_pop_weighted_pol`. Inputs are already-parsed lat/lon
// grids (one of pollutant, one of population) and an admin-unit polygon
// set; output is the population-weighted pollutant mean per admin unit.
//
// The NetCDF reader stays injected (netcdfjs, GDAL Python pre-process, etc.)
// so this module remains pure-TS and unit-testable. A simple bounding-box
// pre-filter avoids touching cells far from any admin unit.
// ---------------------------------------------------------------------------

import { pointInPolygon, type Bounds } from "./geo";

export type GeoGrid = {
  /** Length = nRows × nCols, row-major. */
  values: ReadonlyArray<number | null>;
  nRows: number;
  nCols: number;
  /** Cell south-west corner for the (0, 0) cell. */
  originLatitude: number;
  originLongitude: number;
  /** Cell sizes in degrees. */
  cellSizeLatitude: number;
  cellSizeLongitude: number;
};

export type AdminUnit = {
  id: string;
  name?: string;
  polygon: ReadonlyArray<{ latitude: number; longitude: number }>;
  bounds?: Bounds;
};

export type AdminAggregation = {
  unitId: string;
  unitName?: string;
  cellCount: number;
  totalPopulation: number;
  populationWeightedMean: number;
  unweightedMean: number;
};

export function aggregatePopulationWeightedPollutant(
  pollutant: GeoGrid,
  population: GeoGrid | null,
  units: readonly AdminUnit[],
): AdminAggregation[] {
  if (pollutant.nRows === 0 || pollutant.nCols === 0) return [];
  const usePop = population !== null;
  const out: AdminAggregation[] = [];
  for (const unit of units) {
    const bounds = unit.bounds ?? boundsOf(unit.polygon);
    let totalPop = 0;
    let weightedSum = 0;
    let unweightedSum = 0;
    let cellCount = 0;
    for (let row = 0; row < pollutant.nRows; row += 1) {
      const lat = pollutant.originLatitude + (row + 0.5) * pollutant.cellSizeLatitude;
      if (lat < bounds.south || lat > bounds.north) continue;
      for (let col = 0; col < pollutant.nCols; col += 1) {
        const lon = pollutant.originLongitude + (col + 0.5) * pollutant.cellSizeLongitude;
        if (lon < bounds.west || lon > bounds.east) continue;
        const value = pollutant.values[row * pollutant.nCols + col];
        if (value === null || !Number.isFinite(value)) continue;
        if (!pointInPolygon({ latitude: lat, longitude: lon }, unit.polygon)) continue;
        cellCount += 1;
        unweightedSum += value;
        if (usePop) {
          const popValue = sampleGrid(population!, lat, lon);
          if (popValue !== null && Number.isFinite(popValue) && popValue > 0) {
            totalPop += popValue;
            weightedSum += popValue * value;
          }
        }
      }
    }
    out.push({
      unitId: unit.id,
      unitName: unit.name,
      cellCount,
      totalPopulation: totalPop,
      populationWeightedMean: usePop && totalPop > 0 ? weightedSum / totalPop : (cellCount > 0 ? unweightedSum / cellCount : 0),
      unweightedMean: cellCount > 0 ? unweightedSum / cellCount : 0,
    });
  }
  return out;
}

function sampleGrid(grid: GeoGrid, latitude: number, longitude: number): number | null {
  const row = Math.floor((latitude - grid.originLatitude) / grid.cellSizeLatitude);
  const col = Math.floor((longitude - grid.originLongitude) / grid.cellSizeLongitude);
  if (row < 0 || row >= grid.nRows || col < 0 || col >= grid.nCols) return null;
  const value = grid.values[row * grid.nCols + col];
  return typeof value === "number" ? value : null;
}

function boundsOf(polygon: ReadonlyArray<{ latitude: number; longitude: number }>): Bounds {
  let west = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  for (const point of polygon) {
    if (point.longitude < west) west = point.longitude;
    if (point.longitude > east) east = point.longitude;
    if (point.latitude < south) south = point.latitude;
    if (point.latitude > north) north = point.latitude;
  }
  return { west, east, south, north };
}
