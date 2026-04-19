import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import maplibregl from "maplibre-gl";

import {
  pasFilter,
  pm25ToAqiBand,
  gridToImageData,
  type PasCollection,
  type PasRecord,
  type InterpolationGrid,
  type InterpolationPoint,
  type InterpolationMethod,
  type KrigingDiagnostics,
} from "@patool/shared";

import { StatCard } from "../components";
import { getJson } from "../lib/api";
import type { InterpolationBounds, InterpolationWorkerResponse } from "../lib/interpolationProtocol";
import { appPath } from "../lib/routing";
import { useTheme } from "../hooks/useTheme";
import styles from "./MapPage.module.css";

import "maplibre-gl/dist/maplibre-gl.css";

type Pm25Window = "pm25Current" | "pm25_10min" | "pm25_30min" | "pm25_1hr" | "pm25_6hr" | "pm25_1day" | "pm25_1week";

const pm25WindowOptions: { value: Pm25Window; label: string }[] = [
  { value: "pm25Current", label: "Current" },
  { value: "pm25_10min", label: "10min" },
  { value: "pm25_30min", label: "30min" },
  { value: "pm25_1hr", label: "1hr" },
  { value: "pm25_6hr", label: "6hr" },
  { value: "pm25_1day", label: "1day" },
  { value: "pm25_1week", label: "1week" },
];

const STYLE_LIGHT = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const STYLE_DARK = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

const LAYER_ID = "sensors-circles";
const SOURCE_ID = "sensors";
const HEATMAP_LAYER_ID = "heatmap-layer";
const HEATMAP_SOURCE_ID = "heatmap-source";
const OVERLAY_ID_PREFIX = "user-overlay-";
const OVERLAY_PALETTE = ["#2563eb", "#db2777", "#0d9488", "#ea580c", "#7c3aed"];
const MISSING_PM_COLOR = "#94a3b8";
const MIN_INTERPOLATION_POINTS = 3;
const VIEWPORT_PADDING_RATIO = 0.2;
const MIN_GRID_RESOLUTION = 50;
const MAX_GRID_EDGE = 384;
const MAX_KRIGING_GRID_CELLS = 76_800;
const MAX_IDW_GRID_CELLS = 120_000;
const DEFAULT_KRIGING_NEIGHBORS = 12;
const DEFAULT_KRIGING_TILE_SIZE = 4;
const VIEW_BOUNDS_QUANTIZATION_STEPS = 512;
const MIN_VIEW_BOUNDS_QUANTIZATION_DEGREES = 0.0001;
const VIEW_ZOOM_QUANTIZATION_STEP = 0.05;
const RESIZE_RECOMPUTE_DEBOUNCE_MS = 200;
const KRIGING_SELECTION_STABILITY_THRESHOLD = 0.85;
const MAX_POINTS_BY_METHOD: Record<InterpolationMethod, number> = {
  idw: 2400,
  kriging: 400,
};

type MapSize = {
  width: number;
  height: number;
};

type InterpolationMeta = {
  totalPoints: number;
  pointsUsed: number;
  gridWidth: number;
  gridHeight: number;
  capped: boolean;
  krigingNeighbors?: number;
  krigingTileSize?: number;
  krigingDiagnostics?: KrigingDiagnostics;
  durationMs?: number;
  error?: string;
};

type HeatmapDebugState = {
  workerJobsPosted: number;
  staleResponsesIgnored: number;
  sourceRefreshes: number;
  sourceRemovals: number;
  workerRestarts: number;
  lastSelectedOverlapPct: number | null;
  lastSelectedOverlapCount: number;
  lastSelectedPointCount: number;
  lastSelectionStabilized: boolean;
  lastColorizeMs: number | null;
  lastMainThreadRenderMs: number | null;
  lastKrigingDiagnostics: KrigingDiagnostics | null;
  lastJob: {
    id: number;
    method: InterpolationMethod;
    gridWidth: number;
    gridHeight: number;
    points: number;
  } | null;
};

type PatoolDebugWindow = Window & {
  __PAToolHeatmapDebug?: HeatmapDebugState;
};

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

