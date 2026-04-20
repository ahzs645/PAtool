import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import maplibregl from "maplibre-gl";

import {
  pasFilter,
  pm25ToAqiBand,
  type PasCollection,
  type InterpolationGrid,
  type InterpolationPoint,
  type InterpolationMethod,
} from "@patool/shared";

import { StatCard } from "../components";
import { getJson } from "../lib/api";
import type { InterpolationBounds, InterpolationWorkerResponse } from "../lib/interpolationProtocol";
import { useTheme } from "../hooks/useTheme";
import {
  HEATMAP_LAYER_ID,
  HEATMAP_SOURCE_ID,
  LAYER_ID,
  MAX_IDW_GRID_CELLS,
  MAX_KRIGING_GRID_CELLS,
  MIN_INTERPOLATION_POINTS,
  OVERLAY_ID_PREFIX,
  OVERLAY_PALETTE,
  RESIZE_RECOMPUTE_DEBOUNCE_MS,
  SOURCE_ID,
  STYLE_DARK,
  STYLE_LIGHT,
} from "./map/config";
import {
  boundsEqual,
  canStabilizeKrigingSelection,
  computeSelectionOverlap,
  createHeatmapDebugState,
  deriveGridDimensions,
  deriveKrigingNeighborCount,
  deriveKrigingTileSize,
  deriveZoomAdjustedGridResolution,
  getInterpolationPointKey,
  getMapBounds,
  paintInterpolationCanvas,
  quantizeMapBounds,
  quantizeZoom,
  selectInterpolationPoints,
} from "./map/interpolation";
import { createInterpolationWorker } from "./map/interpolationWorker";
import { HeatmapLegend } from "./map/HeatmapLegend";
import { MapToolbar } from "./map/MapToolbar";
import { parseOverlayGeoJson } from "./map/overlays";
import { buildGeoJson, buildSensorPopupHtml, getPm25ValueForWindow } from "./map/sensors";
import {
  pm25WindowOptions,
  type HeatmapDebugState,
  type InterpolationMeta,
  type MapMode,
  type MapSize,
  type OverlayLayer,
  type PatoolDebugWindow,
  type Pm25Window,
} from "./map/types";
import styles from "./MapPage.module.css";

import "maplibre-gl/dist/maplibre-gl.css";

export default function MapPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const heatmapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const interpolationWorkerRef = useRef<Worker | null>(null);
  const interpolationJobIdRef = useRef(0);
  const heatmapDebugRef = useRef<HeatmapDebugState>(createHeatmapDebugState());
  const selectedPointKeysRef = useRef<string[]>([]);
  const sensorLayerHandlersAttachedRef = useRef(false);
  const rawMapSizeRef = useRef<MapSize>({ width: 1, height: 1 });
  const workerBusyRef = useRef(false);
  const activeJobMethodRef = useRef<InterpolationMethod | null>(null);
  const { theme } = useTheme();

  const [query, setQuery] = useState("");
  const [outsideOnly, setOutsideOnly] = useState(true);
  const [pm25Window, setPm25Window] = useState<Pm25Window>("pm25_1hr");
  const [mapMode, setMapMode] = useState<MapMode>("markers");
  const [showSensorMarkers, setShowSensorMarkers] = useState(true);
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
        canStabilizeKrigingSelection(
          overlap.overlapPct,
          selectedPointKeysRef.current.length,
          pointKeys.length,
        )
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
    if (!map.getSource(SOURCE_ID)) {
      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: geojsonRef.current,
      });
    }

    if (!map.getLayer(LAYER_ID)) {
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
    }

    if (sensorLayerHandlersAttachedRef.current) return;
    sensorLayerHandlersAttachedRef.current = true;

    map.on("click", LAYER_ID, (e) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const props = feature.properties!;
      new maplibregl.Popup({ offset: 10 })
        .setLngLat(e.lngLat)
        .setHTML(buildSensorPopupHtml(props))
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

    map.setLayoutProperty(LAYER_ID, "visibility", showSensorMarkers ? "visible" : "none");
    if (!showSensorMarkers) return;

    if (mapMode === "heatmap") {
      map.setPaintProperty(LAYER_ID, "circle-radius", 3);
      map.setPaintProperty(LAYER_ID, "circle-opacity", 0.35);
      return;
    }

    map.setPaintProperty(LAYER_ID, "circle-radius", 6);
    map.setPaintProperty(LAYER_ID, "circle-opacity", 0.85);
  }, [mapMode, showSensorMarkers]);

  // Initialize map using a callback ref so it fires when the div mounts
  const mapContainerCallback = useCallback((node: HTMLDivElement | null) => {
    // Also store in containerRef for other effects
    containerRef.current = node;

    if (!node) {
      // Cleanup when unmounting
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        sensorLayerHandlersAttachedRef.current = false;
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
      setStyleReloadTick((tick) => tick + 1);
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
    const colorizeMs = paintInterpolationCanvas(interpolationResult, canvas);

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

  // Toggle sensor circle visibility and heatmap-mode emphasis.
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

  const handleRecompute = useCallback(() => {
    const map = mapRef.current;
    if (map) {
      syncViewState(map);
    }
    setRecomputeTick((tick) => tick + 1);
  }, [syncViewState]);

  const heatmapRuntimeLabel = interpolationMeta?.durationMs != null
    ? `${interpolationMeta.durationMs.toFixed(0)} ms`
    : isComputing
      ? "Running…"
      : null;

  return (
    <div className={styles.layout}>
      <MapToolbar
        mapMode={mapMode}
        setMapMode={setMapMode}
        showSensorMarkers={showSensorMarkers}
        setShowSensorMarkers={setShowSensorMarkers}
        interpMethod={interpMethod}
        setInterpMethod={setInterpMethod}
        gridRes={gridRes}
        setGridRes={setGridRes}
        idwPower={idwPower}
        setIdwPower={setIdwPower}
        followView={followView}
        setFollowView={setFollowView}
        onRecompute={handleRecompute}
        heatmapMethodLabel={heatmapMethodLabel}
        heatmapRuntimeLabel={heatmapRuntimeLabel}
        interpolationMeta={interpolationMeta}
        query={query}
        setQuery={setQuery}
        pm25Window={pm25Window}
        setPm25Window={setPm25Window}
        outsideOnly={outsideOnly}
        setOutsideOnly={setOutsideOnly}
        overlayInputRef={overlayInputRef}
        overlayUrl={overlayUrl}
        setOverlayUrl={setOverlayUrl}
        overlays={overlays}
        overlayError={overlayError}
        onOverlayFile={handleOverlayFile}
        onOverlayUrl={handleOverlayUrl}
        onRemoveOverlay={removeOverlay}
      />

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
          <HeatmapLegend heatmapMethodLabel={heatmapMethodLabel} interpolationMeta={interpolationMeta} />
        )}
      </div>
    </div>
  );
}
