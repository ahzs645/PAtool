/**
 * Sensor-coverage equity analysis.
 *
 * Combines sensor density with optional EJ indicators (population, EJ
 * index, low-income share) to flag tracts/cells that have many
 * residents and few sensors — the "high-need / no-sensor" pattern
 * highlighted by Mullen et al. 2025 (Maricopa) and Jianfeng et al.
 * 2025 (regulatory monitor equity).
 *
 * The math here is intentionally simple so it runs in the browser
 * against the generated PAS fixture and a small CSV of EJ indicators.
 * Plug a real EJScreen 2.3 download into `ejUnits` to get a publishable
 * map; the algorithm itself is lightweight enough to run at sub-second
 * latency for a few thousand tracts.
 */

export type EjAreaUnit = {
  id: string;
  /** Display name (county tract code, neighborhood label, etc). */
  label?: string;
  /** Centroid longitude (WGS84). */
  longitude: number;
  /** Centroid latitude (WGS84). */
  latitude: number;
  /** Population estimate (people). */
  population: number;
  /**
   * Optional EJ indicator on a 0-100 scale (e.g. EJScreen Supplemental
   * EJ Index percentile). Higher = greater environmental-justice need.
   */
  ejIndex?: number;
  /** Optional fraction of low-income residents in [0, 1]. */
  lowIncomeFraction?: number;
};

export type EjSensor = {
  id: string;
  longitude: number;
  latitude: number;
  /** Whether the sensor is currently online; offline sensors don't count toward coverage. */
  online?: boolean;
  /** Optional weight (e.g. multiple sensors at the same site can be down-weighted). */
  weight?: number;
};

export type CoverageGapOptions = {
  /**
   * Coverage radius in kilometers. A unit is considered "covered" by
   * each sensor whose centroid lies inside this radius. Defaults to 5 km
   * which roughly matches the urban PA siting density studied in
   * Mullen et al. 2025.
   */
  radiusKm?: number;
  /** Population threshold below which a unit is excluded from ranking. */
  minPopulation?: number;
};

export type CoverageGapRow = {
  unit: EjAreaUnit;
  /** Sensors with center within `radiusKm`. */
  sensorCount: number;
  /** Sum of sensor weights inside `radiusKm`. */
  sensorWeight: number;
  /** Sensors per 10,000 people inside `radiusKm`. */
  sensorsPer10kPop: number;
  /**
   * Composite "coverage gap score" in [0, 1]; higher = bigger gap.
   * Combines low sensor density with high EJ need: gap = w * (1 -
   * normalizedDensity) + (1 - w) * normalizedEjNeed.
   */
  gapScore: number;
  /** Distance in km to the nearest online sensor. */
  nearestSensorKm: number | null;
};

export type CoverageGapReport = {
  radiusKm: number;
  minPopulation: number;
  totalPopulation: number;
  coveredPopulation: number;
  uncoveredPopulation: number;
  rows: CoverageGapRow[];
};

const EARTH_RADIUS_KM = 6371;

function haversineKm(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function normalize(values: number[]): number[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max === min) {
    return values.map(() => 0);
  }
  return values.map((value) => (value - min) / (max - min));
}

/**
 * Score every EJ unit by how much air-quality sensor coverage it has
 * relative to its population and EJ index. Returns rows sorted by
 * `gapScore` descending so the worst-served units come first.
 */
export function computeCoverageGapReport(
  ejUnits: ReadonlyArray<EjAreaUnit>,
  sensors: ReadonlyArray<EjSensor>,
  options: CoverageGapOptions = {},
): CoverageGapReport {
  const radiusKm = options.radiusKm ?? 5;
  const minPopulation = options.minPopulation ?? 0;
  const onlineSensors = sensors.filter((sensor) => sensor.online !== false);

  const baseRows = ejUnits
    .filter((unit) => Number.isFinite(unit.population) && unit.population >= minPopulation)
    .map((unit) => {
      let sensorCount = 0;
      let sensorWeight = 0;
      let nearestKm = Number.POSITIVE_INFINITY;
      for (const sensor of onlineSensors) {
        const distance = haversineKm(unit.longitude, unit.latitude, sensor.longitude, sensor.latitude);
        if (distance < nearestKm) nearestKm = distance;
        if (distance <= radiusKm) {
          sensorCount += 1;
          sensorWeight += sensor.weight ?? 1;
        }
      }
      const sensorsPer10k = unit.population > 0 ? (sensorCount * 10_000) / unit.population : 0;
      return {
        unit,
        sensorCount,
        sensorWeight,
        sensorsPer10kPop: sensorsPer10k,
        nearestSensorKm: Number.isFinite(nearestKm) ? nearestKm : null,
      };
    });

  // Composite score combines normalized inverse density with normalized EJ
  // need; weight is 0.6/0.4 (density-leaning) by default.
  const densityValues = baseRows.map((row) => row.sensorsPer10kPop);
  const ejValues = baseRows.map((row) => row.unit.ejIndex ?? 0);
  const normDensity = normalize(densityValues);
  const normEj = normalize(ejValues);
  const rowsWithScore: CoverageGapRow[] = baseRows.map((row, i) => ({
    ...row,
    gapScore: 0.6 * (1 - normDensity[i]) + 0.4 * normEj[i],
  }));

  rowsWithScore.sort((a, b) => b.gapScore - a.gapScore);

  let totalPopulation = 0;
  let coveredPopulation = 0;
  for (const row of rowsWithScore) {
    totalPopulation += row.unit.population;
    if (row.sensorCount > 0) coveredPopulation += row.unit.population;
  }

  return {
    radiusKm,
    minPopulation,
    totalPopulation,
    coveredPopulation,
    uncoveredPopulation: totalPopulation - coveredPopulation,
    rows: rowsWithScore,
  };
}

/**
 * Convenience helper: parse a tiny CSV of EJ units shaped like
 *     id,label,latitude,longitude,population,ejIndex,lowIncomeFraction
 * Useful for stubbing in test data while the EJScreen 2.3 download
 * pipeline is wired up.
 */
export function parseEjAreaCsv(text: string): EjAreaUnit[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((cell) => cell.trim());
  const idIdx = header.indexOf("id");
  const labelIdx = header.indexOf("label");
  const latIdx = header.indexOf("latitude");
  const lonIdx = header.indexOf("longitude");
  const popIdx = header.indexOf("population");
  const ejIdx = header.indexOf("ejIndex");
  const incomeIdx = header.indexOf("lowIncomeFraction");

  return lines.slice(1).flatMap((line): EjAreaUnit[] => {
    const cells = line.split(",").map((cell) => cell.trim());
    const id = cells[idIdx];
    const latitude = Number(cells[latIdx]);
    const longitude = Number(cells[lonIdx]);
    const population = Number(cells[popIdx]);
    if (!id || !Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(population)) {
      return [];
    }
    return [{
      id,
      label: labelIdx >= 0 ? cells[labelIdx] : undefined,
      latitude,
      longitude,
      population,
      ejIndex: ejIdx >= 0 ? Number(cells[ejIdx]) : undefined,
      lowIncomeFraction: incomeIdx >= 0 ? Number(cells[incomeIdx]) : undefined,
    }];
  });
}
