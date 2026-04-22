import type { AreaBounds, InterpolationGrid, InterpolationPoint, PasCollection, PasFilterOptions, PasRecord } from "./domain";
import { idwInterpolate, pasFilter, pasFilterArea } from "./domain";

export type StudySensorValueField =
  | "pm25Current"
  | "pm25_10min"
  | "pm25_30min"
  | "pm25_1hr"
  | "pm25_6hr"
  | "pm25_1day"
  | "pm25_1week";

export type StudyGeometryKind = "point" | "line" | "polygon";

export type SourceDispersionConfig = {
  method: "gaussian" | "inverse-distance" | "none";
  sigmaMeters?: number;
  radiusMeters?: number;
  power?: number;
  sampleEveryMeters?: number;
};

export type SourceLayerConfig = {
  id: string;
  name: string;
  kind: StudyGeometryKind;
  url?: string;
  valueField: string;
  weightDefault: number;
  enabledDefault?: boolean;
  dispersion: SourceDispersionConfig;
};

export type ZoneLayerConfig = {
  id: string;
  name: string;
  url?: string;
  categoryField?: string;
};

export type StudyAreaConfig = {
  id: string;
  name: string;
  boundaryUrl?: string;
  bounds?: AreaBounds;
  projection: string;
  resolutionMeters: number;
  sensorProvider: "purpleair";
  sensorFilters?: PasFilterOptions;
  sensorValueField?: StudySensorValueField;
  sourceLayers: SourceLayerConfig[];
  zoneLayers: ZoneLayerConfig[];
};

export type StudyRasterGrid = InterpolationGrid & {
  resolutionMeters: number;
  cellWidthMeters: number;
  cellHeightMeters: number;
};

export type StudySourceFeatureCollection = {
  type: "FeatureCollection";
  features: StudySourceFeature[];
};

export type StudySourceFeature = {
  type: "Feature";
  geometry: StudyGeometry | null;
  properties?: Record<string, unknown> | null;
};

export type StudyGeometry =
  | { type: "Point"; coordinates: Position }
  | { type: "MultiPoint"; coordinates: Position[] }
  | { type: "LineString"; coordinates: Position[] }
  | { type: "MultiLineString"; coordinates: Position[][] }
  | { type: "Polygon"; coordinates: Position[][] }
  | { type: "MultiPolygon"; coordinates: Position[][][] };

export type StudyLayerGrid = {
  layer: SourceLayerConfig;
  grid: StudyRasterGrid;
  normalizedGrid: StudyRasterGrid;
  sourceFeatureCount: number;
  sampleCount: number;
};

export type StudyValidationMetrics = {
  n: number;
  rmse: number;
  mae: number;
  bias: number;
  minResidual: number;
  maxResidual: number;
};

export type SensorSitingCandidate = {
  rank: number;
  row: number;
  col: number;
  latitude: number;
  longitude: number;
  predictedValue: number;
  normalizedValue: number;
  nearestSensorKm: number | null;
  coverageGapScore: number;
  score: number;
};

export type SensorSitingOptions = {
  candidateCount?: number;
  minSpacingKm?: number;
  pollutionWeight?: number;
  coverageWeight?: number;
  coverageRadiusKm?: number;
  excludeExistingWithinKm?: number;
  maxCandidatePool?: number;
};

type Position = [number, number, ...number[]];

type WeightedSample = {
  x: number;
  y: number;
  value: number;
};

const EARTH_RADIUS_M = 6_371_000;
const DEFAULT_MAX_GRID_CELLS = 40_000;
const DEFAULT_SOURCE_SAMPLE_LIMIT = 8_000;

