import { gridToImageData, type InterpolationGrid, type InterpolationMethod, type InterpolationPoint } from "@patool/shared";
import type maplibregl from "maplibre-gl";

import type { InterpolationBounds } from "../../lib/interpolationProtocol";
import {
  DEFAULT_KRIGING_NEIGHBORS,
  DEFAULT_KRIGING_TILE_SIZE,
  KRIGING_SELECTION_STABILITY_THRESHOLD,
  MAX_GRID_EDGE,
  MAX_KRIGING_GRID_CELLS,
  MAX_POINTS_BY_METHOD,
  MIN_GRID_RESOLUTION,
  MIN_INTERPOLATION_POINTS,
  MIN_VIEW_BOUNDS_QUANTIZATION_DEGREES,
  VIEWPORT_PADDING_RATIO,
  VIEW_BOUNDS_QUANTIZATION_STEPS,
  VIEW_ZOOM_QUANTIZATION_STEP,
} from "./config";
import type { HeatmapDebugState, MapSize } from "./types";

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function approximateDistanceSquaredKm(ax: number, ay: number, bx: number, by: number): number {
  const lat1 = toRadians(ay);
  const lat2 = toRadians(by);
  const deltaLon = toRadians(bx - ax);
  const deltaLat = lat2 - lat1;
  const x = deltaLon * Math.cos((lat1 + lat2) / 2);
  return (x * x + deltaLat * deltaLat) * 6371 * 6371;
}

function expandBounds(bounds: InterpolationBounds, paddingRatio: number): InterpolationBounds {
  const lonPad = Math.max((bounds.east - bounds.west) * paddingRatio, 0.05);
  const latPad = Math.max((bounds.north - bounds.south) * paddingRatio, 0.05);

  return {
    west: bounds.west - lonPad,
    east: bounds.east + lonPad,
    south: bounds.south - latPad,
    north: bounds.north + latPad,
  };
}

function pointInBounds(point: InterpolationPoint, bounds: InterpolationBounds): boolean {
  return (
    point.x >= bounds.west
    && point.x <= bounds.east
    && point.y >= bounds.south
    && point.y <= bounds.north
  );
}

export function getMapBounds(map: maplibregl.Map): InterpolationBounds {
  const bounds = map.getBounds();
  return {
    west: bounds.getWest(),
    east: bounds.getEast(),
    south: bounds.getSouth(),
    north: bounds.getNorth(),
  };
}

function constrainGridCells(
  dimensions: { width: number; height: number },
  maxCells: number,
): { width: number; height: number } {
  const cellCount = dimensions.width * dimensions.height;
  if (cellCount <= maxCells) return dimensions;

  const scale = Math.sqrt(maxCells / cellCount);
  return {
    width: Math.max(2, Math.round(dimensions.width * scale)),
    height: Math.max(2, Math.round(dimensions.height * scale)),
  };
}

export function deriveGridDimensions(
  baseResolution: number,
  mapSize: MapSize,
  maxCells: number = MAX_KRIGING_GRID_CELLS,
): { width: number; height: number } {
  const safeWidth = Math.max(mapSize.width, 1);
  const safeHeight = Math.max(mapSize.height, 1);
  const aspectRatio = safeWidth / safeHeight;

  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    return constrainGridCells({ width: baseResolution, height: baseResolution }, maxCells);
  }

  if (aspectRatio >= 1) {
    return constrainGridCells({
      width: Math.min(MAX_GRID_EDGE, Math.max(2, Math.round(baseResolution * aspectRatio))),
      height: Math.max(2, baseResolution),
    }, maxCells);
  }

  return constrainGridCells({
    width: Math.max(2, baseResolution),
    height: Math.min(MAX_GRID_EDGE, Math.max(2, Math.round(baseResolution / aspectRatio))),
  }, maxCells);
}

export function deriveZoomAdjustedGridResolution(baseResolution: number, zoom: number | null): number {
  if (zoom == null) return baseResolution;

  const scale = zoom < 3.5
    ? 0.35
    : zoom < 5
      ? 0.5
      : zoom < 6
        ? 0.75
        : 1;

  return Math.max(MIN_GRID_RESOLUTION, Math.round(baseResolution * scale));
}

export function deriveKrigingNeighborCount(zoom: number | null): number {
  if (zoom == null) return DEFAULT_KRIGING_NEIGHBORS;
  if (zoom < 3.5) return 6;
  if (zoom < 5) return 8;
  if (zoom < 6) return 10;
  return DEFAULT_KRIGING_NEIGHBORS;
}

export function deriveKrigingTileSize(zoom: number | null): number {
  if (zoom == null) return DEFAULT_KRIGING_TILE_SIZE;
  if (zoom < 3.5) return 8;
  if (zoom < 5) return 6;
  if (zoom < 6) return 5;
  return DEFAULT_KRIGING_TILE_SIZE;
}