function getMapBounds(map: maplibregl.Map): InterpolationBounds {
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

function deriveGridDimensions(
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

function deriveZoomAdjustedGridResolution(baseResolution: number, zoom: number | null): number {
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

function deriveKrigingNeighborCount(zoom: number | null): number {
  if (zoom == null) return DEFAULT_KRIGING_NEIGHBORS;
  if (zoom < 3.5) return 6;
  if (zoom < 5) return 8;
  if (zoom < 6) return 10;
  return DEFAULT_KRIGING_NEIGHBORS;
}

function deriveKrigingTileSize(zoom: number | null): number {
  if (zoom == null) return DEFAULT_KRIGING_TILE_SIZE;
  if (zoom < 3.5) return 8;
  if (zoom < 5) return 6;
  if (zoom < 6) return 5;
  return DEFAULT_KRIGING_TILE_SIZE;
}

function quantizeValue(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function quantizeMapBounds(bounds: InterpolationBounds): InterpolationBounds {
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

function quantizeZoom(zoom: number): number {
  return quantizeValue(zoom, VIEW_ZOOM_QUANTIZATION_STEP);
}

function boundsEqual(left: InterpolationBounds | null, right: InterpolationBounds): boolean {
  return !!left
    && left.west === right.west
    && left.east === right.east
    && left.south === right.south
    && left.north === right.north;
}

function getInterpolationPointKey(point: InterpolationPoint): string {
  return point.id ?? `${point.x.toFixed(6)}|${point.y.toFixed(6)}`;
}

function computeSelectionOverlap(
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

function createHeatmapDebugState(): HeatmapDebugState {
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

function selectInterpolationPoints(
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

function getPm25ValueForWindow(record: PasRecord, window: Pm25Window): number | null {
  const value = record[window] ?? record.pm25Current;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

type OverlayLayer = {
  id: string;
  name: string;
  color: string;
  data: GeoJSON.FeatureCollection;
};

function parseOverlayGeoJson(raw: unknown): GeoJSON.FeatureCollection {
  if (!raw || typeof raw !== "object") {
    throw new Error("GeoJSON root must be an object");
  }
  const obj = raw as { type?: string; features?: unknown };
  if (obj.type === "FeatureCollection" && Array.isArray(obj.features)) {
    return raw as GeoJSON.FeatureCollection;
  }
  if (obj.type === "Feature") {
    return { type: "FeatureCollection", features: [raw as GeoJSON.Feature] };
  }
  if (
    obj.type === "Point" || obj.type === "MultiPoint"
    || obj.type === "LineString" || obj.type === "MultiLineString"
    || obj.type === "Polygon" || obj.type === "MultiPolygon"
  ) {
    return {
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: raw as GeoJSON.Geometry, properties: {} }],
    };
  }
  throw new Error(`Unsupported GeoJSON type "${obj.type ?? "unknown"}"`);
}

function buildGeoJson(
  records: PasRecord[],
  pm25Window: Pm25Window,
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: records.map((r) => ({
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: [r.longitude, r.latitude],
      },
      properties: {
        id: r.id,
        label: r.label,
        pm25: getPm25ValueForWindow(r, pm25Window)?.toFixed(2) ?? "NA",
        color: (() => {
          const pm25 = getPm25ValueForWindow(r, pm25Window);
          return pm25 == null ? MISSING_PM_COLOR : pm25ToAqiBand(pm25).color;
        })(),
        stateCode: r.stateCode ?? "NA",
      },
    })),
  };
}

function createInterpolationWorker(
  onmessage: (event: MessageEvent<InterpolationWorkerResponse>) => void,
): Worker {
  const worker = new Worker(new URL("../workers/interpolation.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = onmessage;
  return worker;
}

export default function MapPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const heatmapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const interpolationWorkerRef = useRef<Worker | null>(null);
  const interpolationJobIdRef = useRef(0);
  const heatmapDebugRef = useRef<HeatmapDebugState>(createHeatmapDebugState());
  const selectedPointKeysRef = useRef<string[]>([]);
  const rawMapSizeRef = useRef<MapSize>({ width: 1, height: 1 });
  const workerBusyRef = useRef(false);
  const activeJobMethodRef = useRef<InterpolationMethod | null>(null);
  const { theme } = useTheme();

  const [query, setQuery] = useState("");
  const [outsideOnly, setOutsideOnly] = useState(true);
  const [pm25Window, setPm25Window] = useState<Pm25Window>("pm25_1hr");
  const [mapMode, setMapMode] = useState<"markers" | "heatmap">("markers");
  const [interpMethod, setInterpMethod] = useState<InterpolationMethod>("idw");
  const [gridRes, setGridRes] = useState(100);
  const [idwPower, setIdwPower] = useState(2);
  const [followView, setFollowView] = useState(true);
  const [styleReloadTick, setStyleReloadTick] = useState(0);
  const [overlays, setOverlays] = useState<OverlayLayer[]>([]);
  const [overlayUrl, setOverlayUrl] = useState("");
  const [overlayError, setOverlayError] = useState<string | null>(null);
  const overlayInputRef = useRef<HTMLInputElement | null>(null);
  const [mapSize, setMapSize] = useState<MapSize>({ width: 1, height: 1 });
  const [interpolationResult, setInterpolationResult] = useState<InterpolationGrid | null>(null);
  const [interpolationMeta, setInterpolationMeta] = useState<InterpolationMeta | null>(null);
  const [isComputing, setIsComputing] = useState(false);
  const [viewBounds, setViewBounds] = useState<{
    west: number;
    east: number;
    south: number;
    north: number;
  } | null>(null);
  const [viewZoom, setViewZoom] = useState<number | null>(null);
  // Bump this counter to force a recompute using the current viewport.
  const [recomputeTick, setRecomputeTick] = useState(0);
  const deferredQuery = useDeferredValue(query);

  const recordHeatmapDebug = useCallback((mutate: (state: HeatmapDebugState) => void) => {
    if (!import.meta.env.DEV || typeof window === "undefined") return;

    const next = { ...heatmapDebugRef.current };
    mutate(next);
    heatmapDebugRef.current = next;
    (window as PatoolDebugWindow).__PAToolHeatmapDebug = next;
  }, []);

  const { data } = useQuery({
    queryKey: ["pas"],
    queryFn: () => getJson<PasCollection>("/api/pas"),
  });

  const filtered = useMemo(() => {
    if (!data) return null;
    return pasFilter(data, {
      labelQuery: deferredQuery,
      isOutside: outsideOnly ? true : undefined,
    });
  }, [data, deferredQuery, outsideOnly]);

  const geojson = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!filtered) return { type: "FeatureCollection", features: [] };
    return buildGeoJson(filtered.records, pm25Window);
  }, [filtered, pm25Window]);

  // Stable ref for the latest geojson so the callbacks inside map.on("load") always see current data
  const geojsonRef = useRef(geojson);
  geojsonRef.current = geojson;

  const interpolationPoints = useMemo(() => {
    if (!filtered) return [];

    return filtered.records.flatMap((record): InterpolationPoint[] => {
      const pm25 = getPm25ValueForWindow(record, pm25Window);
      if (
        pm25 == null
        || !Number.isFinite(record.longitude)
        || !Number.isFinite(record.latitude)
      ) {
        return [];
      }

      return [{
        id: record.id,
        x: record.longitude,
        y: record.latitude,
        value: pm25,
      }];
    });
  }, [filtered, pm25Window]);

  const interpolationWorkload = useMemo(() => {
    if (mapMode !== "heatmap" || interpolationPoints.length < MIN_INTERPOLATION_POINTS) return null;

    // Bounds: follow the map viewport when enabled, otherwise use the data envelope.
    // Viewport-bound grids give high-resolution detail as the user zooms in, since the
    // same NxN grid now covers a smaller area.
    let bounds: InterpolationBounds;
    if (followView) {
      if (!viewBounds || viewZoom == null) return null;
      bounds = viewBounds;
    } else {
      const lons = interpolationPoints.map((p) => p.x);
      const lats = interpolationPoints.map((p) => p.y);
      const pad = 0.5; // degree padding around data envelope
      bounds = {
        west: Math.min(...lons) - pad,
        east: Math.max(...lons) + pad,
        south: Math.min(...lats) - pad,
        north: Math.max(...lats) + pad,
      };
    }

    const { selected, capped } = selectInterpolationPoints(interpolationPoints, bounds, interpMethod);
    if (selected.length < MIN_INTERPOLATION_POINTS) return null;

    let selectedPoints = selected;
    let pointKeys = selected.map(getInterpolationPointKey);
    let selectedOverlapPct: number | null = null;
    let selectedOverlapCount = 0;
    let selectionStabilized = false;

    if (interpMethod === "kriging") {
      const overlap = computeSelectionOverlap(selectedPointKeysRef.current, pointKeys);
      selectedOverlapPct = overlap.overlapPct;
      selectedOverlapCount = overlap.overlapCount;

      if (
        overlap.overlapPct != null
        && overlap.overlapPct >= KRIGING_SELECTION_STABILITY_THRESHOLD
        && selectedPointKeysRef.current.length === pointKeys.length
      ) {
        const pointsByKey = new Map(interpolationPoints.map((point) => [getInterpolationPointKey(point), point]));
        const stablePoints = selectedPointKeysRef.current
          .map((key) => pointsByKey.get(key))
          .filter((point): point is InterpolationPoint => !!point);

        if (stablePoints.length === selectedPointKeysRef.current.length) {
          selectedPoints = stablePoints;
          pointKeys = selectedPointKeysRef.current;
          selectionStabilized = true;
        }
      }
    }

    const zoomForAdaptiveWork = followView ? viewZoom : null;
    const adjustedGridRes = deriveZoomAdjustedGridResolution(gridRes, zoomForAdaptiveWork);
    const krigingNeighbors = interpMethod === "kriging"
      ? deriveKrigingNeighborCount(zoomForAdaptiveWork)
      : undefined;
    const krigingTileSize = interpMethod === "kriging"
      ? deriveKrigingTileSize(zoomForAdaptiveWork)
      : undefined;
    const maxGridCells = interpMethod === "kriging" ? MAX_KRIGING_GRID_CELLS : MAX_IDW_GRID_CELLS;
    const { width, height } = deriveGridDimensions(adjustedGridRes, rawMapSizeRef.current, maxGridCells);
    return {
      bounds,
      points: selectedPoints,
      pointKeys,
      gridWidth: width,
      gridHeight: height,
      totalPoints: interpolationPoints.length,
      capped,
      krigingNeighbors,
      krigingTileSize,
      selectedOverlapPct,
      selectedOverlapCount,
      selectionStabilized,
    };
    // recomputeTick is intentionally a dep so the manual "Recompute" button re-runs this
    // even when bounds/params are unchanged.
  }, [mapMode, interpolationPoints, interpMethod, gridRes, mapSize, followView, viewBounds, viewZoom, recomputeTick]);

  const handleInterpolationWorkerMessage = useCallback((event: MessageEvent<InterpolationWorkerResponse>) => {
    const response = event.data;
    if (response.jobId !== interpolationJobIdRef.current) {
      recordHeatmapDebug((state) => {
        state.staleResponsesIgnored += 1;
      });
      return;
    }

    workerBusyRef.current = false;
    activeJobMethodRef.current = null;

    startTransition(() => {
      if (!response.ok) {
        setIsComputing(false);
        setInterpolationMeta((previous) => (
          previous
            ? { ...previous, durationMs: response.durationMs, error: response.error }
            : previous
        ));
        return;
      }

      const result: InterpolationGrid = {
        ...response.result,
        values: new Float64Array(response.result.values),
      };
      const krigingDiagnostics = result.diagnostics?.kriging;
      setIsComputing(false);
      setInterpolationResult(result);
      setInterpolationMeta((previous) => (
        previous
          ? { ...previous, durationMs: response.durationMs, error: undefined, krigingDiagnostics }
          : previous
      ));
      recordHeatmapDebug((state) => {
        state.lastKrigingDiagnostics = krigingDiagnostics ?? null;
      });
    });
  }, [recordHeatmapDebug]);

  useEffect(() => {
    const worker = createInterpolationWorker(handleInterpolationWorkerMessage);
    interpolationWorkerRef.current = worker;

    return () => {
      worker.terminate();
      if (interpolationWorkerRef.current === worker) {
        interpolationWorkerRef.current = null;
      }
    };
  }, [handleInterpolationWorkerMessage]);

  useEffect(() => {
    let worker = interpolationWorkerRef.current;
    if (!worker) return;

    const restartWorkerForSupersededJob = () => {
      worker?.terminate();
      worker = createInterpolationWorker(handleInterpolationWorkerMessage);
      interpolationWorkerRef.current = worker;
      workerBusyRef.current = false;
      activeJobMethodRef.current = null;
      recordHeatmapDebug((state) => {
        state.workerRestarts += 1;
      });
    };

    if (!interpolationWorkload) {
      interpolationJobIdRef.current += 1;
      if (activeJobMethodRef.current === "kriging" && workerBusyRef.current) {
        restartWorkerForSupersededJob();
      } else {
        workerBusyRef.current = false;
        activeJobMethodRef.current = null;
      }
      setIsComputing(false);
      if (mapMode !== "heatmap" || interpolationPoints.length < MIN_INTERPOLATION_POINTS) {
        selectedPointKeysRef.current = [];
        setInterpolationResult(null);
        setInterpolationMeta(null);
      }
      return;
    }

    if (interpMethod === "kriging" && workerBusyRef.current) {
      restartWorkerForSupersededJob();
      if (!worker) return;
    }

    const jobId = interpolationJobIdRef.current + 1;
    interpolationJobIdRef.current = jobId;
    workerBusyRef.current = true;
    activeJobMethodRef.current = interpMethod;

    if (interpMethod === "kriging") {
      selectedPointKeysRef.current = interpolationWorkload.pointKeys;
      recordHeatmapDebug((state) => {
        state.lastSelectedOverlapPct = interpolationWorkload.selectedOverlapPct;
        state.lastSelectedOverlapCount = interpolationWorkload.selectedOverlapCount;
        state.lastSelectedPointCount = interpolationWorkload.points.length;
        state.lastSelectionStabilized = interpolationWorkload.selectionStabilized;
      });

      if (import.meta.env.DEV) {
        const pct = interpolationWorkload.selectedOverlapPct == null
          ? "n/a"
          : `${(interpolationWorkload.selectedOverlapPct * 100).toFixed(1)}%`;
        console.debug(
          `[PAtool heatmap] kriging selected-sensor overlap ${pct}`
          + ` (${interpolationWorkload.selectedOverlapCount}/${interpolationWorkload.points.length})`
          + (interpolationWorkload.selectionStabilized ? " stabilized" : ""),
        );
      }
    }

    setIsComputing(true);
    setInterpolationMeta({
      totalPoints: interpolationWorkload.totalPoints,
      pointsUsed: interpolationWorkload.points.length,
      gridWidth: interpolationWorkload.gridWidth,
      gridHeight: interpolationWorkload.gridHeight,
      capped: interpolationWorkload.capped,
      krigingNeighbors: interpolationWorkload.krigingNeighbors,
      krigingTileSize: interpolationWorkload.krigingTileSize,
      krigingDiagnostics: undefined,
    });

    recordHeatmapDebug((state) => {
      state.workerJobsPosted += 1;
      state.lastJob = {
        id: jobId,
        method: interpMethod,
        gridWidth: interpolationWorkload.gridWidth,
        gridHeight: interpolationWorkload.gridHeight,
        points: interpolationWorkload.points.length,
      };
    });

    worker.postMessage({
      jobId,
      method: interpMethod,
      points: interpolationWorkload.points,
      bounds: interpolationWorkload.bounds,
      gridWidth: interpolationWorkload.gridWidth,
      gridHeight: interpolationWorkload.gridHeight,
      idwPower,
      krigingMaxNeighbors: interpolationWorkload.krigingNeighbors,
      krigingTileSize: interpolationWorkload.krigingTileSize,
    });
  }, [
    interpolationWorkload,
    interpMethod,
    idwPower,
    mapMode,
    interpolationPoints.length,
    handleInterpolationWorkerMessage,
    recordHeatmapDebug,
  ]);

  const addSensorLayer = useCallback((map: maplibregl.Map) => {
    if (map.getSource(SOURCE_ID)) return;

    map.addSource(SOURCE_ID, {
      type: "geojson",
      data: geojsonRef.current,
    });

    map.addLayer({
      id: LAYER_ID,
      type: "circle",
      source: SOURCE_ID,
      paint: {
        "circle-radius": 6,
        "circle-color": ["get", "color"],
        "circle-stroke-width": 1.5,
        "circle-stroke-color": "#ffffff",
        "circle-opacity": 0.85,
      },
    });

    map.on("click", LAYER_ID, (e) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const props = feature.properties!;
      new maplibregl.Popup({ offset: 10 })
        .setLngLat(e.lngLat)
        .setHTML(
          `<strong>${props.label}</strong><br/>`
          + `${props.pm25 === "NA" ? "PM2.5 unavailable" : `${props.pm25} ug/m3`}<br/>`
          + `<a href="${appPath(`/sensor/${props.id}`)}">Sensor detail</a> | `
          + `<a href="${appPath(`/diagnostics/${props.id}`)}">Diagnostics</a>`,
        )
        .addTo(map);
    });

    map.on("mouseenter", LAYER_ID, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", LAYER_ID, () => {
      map.getCanvas().style.cursor = "";
    });
  }, []);

  const syncSensorLayerPaint = useCallback((map: maplibregl.Map) => {
    if (!map.isStyleLoaded() || !map.getLayer(LAYER_ID)) return;

    if (mapMode === "heatmap") {
      map.setPaintProperty(LAYER_ID, "circle-radius", 3);
      map.setPaintProperty(LAYER_ID, "circle-opacity", 0.35);
      return;
    }

    map.setPaintProperty(LAYER_ID, "circle-radius", 6);
    map.setPaintProperty(LAYER_ID, "circle-opacity", 0.85);
  }, [mapMode]);

  // Initialize map using a callback ref so it fires when the div mounts
  const mapContainerCallback = useCallback((node: HTMLDivElement | null) => {
    // Also store in containerRef for other effects
    containerRef.current = node;

    if (!node) {
      // Cleanup when unmounting
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      return;
    }

    // Don't double-init
    if (mapRef.current) return;

    const map = new maplibregl.Map({
      container: node,
      style: theme === "dark" ? STYLE_DARK : STYLE_LIGHT,
      center: [-103.23, 44.08],
      zoom: 4,
    });

    mapRef.current = map;

    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), "top-right");

    map.on("load", () => {
      addSensorLayer(map);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncViewState = useCallback((map: maplibregl.Map) => {
    const nextBounds = quantizeMapBounds(getMapBounds(map));
    const nextZoom = quantizeZoom(map.getZoom());

    setViewBounds((previous) => (
      boundsEqual(previous, nextBounds) ? previous : nextBounds
    ));
    setViewZoom((previous) => (
      previous === nextZoom ? previous : nextZoom
    ));
  }, []);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const syncSize = () => {
      const nextSize = {
        width: Math.max(node.clientWidth, 1),
        height: Math.max(node.clientHeight, 1),
      };
      rawMapSizeRef.current = nextSize;

      setMapSize((previous) => {
        if (previous.width === nextSize.width && previous.height === nextSize.height) {
          return previous;
        }

        const zoomForAdaptiveWork = followView ? viewZoom : null;
        const adjustedGridRes = deriveZoomAdjustedGridResolution(gridRes, zoomForAdaptiveWork);
        const maxGridCells = interpMethod === "kriging" ? MAX_KRIGING_GRID_CELLS : MAX_IDW_GRID_CELLS;
        const previousDimensions = deriveGridDimensions(adjustedGridRes, previous, maxGridCells);
        const nextDimensions = deriveGridDimensions(adjustedGridRes, nextSize, maxGridCells);

        return previousDimensions.width === nextDimensions.width
          && previousDimensions.height === nextDimensions.height
          ? previous
          : nextSize;
      });

      const map = mapRef.current;
      if (map) {
        map.resize();
        if (mapMode === "heatmap" && followView) {
          syncViewState(map);
        }
      }
    };

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleSizeSync = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resizeTimer = null;
        syncSize();
      }, RESIZE_RECOMPUTE_DEBOUNCE_MS);
    };

    syncSize();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => {
        scheduleSizeSync();
      });
      observer.observe(node);
      return () => {
        observer.disconnect();
        if (resizeTimer) clearTimeout(resizeTimer);
      };
    }

    window.addEventListener("resize", scheduleSizeSync);
    return () => {
      window.removeEventListener("resize", scheduleSizeSync);
      if (resizeTimer) clearTimeout(resizeTimer);
    };
  }, [mapMode, followView, viewZoom, gridRes, interpMethod, syncViewState]);

  useEffect(() => {
    setMapSize(rawMapSizeRef.current);
  }, [gridRes, interpMethod]);

  // Update GeoJSON data when the filtered set changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(geojson);
    }
  }, [geojson]);

  const managedOverlayIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const beforeLayer = map.getLayer(LAYER_ID) ? LAYER_ID : undefined;
    const wanted = new Set(overlays.map((o) => o.id));

    for (const overlayId of Array.from(managedOverlayIdsRef.current)) {
      if (wanted.has(overlayId)) continue;
      const sourceId = `${OVERLAY_ID_PREFIX}${overlayId}`;
      for (const suffix of ["-fill", "-line", "-point"]) {
        const layerId = `${sourceId}${suffix}`;
        if (map.getLayer(layerId)) map.removeLayer(layerId);
      }
      if (map.getSource(sourceId)) map.removeSource(sourceId);
      managedOverlayIdsRef.current.delete(overlayId);
    }

    for (const overlay of overlays) {
      const sourceId = `${OVERLAY_ID_PREFIX}${overlay.id}`;
      const existingSource = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
      if (existingSource) {
        existingSource.setData(overlay.data);
      } else {
        map.addSource(sourceId, { type: "geojson", data: overlay.data });
      }
      managedOverlayIdsRef.current.add(overlay.id);

      const fillId = `${sourceId}-fill`;
      const lineId = `${sourceId}-line`;
      const pointId = `${sourceId}-point`;

      if (!map.getLayer(fillId)) {
        map.addLayer(
          {
            id: fillId,
            source: sourceId,
            type: "fill",
            filter: ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]],
            paint: { "fill-color": overlay.color, "fill-opacity": 0.2 },
          },
          beforeLayer,
        );
      } else {
        map.setPaintProperty(fillId, "fill-color", overlay.color);
      }
      if (!map.getLayer(lineId)) {
        map.addLayer(
          {
            id: lineId,
            source: sourceId,
            type: "line",
            filter: ["in", ["geometry-type"], ["literal", ["LineString", "MultiLineString", "Polygon", "MultiPolygon"]]],
            paint: { "line-color": overlay.color, "line-width": 1.5, "line-opacity": 0.8 },
          },
          beforeLayer,
        );
      } else {
        map.setPaintProperty(lineId, "line-color", overlay.color);
      }
      if (!map.getLayer(pointId)) {
        map.addLayer(
          {
            id: pointId,
            source: sourceId,
            type: "circle",
            filter: ["in", ["geometry-type"], ["literal", ["Point", "MultiPoint"]]],
            paint: {
              "circle-radius": 4,
              "circle-color": overlay.color,
              "circle-stroke-width": 1,
              "circle-stroke-color": "#ffffff",
              "circle-opacity": 0.85,
            },
          },
          beforeLayer,
        );
      } else {
        map.setPaintProperty(pointId, "circle-color", overlay.color);
      }
    }
  }, [overlays, styleReloadTick]);

  // Switch map style when theme changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const style = theme === "dark" ? STYLE_DARK : STYLE_LIGHT;
    map.once("styledata", () => {
      addSensorLayer(map);
      syncSensorLayerPaint(map);
      setStyleReloadTick((tick) => tick + 1);
    });
    map.setStyle(style, { diff: true });
  }, [theme, addSensorLayer, syncSensorLayerPaint]);

  // Render heatmap overlay from interpolation result
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!map.isStyleLoaded()) {
      const retryWhenStyleLoads = () => {
        setStyleReloadTick((tick) => tick + 1);
      };
      const retryTimer = window.setTimeout(retryWhenStyleLoads, 100);

      map.once("load", retryWhenStyleLoads);
      map.once("styledata", retryWhenStyleLoads);
      return () => {
        window.clearTimeout(retryTimer);
        map.off("load", retryWhenStyleLoads);
        map.off("styledata", retryWhenStyleLoads);
      };
    }

    if (!interpolationResult) {
      // Remove heatmap layer if exists
      if (map.getLayer(HEATMAP_LAYER_ID)) map.removeLayer(HEATMAP_LAYER_ID);
      if (map.getSource(HEATMAP_SOURCE_ID)) {
        map.removeSource(HEATMAP_SOURCE_ID);
        recordHeatmapDebug((state) => {
          state.sourceRemovals += 1;
        });
      }
      return;
    }

    const renderStartedAt = performance.now();
    // Reuse the backing canvas to avoid repeated allocations during pan/zoom.
    const canvas = heatmapCanvasRef.current ?? document.createElement("canvas");
    heatmapCanvasRef.current = canvas;
    canvas.width = interpolationResult.width;
    canvas.height = interpolationResult.height;
    const ctx = canvas.getContext("2d")!;
    const imageData = ctx.createImageData(interpolationResult.width, interpolationResult.height);
    const colorizeStartedAt = performance.now();
    const colorData = gridToImageData(interpolationResult, true);
    const colorizeMs = performance.now() - colorizeStartedAt;
    imageData.data.set(colorData);
    ctx.putImageData(imageData, 0, 0);

    const { west, east, south, north } = interpolationResult.bounds;
    const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
      [west, north], // top-left
      [east, north], // top-right
      [east, south], // bottom-right
      [west, south], // bottom-left
    ];

    const refreshCanvasSource = (source: maplibregl.CanvasSource) => {
      recordHeatmapDebug((state) => {
        state.sourceRefreshes += 1;
      });
      source.play();
      map.once("render", () => {
        if (map.getSource(HEATMAP_SOURCE_ID) === source) {
          source.pause();
        }
      });
    };

    const existingSource = map.getSource(HEATMAP_SOURCE_ID) as maplibregl.CanvasSource | undefined;
    if (existingSource) {
      existingSource.setCoordinates(coordinates);
      refreshCanvasSource(existingSource);
    } else {
      map.addSource(HEATMAP_SOURCE_ID, {
        type: "canvas",
        canvas,
        animate: false,
        coordinates,
      });

      // Add layer below the sensor circles
      const beforeLayer = map.getLayer(LAYER_ID) ? LAYER_ID : undefined;
      map.addLayer(
        {
          id: HEATMAP_LAYER_ID,
          type: "raster",
          source: HEATMAP_SOURCE_ID,
          paint: {
            "raster-opacity": 0.74,
            "raster-fade-duration": 0,
            "raster-resampling": "linear",
          },
        },
        beforeLayer,
      );
      const canvasSource = map.getSource(HEATMAP_SOURCE_ID) as maplibregl.CanvasSource | undefined;
      if (canvasSource) refreshCanvasSource(canvasSource);
    }

    recordHeatmapDebug((state) => {
      state.lastColorizeMs = colorizeMs;
      state.lastMainThreadRenderMs = performance.now() - renderStartedAt;
    });
  }, [interpolationResult, styleReloadTick, recordHeatmapDebug]);

  // Toggle sensor circle visibility based on map mode
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    syncSensorLayerPaint(map);
  }, [syncSensorLayerPaint, styleReloadTick]);

  // Cleanup heatmap layer when switching back to markers mode
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (mapMode === "markers") {
      if (map.getLayer(HEATMAP_LAYER_ID)) map.removeLayer(HEATMAP_LAYER_ID);
      if (map.getSource(HEATMAP_SOURCE_ID)) {
        map.removeSource(HEATMAP_SOURCE_ID);
        recordHeatmapDebug((state) => {
          state.sourceRemovals += 1;
        });
      }
    }
  }, [mapMode, recordHeatmapDebug]);

  // Track the map viewport in heatmap+followView mode so interpolation bounds follow pan/zoom.
  // Debounced so we don't recompute while the user is actively dragging.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapMode !== "heatmap" || !followView) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const updateBounds = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        syncViewState(map);
      }, RESIZE_RECOMPUTE_DEBOUNCE_MS);
    };

    // Seed once for the current view, then subscribe to future moves.
    const seed = () => {
      syncViewState(map);
    };
    if (map.isStyleLoaded()) seed();
    else map.once("load", seed);

    map.on("moveend", updateBounds);
    map.on("zoomend", updateBounds);
    return () => {
      map.off("moveend", updateBounds);
      map.off("zoomend", updateBounds);
      if (timer) clearTimeout(timer);
    };
  }, [mapMode, followView, syncViewState]);

  const windowLabel = pm25WindowOptions.find((o) => o.value === pm25Window)?.label ?? "1hr";
  const averagePm = filtered
    ? interpolationPoints.reduce((sum, point) => sum + point.value, 0) / Math.max(interpolationPoints.length, 1)
    : 0;
  const meanBand = pm25ToAqiBand(averagePm);
  const heatmapMethodLabel = interpMethod === "idw" ? `IDW · p=${idwPower}` : "Ordinary kriging";

  const addOverlay = useCallback((name: string, raw: unknown) => {
    try {
      const data = parseOverlayGeoJson(raw);
      setOverlays((prev) => {
        const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        const color = OVERLAY_PALETTE[prev.length % OVERLAY_PALETTE.length];
        return [...prev, { id, name, color, data }];
      });
      setOverlayError(null);
    } catch (err) {
      setOverlayError(err instanceof Error ? err.message : "Unable to load GeoJSON");
    }
  }, []);

  const handleOverlayFile = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      addOverlay(file.name, parsed);
    } catch (err) {
      setOverlayError(err instanceof Error ? `Could not read ${file.name}: ${err.message}` : "Unable to read file");
    }
  }, [addOverlay]);

  const handleOverlayUrl = useCallback(async (url: string) => {
    const trimmed = url.trim();
    if (!trimmed) return;
    try {
      const res = await fetch(trimmed);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = await res.json();
      const name = trimmed.split("/").pop() || trimmed;
      addOverlay(name, parsed);
      setOverlayUrl("");
    } catch (err) {
      setOverlayError(err instanceof Error ? `Fetch failed: ${err.message}` : "Unable to fetch URL");
    }
  }, [addOverlay]);

  const removeOverlay = useCallback((id: string) => {
    setOverlays((prev) => prev.filter((o) => o.id !== id));
  }, []);
  const heatmapRuntimeLabel = interpolationMeta?.durationMs != null
    ? `${interpolationMeta.durationMs.toFixed(0)} ms`
    : isComputing
      ? "Running…"
      : null;

  return (
    <div className={styles.layout}>
      <div className={styles.toolbar}>
        <div className={styles.modeToggle}>
          <button
            className={`${styles.modeButton} ${mapMode === "markers" ? styles.modeButtonActive : ""}`}
            onClick={() => setMapMode("markers")}
          >
            Markers
          </button>
          <button
            className={`${styles.modeButton} ${mapMode === "heatmap" ? styles.modeButtonActive : ""}`}
            onClick={() => setMapMode("heatmap")}
          >
            Heatmap
          </button>
        </div>

        {mapMode === "heatmap" && (
          <div className={styles.interpControls}>
            <select
              className={styles.select}
              value={interpMethod}
              onChange={(e) => setInterpMethod(e.target.value as InterpolationMethod)}
            >
              <option value="idw">IDW</option>
              <option value="kriging">Kriging</option>
            </select>
            <select
              className={styles.select}
              value={gridRes}
              onChange={(e) => setGridRes(Number(e.target.value))}
            >
              <option value={50}>Low (50x50)</option>
              <option value={100}>Medium (100x100)</option>
              <option value={200}>High (200x200)</option>
            </select>
            {interpMethod === "idw" && (
              <>
                <span className={styles.rangeLabel}>p={idwPower}</span>
                <input
                  type="range"
                  className={styles.rangeInput}
                  min={1}
                  max={4}
                  step={0.5}
                  value={idwPower}
                  onChange={(e) => setIdwPower(Number(e.target.value))}
                />
              </>
            )}
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={followView}
                onChange={() => setFollowView((v) => !v)}
              />
              Follow view
            </label>
            <button
              type="button"
              className={styles.modeButton}
              onClick={() => {
                const map = mapRef.current;
                if (map) {
                  syncViewState(map);
                }
                setRecomputeTick((t) => t + 1);
              }}
              title="Recompute interpolation for the current viewport"
            >
              Recompute
            </button>
            {mapMode === "heatmap" && (
              <div className={styles.heatmapStatus}>
                <span className={styles.statusPill}>{heatmapMethodLabel}</span>
                {interpolationMeta && (
                  <span className={styles.statusPill}>
                    {interpolationMeta.pointsUsed}/{interpolationMeta.totalPoints} sensors
                  </span>
                )}
                {interpolationMeta && (
                  <span className={styles.statusPill}>
                    {interpolationMeta.gridWidth}x{interpolationMeta.gridHeight}
                  </span>
                )}
                {interpolationMeta?.capped && (
                  <span className={styles.statusPillMuted}>Capped for speed</span>
                )}
                {interpolationMeta?.krigingNeighbors && (
                  <span className={styles.statusPillMuted}>{interpolationMeta.krigingNeighbors} neighbors</span>
                )}
                {interpolationMeta?.krigingTileSize && (
                  <span className={styles.statusPillMuted}>{interpolationMeta.krigingTileSize}x{interpolationMeta.krigingTileSize} tiles</span>
                )}
                {interpolationMeta?.krigingDiagnostics && (
                  <span className={styles.statusPillMuted}>
                    {interpolationMeta.krigingDiagnostics.mode === "exact"
                      ? "Exact solve"
                      : `${interpolationMeta.krigingDiagnostics.effectiveTileSize}x${interpolationMeta.krigingDiagnostics.effectiveTileSize} active tiles`}
                  </span>
                )}
                {interpolationMeta?.krigingDiagnostics?.fallbackReason && (
                  <span className={styles.statusPillMuted}>Tile fallback</span>
                )}
                {interpolationMeta?.krigingDiagnostics && import.meta.env.DEV && (
                  <span className={styles.statusPillMuted}>
                    seams {(interpolationMeta.krigingDiagnostics.artifacts.tileBoundaryOutlierRate * 100).toFixed(0)}%
                  </span>
                )}
                {heatmapRuntimeLabel && (
                  <span className={styles.computing}>{heatmapRuntimeLabel}</span>
                )}
                {interpolationMeta?.error && (
                  <span className={styles.statusPillError}>Interpolation fallback</span>
                )}
              </div>
            )}
          </div>
        )}

        <input
          aria-label="Sensor search"
          className={styles.search}
          placeholder="Search by label..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="PM2.5 time window"
          className={styles.select}
          value={pm25Window}
          onChange={(e) => setPm25Window(e.target.value as Pm25Window)}
        >
          {pm25WindowOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              PM2.5 {opt.label}
            </option>
          ))}
        </select>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={outsideOnly}
            onChange={() => setOutsideOnly((v) => !v)}
          />
          Outside only
        </label>

        <div className={styles.overlayControls}>
          <button
            type="button"
            className={styles.modeButton}
            onClick={() => overlayInputRef.current?.click()}
            title="Load a GeoJSON overlay (boundaries, emissions, traffic, etc.)"
          >
            Load overlay
          </button>
          <input
            ref={overlayInputRef}
            type="file"
            accept=".geojson,.json,application/geo+json,application/json"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleOverlayFile(file);
              e.target.value = "";
            }}
          />
          <input
            type="url"
            className={styles.search}
            placeholder="…or paste a GeoJSON URL"
            value={overlayUrl}
            onChange={(e) => setOverlayUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleOverlayUrl(overlayUrl);
              }
            }}
          />
          {overlays.map((overlay) => (
            <span
              key={overlay.id}
              className={styles.statusPill}
              style={{ borderColor: overlay.color, color: overlay.color }}
              title={overlay.name}
            >
              {overlay.name.length > 24 ? `${overlay.name.slice(0, 24)}…` : overlay.name}
              <button
                type="button"
                onClick={() => removeOverlay(overlay.id)}
                style={{ marginLeft: 6, background: "none", border: "none", cursor: "pointer", color: "inherit" }}
                aria-label={`Remove overlay ${overlay.name}`}
              >
                ×
              </button>
            </span>
          ))}
          {overlayError && <span className={styles.statusPillError}>{overlayError}</span>}
        </div>
      </div>

      <div className={styles.stats}>
        <StatCard label="Sensors" value={filtered ? `${filtered.records.length}` : "..."} />
        <StatCard
          label={`Mean PM2.5 (${windowLabel})`}
          value={filtered ? `${averagePm.toFixed(1)}` : "..."}
          tone={meanBand.label === "Good" ? "good" : "warn"}
        />
        <StatCard label="AQI" value={filtered ? meanBand.label : "..."} />
      </div>

      <div className={styles.mapWrap}>
        <div ref={mapContainerCallback} className={styles.map} />
        {mapMode === "heatmap" && (
          <div className={styles.legend}>
            <div className={styles.legendTitle}>AQI Surface</div>
            <div className={styles.legendSubtitle}>{heatmapMethodLabel}</div>
            <div className={styles.legendBar} />
            <div className={styles.legendLabels}>
              <span>0</span>
              <span>50</span>
              <span>100</span>
              <span>150</span>
              <span>200</span>
              <span>300</span>
            </div>
            {interpolationMeta && (
              <div className={styles.legendMeta}>
                <span>{interpolationMeta.pointsUsed} sensors in play</span>
                <span>{interpolationMeta.gridWidth}x{interpolationMeta.gridHeight} grid</span>
                {interpolationMeta.capped && <span>Viewport-prioritized sampling</span>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