export function createStudyAreaFromSensors(
  collection: PasCollection,
  options: {
    id?: string;
    name?: string;
    resolutionMeters?: number;
    sensorFilters?: PasFilterOptions;
    sensorValueField?: StudySensorValueField;
    projection?: string;
  } = {},
): StudyAreaConfig {
  const filtered = pasFilter(collection, options.sensorFilters ?? { isOutside: true });
  return {
    id: options.id ?? "current-purpleair-coverage",
    name: options.name ?? "Current PurpleAir coverage",
    projection: options.projection ?? "WGS84 display grid",
    resolutionMeters: options.resolutionMeters ?? 1_000,
    sensorProvider: "purpleair",
    sensorFilters: options.sensorFilters ?? { isOutside: true },
    sensorValueField: options.sensorValueField ?? "pm25_1hr",
    bounds: deriveStudyBoundsFromSensors(filtered),
    sourceLayers: [],
    zoneLayers: [],
  };
}

export function deriveStudyBoundsFromSensors(
  collection: PasCollection,
  options: { paddingRatio?: number; minimumSpanDegrees?: number } = {},
): AreaBounds {
  const records = collection.records.filter(
    (record) => Number.isFinite(record.latitude) && Number.isFinite(record.longitude),
  );
  const paddingRatio = options.paddingRatio ?? 0.12;
  const minimumSpanDegrees = options.minimumSpanDegrees ?? 0.08;

  if (!records.length) {
    return { west: -125, east: -66, south: 24, north: 50 };
  }

  let west = Math.min(...records.map((record) => record.longitude));
  let east = Math.max(...records.map((record) => record.longitude));
  let south = Math.min(...records.map((record) => record.latitude));
  let north = Math.max(...records.map((record) => record.latitude));

  const lonSpan = Math.max(east - west, minimumSpanDegrees);
  const latSpan = Math.max(north - south, minimumSpanDegrees);
  const lonCenter = (west + east) / 2;
  const latCenter = (south + north) / 2;
  const lonPad = lonSpan * paddingRatio;
  const latPad = latSpan * paddingRatio;

  west = lonCenter - lonSpan / 2 - lonPad;
  east = lonCenter + lonSpan / 2 + lonPad;
  south = latCenter - latSpan / 2 - latPad;
  north = latCenter + latSpan / 2 + latPad;

  return { west, east, south, north };
}

export function deriveStudyBoundsFromSources(
  collections: StudySourceFeatureCollection[],
  options: { paddingRatio?: number; minimumSpanDegrees?: number } = {},
): AreaBounds | null {
  const positions: Position[] = [];
  for (const collection of collections) {
    for (const feature of collection.features) {
      if (feature.geometry) collectGeometryPositions(feature.geometry, positions);
    }
  }
  if (!positions.length) return null;

  const paddingRatio = options.paddingRatio ?? 0.12;
  const minimumSpanDegrees = options.minimumSpanDegrees ?? 0.02;
  let west = Math.min(...positions.map((position) => position[0]));
  let east = Math.max(...positions.map((position) => position[0]));
  let south = Math.min(...positions.map((position) => position[1]));
  let north = Math.max(...positions.map((position) => position[1]));

  const lonSpan = Math.max(east - west, minimumSpanDegrees);
  const latSpan = Math.max(north - south, minimumSpanDegrees);
  const lonCenter = (west + east) / 2;
  const latCenter = (south + north) / 2;
  const lonPad = lonSpan * paddingRatio;
  const latPad = latSpan * paddingRatio;

  west = lonCenter - lonSpan / 2 - lonPad;
  east = lonCenter + lonSpan / 2 + lonPad;
  south = latCenter - latSpan / 2 - latPad;
  north = latCenter + latSpan / 2 + latPad;

  return { west, east, south, north };
}