function quantizeValue(value: number, step: number): number {
  return Math.round(value / step) * step;
}

export function quantizeMapBounds(bounds: InterpolationBounds): InterpolationBounds {
  const lonStep = Math.max(
    (bounds.east - bounds.west) / VIEW_BOUNDS_QUANTIZATION_STEPS,
    MIN_VIEW_BOUNDS_QUANTIZATION_DEGREES,
  );
  const latStep = Math.max(
    (bounds.north - bounds.south) / VIEW_BOUNDS_QUANTIZATION_STEPS,
    MIN_VIEW_BOUNDS_QUANTIZATION_DEGREES,
  );

  return {
    west: quantizeValue(bounds.west, lonStep),
    east: quantizeValue(bounds.east, lonStep),
    south: quantizeValue(bounds.south, latStep),
    north: quantizeValue(bounds.north, latStep),
  };
}

export function quantizeZoom(zoom: number): number {
  return quantizeValue(zoom, VIEW_ZOOM_QUANTIZATION_STEP);
}

export function boundsEqual(left: InterpolationBounds | null, right: InterpolationBounds): boolean {
  return !!left
    && left.west === right.west
    && left.east === right.east
    && left.south === right.south
    && left.north === right.north;
}

export function getInterpolationPointKey(point: InterpolationPoint): string {
  return point.id ?? `${point.x.toFixed(6)}|${point.y.toFixed(6)}`;
}

export function computeSelectionOverlap(
  previousKeys: string[],
  nextKeys: string[],
): { overlapCount: number; overlapPct: number | null } {
  if (previousKeys.length === 0 || nextKeys.length === 0) {
    return { overlapCount: 0, overlapPct: null };
  }

  const previous = new Set(previousKeys);
  let overlapCount = 0;
  for (const key of nextKeys) {
    if (previous.has(key)) overlapCount++;
  }

  return {
    overlapCount,
    overlapPct: overlapCount / Math.min(previousKeys.length, nextKeys.length),
  };
}

export function createHeatmapDebugState(): HeatmapDebugState {
  return {
    workerJobsPosted: 0,
    staleResponsesIgnored: 0,
    sourceRefreshes: 0,
    sourceRemovals: 0,
    workerRestarts: 0,
    lastSelectedOverlapPct: null,
    lastSelectedOverlapCount: 0,
    lastSelectedPointCount: 0,
    lastSelectionStabilized: false,
    lastColorizeMs: null,
    lastMainThreadRenderMs: null,
    lastKrigingDiagnostics: null,
    lastJob: null,
  };
}

export function selectInterpolationPoints(
  points: InterpolationPoint[],
  bounds: InterpolationBounds,
  method: InterpolationMethod,
): { selected: InterpolationPoint[]; capped: boolean } {
  const maxPoints = MAX_POINTS_BY_METHOD[method];
  const paddedBounds = expandBounds(bounds, VIEWPORT_PADDING_RATIO);
  const centerX = (bounds.west + bounds.east) / 2;
  const centerY = (bounds.south + bounds.north) / 2;

  const scored = points.map((point) => ({
    point,
    visible: pointInBounds(point, bounds),
    nearby: pointInBounds(point, paddedBounds),
    distanceScore: approximateDistanceSquaredKm(centerX, centerY, point.x, point.y),
  }));

  let candidates = scored.filter((item) => item.nearby);
  if (candidates.length < MIN_INTERPOLATION_POINTS) {
    candidates = scored;
  }

  candidates.sort((left, right) => {
    if (left.visible !== right.visible) return left.visible ? -1 : 1;
    return left.distanceScore - right.distanceScore;
  });

  return {
    selected: candidates.slice(0, maxPoints).map((item) => item.point),
    capped: candidates.length > maxPoints,
  };
}

export function canStabilizeKrigingSelection(overlapPct: number | null, previousCount: number, nextCount: number): boolean {
  return overlapPct != null
    && overlapPct >= KRIGING_SELECTION_STABILITY_THRESHOLD
    && previousCount === nextCount;
}

export function paintInterpolationCanvas(grid: InterpolationGrid, canvas: HTMLCanvasElement): number {
  canvas.width = grid.width;
  canvas.height = grid.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return 0;

  const imageData = ctx.createImageData(grid.width, grid.height);
  const colorizeStartedAt = performance.now();
  const colorData = gridToImageData(grid, true);
  const colorizeMs = performance.now() - colorizeStartedAt;
  imageData.data.set(colorData);
  ctx.putImageData(imageData, 0, 0);
  return colorizeMs;
}