export function buildStudyGrid(
  bounds: AreaBounds,
  resolutionMeters: number,
  maxCells = DEFAULT_MAX_GRID_CELLS,
): StudyRasterGrid {
  const centerLat = (bounds.north + bounds.south) / 2;
  const widthMeters = Math.max(distanceMeters(bounds.west, centerLat, bounds.east, centerLat), resolutionMeters);
  const heightMeters = Math.max(distanceMeters(bounds.west, bounds.south, bounds.west, bounds.north), resolutionMeters);

  let width = Math.max(2, Math.ceil(widthMeters / resolutionMeters));
  let height = Math.max(2, Math.ceil(heightMeters / resolutionMeters));

  const cells = width * height;
  if (cells > maxCells) {
    const scale = Math.sqrt(maxCells / cells);
    width = Math.max(2, Math.floor(width * scale));
    height = Math.max(2, Math.floor(height * scale));
  }

  return {
    width,
    height,
    bounds,
    resolutionMeters,
    cellWidthMeters: widthMeters / Math.max(width - 1, 1),
    cellHeightMeters: heightMeters / Math.max(height - 1, 1),
    values: new Float64Array(width * height),
    min: 0,
    max: 0,
  };
}

export function pasRecordsToStudyPoints(
  records: PasRecord[],
  valueField: StudySensorValueField = "pm25_1hr",
): InterpolationPoint[] {
  return records.flatMap((record): InterpolationPoint[] => {
    const value = sensorValue(record, valueField);
    if (
      value == null
      || !Number.isFinite(value)
      || !Number.isFinite(record.longitude)
      || !Number.isFinite(record.latitude)
    ) {
      return [];
    }

    return [{
      id: record.id,
      x: record.longitude,
      y: record.latitude,
      value,
      elevationMeters: record.elevationMeters ?? null,
    }];
  });
}

export function computeObservedStudyGrid(
  collection: PasCollection,
  study: StudyAreaConfig,
  options: { idwPower?: number; maxCells?: number } = {},
): StudyRasterGrid {
  const filtered = pasFilter(collection, study.sensorFilters ?? {});
  const bounds = study.bounds ?? deriveStudyBoundsFromSensors(filtered);
  const areaFiltered = study.bounds ? pasFilterArea(filtered, bounds) : filtered;
  const gridSpec = buildStudyGrid(bounds, study.resolutionMeters, options.maxCells);
  const points = pasRecordsToStudyPoints(areaFiltered.records, study.sensorValueField ?? "pm25_1hr");
  const interpolated = idwInterpolate(points, gridSpec.width, gridSpec.height, bounds, options.idwPower ?? 2);
  return withStudyGridMeta(interpolated, gridSpec);
}

export function rasterizeSourceLayer(
  featureCollection: StudySourceFeatureCollection,
  layer: SourceLayerConfig,
  gridSpec: StudyRasterGrid,
  options: { maxSamples?: number } = {},
): StudyLayerGrid {
  const sampleEveryMeters = Math.max(
    gridSpec.resolutionMeters,
    layer.dispersion.sampleEveryMeters ?? gridSpec.resolutionMeters,
  );
  const maxSamples = options.maxSamples ?? DEFAULT_SOURCE_SAMPLE_LIMIT;
  const samples: WeightedSample[] = [];
  const polygonFills: Array<{ rings: Position[][]; value: number }> = [];

  for (const feature of featureCollection.features) {
    if (!feature.geometry) continue;
    const value = readFeatureValue(feature.properties ?? {}, layer.valueField);
    if (value == null) continue;

    collectGeometrySamples(feature.geometry, value, sampleEveryMeters, samples, polygonFills, layer.dispersion.method);
    if (samples.length > maxSamples) {
      thinSamples(samples, maxSamples);
    }
  }

  const values = new Float64Array(gridSpec.width * gridSpec.height);
  const lonStep = gridSpec.width > 1 ? (gridSpec.bounds.east - gridSpec.bounds.west) / (gridSpec.width - 1) : 0;
  const latStep = gridSpec.height > 1 ? (gridSpec.bounds.north - gridSpec.bounds.south) / (gridSpec.height - 1) : 0;

  if (layer.dispersion.method === "none") {
    burnUndispersedSamples(samples, values, gridSpec);
  }

  let min = Infinity;
  let max = -Infinity;

  for (let row = 0; row < gridSpec.height; row += 1) {
    const y = gridSpec.bounds.south + row * latStep;
    for (let col = 0; col < gridSpec.width; col += 1) {
      const x = gridSpec.bounds.west + col * lonStep;
      const index = row * gridSpec.width + col;
      let value = values[index];

      if (polygonFills.length) {
        for (const fill of polygonFills) {
          if (pointInPolygonRings(x, y, fill.rings)) {
            value += fill.value;
          }
        }
      }

      if (layer.dispersion.method !== "none") {
        value += disperseAtCell(x, y, samples, layer.dispersion, gridSpec.resolutionMeters);
      }

      values[index] = value;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0;
    max = 0;
  }

  const grid: StudyRasterGrid = {
    ...gridSpec,
    values,
    min,
    max,
  };

  return {
    layer,
    grid,
    normalizedGrid: normalizeStudyGrid(grid),
    sourceFeatureCount: featureCollection.features.length,
    sampleCount: samples.length,
  };
}

export function normalizeStudyGrid(grid: StudyRasterGrid): StudyRasterGrid {
  const values = new Float64Array(grid.values.length);
  const span = grid.max - grid.min;

  if (span <= 0 || !Number.isFinite(span)) {
    return {
      ...grid,
      values,
      min: 0,
      max: 0,
    };
  }

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < grid.values.length; i += 1) {
    const value = (grid.values[i] - grid.min) / span;
    values[i] = value;
    if (value < min) min = value;
    if (value > max) max = value;
  }

  return {
    ...grid,
    values,
    min,
    max,
  };
}

export function combineWeightedStudyGrids(
  layerGrids: StudyLayerGrid[],
  weights: Record<string, number> = {},
): StudyRasterGrid | null {
  const enabled = layerGrids.filter((entry) => {
    const weight = weights[entry.layer.id] ?? entry.layer.weightDefault;
    return weight > 0;
  });
  if (!enabled.length) return null;

  const first = enabled[0].normalizedGrid;
  const totalWeight = enabled.reduce((sum, entry) => sum + (weights[entry.layer.id] ?? entry.layer.weightDefault), 0);
  if (totalWeight <= 0) return null;

  const values = new Float64Array(first.values.length);
  for (const entry of enabled) {
    const weight = (weights[entry.layer.id] ?? entry.layer.weightDefault) / totalWeight;
    for (let i = 0; i < values.length; i += 1) {
      values[i] += entry.normalizedGrid.values[i] * weight;
    }
  }

  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }

  return {
    ...first,
    values,
    min: Number.isFinite(min) ? min : 0,
    max: Number.isFinite(max) ? max : 0,
  };
}

export function validateStudyGrid(
  predicted: StudyRasterGrid,
  observed: StudyRasterGrid,
): StudyValidationMetrics {
  const n = Math.min(predicted.values.length, observed.values.length);
  if (
    n === 0
    || predicted.width !== observed.width
    || predicted.height !== observed.height
  ) {
    return { n: 0, rmse: 0, mae: 0, bias: 0, minResidual: 0, maxResidual: 0 };
  }

  let sqSum = 0;
  let absSum = 0;
  let biasSum = 0;
  let minResidual = Infinity;
  let maxResidual = -Infinity;

  for (let i = 0; i < n; i += 1) {
    const residual = predicted.values[i] - observed.values[i];
    sqSum += residual * residual;
    absSum += Math.abs(residual);
    biasSum += residual;
    if (residual < minResidual) minResidual = residual;
    if (residual > maxResidual) maxResidual = residual;
  }

  return {
    n,
    rmse: Math.sqrt(sqSum / n),
    mae: absSum / n,
    bias: biasSum / n,
    minResidual,
    maxResidual,
  };
}

export function rankSensorSitingCandidates(
  grid: StudyRasterGrid,
  existingSensors: readonly PasRecord[],
  options: SensorSitingOptions = {},
): SensorSitingCandidate[] {
  const candidateCount = options.candidateCount ?? 10;
  const minSpacingKm = options.minSpacingKm ?? Math.max(grid.resolutionMeters / 1_000, 1);
  const pollutionWeight = options.pollutionWeight ?? 0.65;
  const coverageWeight = options.coverageWeight ?? 0.35;
  const coverageRadiusKm = options.coverageRadiusKm ?? Math.max(minSpacingKm * 4, 5);
  const excludeExistingWithinKm = options.excludeExistingWithinKm ?? Math.max(minSpacingKm * 0.5, 0.25);
  const maxCandidatePool = options.maxCandidatePool ?? 1_000;
  const weightTotal = Math.max(pollutionWeight + coverageWeight, Number.EPSILON);
  const validSensors = existingSensors.filter(
    (sensor) => Number.isFinite(sensor.latitude) && Number.isFinite(sensor.longitude),
  );
  const valueSpan = grid.max - grid.min;
  const pool: SensorSitingCandidate[] = [];

  for (let index = 0; index < grid.values.length; index += 1) {
    const predictedValue = grid.values[index];
    if (!Number.isFinite(predictedValue)) continue;

    const row = Math.floor(index / grid.width);
    const col = index % grid.width;
    const { longitude, latitude } = studyGridCellCoordinate(grid, row, col);
    const nearestSensorKm = nearestSensorDistanceKm(longitude, latitude, validSensors);
    if (nearestSensorKm !== null && nearestSensorKm < excludeExistingWithinKm) continue;

    const normalizedValue = valueSpan > 0
      ? Math.min(1, Math.max(0, (predictedValue - grid.min) / valueSpan))
      : 0;
    const coverageGapScore = nearestSensorKm === null
      ? 1
      : Math.min(1, Math.max(0, nearestSensorKm / coverageRadiusKm));
    const score = (normalizedValue * pollutionWeight + coverageGapScore * coverageWeight) / weightTotal;

    pool.push({
      rank: 0,
      row,
      col,
      latitude,
      longitude,
      predictedValue,
      normalizedValue,
      nearestSensorKm,
      coverageGapScore,
      score,
    });
  }

  pool.sort((left, right) => right.score - left.score || right.predictedValue - left.predictedValue);
  const selected: SensorSitingCandidate[] = [];
  const selectedKeys = new Set<string>();
  let activeSpacingKm = minSpacingKm;

  while (selected.length < candidateCount && activeSpacingKm >= 0.05) {
    for (const candidate of pool.slice(0, maxCandidatePool)) {
      const key = `${candidate.row}:${candidate.col}`;
      if (selectedKeys.has(key)) continue;
      const farEnough = selected.every((other) =>
        distanceMeters(candidate.longitude, candidate.latitude, other.longitude, other.latitude) / 1_000 >= activeSpacingKm,
      );
      if (!farEnough) continue;
      selected.push(candidate);
      selectedKeys.add(key);
      if (selected.length >= candidateCount) break;
    }
    if (selected.length >= candidateCount) break;
    activeSpacingKm *= 0.5;
  }

  if (selected.length < candidateCount) {
    for (const candidate of pool) {
      const key = `${candidate.row}:${candidate.col}`;
      if (selectedKeys.has(key)) continue;
      selected.push(candidate);
      selectedKeys.add(key);
      if (selected.length >= candidateCount) break;
    }
  }

  return selected.slice(0, candidateCount).map((candidate, index) => ({
    ...candidate,
    rank: index + 1,
    score: Number(candidate.score.toFixed(4)),
    normalizedValue: Number(candidate.normalizedValue.toFixed(4)),
    coverageGapScore: Number(candidate.coverageGapScore.toFixed(4)),
    nearestSensorKm: candidate.nearestSensorKm === null ? null : Number(candidate.nearestSensorKm.toFixed(3)),
    predictedValue: Number(candidate.predictedValue.toFixed(3)),
    latitude: Number(candidate.latitude.toFixed(6)),
    longitude: Number(candidate.longitude.toFixed(6)),
  }));
}

function sensorValue(record: PasRecord, field: StudySensorValueField): number | null {
  const value = record[field] ?? record.pm25Current;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function studyGridCellCoordinate(
  grid: StudyRasterGrid,
  row: number,
  col: number,
): { longitude: number; latitude: number } {
  const lonStep = grid.width > 1 ? (grid.bounds.east - grid.bounds.west) / (grid.width - 1) : 0;
  const latStep = grid.height > 1 ? (grid.bounds.north - grid.bounds.south) / (grid.height - 1) : 0;
  return {
    longitude: grid.bounds.west + col * lonStep,
    latitude: grid.bounds.south + row * latStep,
  };
}

function nearestSensorDistanceKm(
  longitude: number,
  latitude: number,
  sensors: readonly PasRecord[],
): number | null {
  if (!sensors.length) return null;
  let nearestMeters = Infinity;
  for (const sensor of sensors) {
    const distance = distanceMeters(longitude, latitude, sensor.longitude, sensor.latitude);
    if (distance < nearestMeters) nearestMeters = distance;
  }
  return Number.isFinite(nearestMeters) ? nearestMeters / 1_000 : null;
}

function withStudyGridMeta(grid: InterpolationGrid, spec: StudyRasterGrid): StudyRasterGrid {
  return {
    ...grid,
    resolutionMeters: spec.resolutionMeters,
    cellWidthMeters: spec.cellWidthMeters,
    cellHeightMeters: spec.cellHeightMeters,
  };
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function distanceMeters(ax: number, ay: number, bx: number, by: number): number {
  const lat1 = toRadians(ay);
  const lat2 = toRadians(by);
  const deltaLon = toRadians(bx - ax);
  const deltaLat = lat2 - lat1;
  const x = deltaLon * Math.cos((lat1 + lat2) / 2);
  return Math.sqrt(x * x + deltaLat * deltaLat) * EARTH_RADIUS_M;
}

function readFeatureValue(properties: Record<string, unknown>, valueField: string): number | null {
  const raw = valueField.split(".").reduce<unknown>((current, key) => {
    if (current && typeof current === "object") {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, properties);
  const value = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(value) ? value : null;
}

function collectGeometrySamples(
  geometry: StudyGeometry,
  value: number,
  sampleEveryMeters: number,
  samples: WeightedSample[],
  polygonFills: Array<{ rings: Position[][]; value: number }>,
  dispersionMethod: SourceDispersionConfig["method"],
): void {
  if (geometry.type === "Point") {
    samples.push({ x: geometry.coordinates[0], y: geometry.coordinates[1], value });
    return;
  }

  if (geometry.type === "MultiPoint") {
    for (const point of geometry.coordinates) {
      samples.push({ x: point[0], y: point[1], value });
    }
    return;
  }

  if (geometry.type === "LineString") {
    sampleLineString(geometry.coordinates, value, sampleEveryMeters, samples);
    return;
  }

  if (geometry.type === "MultiLineString") {
    for (const line of geometry.coordinates) {
      sampleLineString(line, value, sampleEveryMeters, samples);
    }
    return;
  }

  if (geometry.type === "Polygon") {
    if (dispersionMethod === "none") {
      polygonFills.push({ rings: geometry.coordinates, value });
    } else {
      samples.push(polygonCentroidSample(geometry.coordinates, value));
    }
    return;
  }

  for (const polygon of geometry.coordinates) {
    if (dispersionMethod === "none") {
      polygonFills.push({ rings: polygon, value });
    } else {
      samples.push(polygonCentroidSample(polygon, value));
    }
  }
}

function collectGeometryPositions(geometry: StudyGeometry, positions: Position[]): void {
  if (geometry.type === "Point") {
    positions.push(geometry.coordinates);
    return;
  }
  if (geometry.type === "MultiPoint" || geometry.type === "LineString") {
    positions.push(...geometry.coordinates);
    return;
  }
  if (geometry.type === "MultiLineString" || geometry.type === "Polygon") {
    for (const lineOrRing of geometry.coordinates) {
      positions.push(...lineOrRing);
    }
    return;
  }
  for (const polygon of geometry.coordinates) {
    for (const ring of polygon) {
      positions.push(...ring);
    }
  }
}

function sampleLineString(
  coordinates: Position[],
  value: number,
  sampleEveryMeters: number,
  samples: WeightedSample[],
): void {
  if (coordinates.length === 0) return;
  if (coordinates.length === 1) {
    samples.push({ x: coordinates[0][0], y: coordinates[0][1], value });
    return;
  }

  for (let i = 0; i < coordinates.length - 1; i += 1) {
    const start = coordinates[i];
    const end = coordinates[i + 1];
    const distance = distanceMeters(start[0], start[1], end[0], end[1]);
    const steps = Math.max(1, Math.ceil(distance / sampleEveryMeters));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      samples.push({
        x: start[0] + (end[0] - start[0]) * t,
        y: start[1] + (end[1] - start[1]) * t,
        value,
      });
    }
  }
}

function polygonCentroidSample(rings: Position[][], value: number): WeightedSample {
  const ring = rings[0] ?? [];
  if (!ring.length) return { x: 0, y: 0, value };
  let sumX = 0;
  let sumY = 0;
  for (const coordinate of ring) {
    sumX += coordinate[0];
    sumY += coordinate[1];
  }
  return { x: sumX / ring.length, y: sumY / ring.length, value };
}

function thinSamples(samples: WeightedSample[], maxSamples: number): void {
  if (samples.length <= maxSamples) return;
  const step = Math.ceil(samples.length / maxSamples);
  const thinned = samples.filter((_, index) => index % step === 0).slice(0, maxSamples);
  samples.length = 0;
  samples.push(...thinned);
}

function burnUndispersedSamples(
  samples: WeightedSample[],
  values: Float64Array,
  gridSpec: StudyRasterGrid,
): void {
  const lonStep = gridSpec.width > 1 ? (gridSpec.bounds.east - gridSpec.bounds.west) / (gridSpec.width - 1) : 1;
  const latStep = gridSpec.height > 1 ? (gridSpec.bounds.north - gridSpec.bounds.south) / (gridSpec.height - 1) : 1;

  for (const sample of samples) {
    const col = Math.round((sample.x - gridSpec.bounds.west) / lonStep);
    const row = Math.round((sample.y - gridSpec.bounds.south) / latStep);
    if (row < 0 || row >= gridSpec.height || col < 0 || col >= gridSpec.width) continue;
    values[row * gridSpec.width + col] += sample.value;
  }
}

function disperseAtCell(
  x: number,
  y: number,
  samples: WeightedSample[],
  dispersion: SourceDispersionConfig,
  resolutionMeters: number,
): number {
  const radiusMeters = dispersion.radiusMeters ?? Infinity;
  const sigmaMeters = Math.max(dispersion.sigmaMeters ?? resolutionMeters * 3, 1);
  const power = dispersion.power ?? 2;
  let value = 0;

  for (const sample of samples) {
    const distance = distanceMeters(x, y, sample.x, sample.y);
    if (distance > radiusMeters) continue;
    if (dispersion.method === "gaussian") {
      value += sample.value * Math.exp(-(distance * distance) / (2 * sigmaMeters * sigmaMeters));
    } else {
      value += sample.value / Math.pow(Math.max(distance, resolutionMeters / 2), power);
    }
  }

  return value;
}

function pointInPolygonRings(x: number, y: number, rings: Position[][]): boolean {
  if (!rings.length || !pointInRing(x, y, rings[0])) return false;
  for (let i = 1; i < rings.length; i += 1) {
    if (pointInRing(x, y, rings[i])) return false;
  }
  return true;
}

function pointInRing(x: number, y: number, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersects = ((yi > y) !== (yj > y))
      && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}
