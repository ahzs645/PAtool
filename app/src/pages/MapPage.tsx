import { startTransition, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  boundsToQuad,
  captureMapImage,
  MapCanvasLayer,
  MapCircleLayer,
  MapControls,
  MapGeoJsonLayer,
  type MapRef,
  type MapViewState,
} from "@pgmaps/geo-toolkit/map";

import {
  pasFilter,
  type PasPm25Slice,
  pm25ToAqiBand,
  type PasCollection,
  type InterpolationGrid,
  type InterpolationPoint,
  type InterpolationMethod,
} from "@patool/shared";

import { Button, StatCard } from "../components";
import { getJson } from "../lib/api";
import { PaMap } from "../components/map/PaMap";
import { downloadBlob, downloadCsv, objectsToCsv, suggestFilename } from "../lib/exporters";
import type { InterpolationBounds, InterpolationWorkerResponse } from "../lib/interpolationProtocol";
import { urlCodec, useUrlState } from "../hooks/useUrlState";
import {
  MAX_IDW_GRID_CELLS,
  MAX_KRIGING_GRID_CELLS,
  MIN_INTERPOLATION_POINTS,
  OVERLAY_PALETTE,
  RESIZE_RECOMPUTE_DEBOUNCE_MS,
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
  paintInterpolationCanvas,
  quantizeMapBounds,
  quantizeZoom,
  selectInterpolationPoints,
} from "./map/interpolation";
import { createInterpolationWorker } from "./map/interpolationWorker";
import { HeatmapLegend } from "./map/HeatmapLegend";
import { MapToolbar } from "./map/MapToolbar";
import { parseOverlayGeoJson } from "./map/overlays";
import { buildGeoJson, buildSensorPopupHtml, getPm25ValueForSlice } from "./map/sensors";
import {
  pm25WindowOptions,
  type HeatmapDebugState,
  type InterpolationMeta,
  type MapMode,
  type MapSize,
  type OverlayLayer,
  type PatoolDebugWindow,
  type Pm25Window,
  type SensorMapMetric,
} from "./map/types";
import styles from "./MapPage.module.css";

// Draw order on the map: heatmap surface, then user overlays, then sensors.
const HEATMAP_ORDER = 1;
const OVERLAY_ORDER = 2;
const SENSOR_ORDER = 3;

export default function MapPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapRef | null>(null);
  // One backing canvas for the surface, repainted in place on every result.
  const [heatmapCanvas] = useState(() => document.createElement("canvas"));
  const latestViewRef = useRef<MapViewState | null>(null);
  const interpolationWorkerRef = useRef<Worker | null>(null);
  const interpolationJobIdRef = useRef(0);
  const heatmapDebugRef = useRef<HeatmapDebugState>(createHeatmapDebugState());
  const selectedPointKeysRef = useRef<string[]>([]);
  const rawMapSizeRef = useRef<MapSize>({ width: 1, height: 1 });
  const workerBusyRef = useRef(false);
  const activeJobMethodRef = useRef<InterpolationMethod | null>(null);

  const [query, setQuery] = useUrlState("q", urlCodec.string, "");
  const [outsideOnly, setOutsideOnly] = useUrlState("outdoor", urlCodec.boolean(true), true);
  const [pm25Window, setPm25Window] = useUrlState<Pm25Window>(
    "win",
    urlCodec.enum<Pm25Window>(
      ["pm25Current", "pm25_10min", "pm25_30min", "pm25_1hr", "pm25_6hr", "pm25_1day", "pm25_1week"],
      "pm25_1hr",
    ),
    "pm25_1hr",
  );
  const [pm25Slice, setPm25Slice] = useUrlState<PasPm25Slice>(
    "slice",
    urlCodec.enum<PasPm25Slice>(["current", "mean", "max", "min"], "current"),
    "current",
  );
  const [sensorMetric, setSensorMetric] = useUrlState<SensorMapMetric>(
    "metric",
    urlCodec.enum<SensorMapMetric>(["pm25", "humidity", "temperature"], "pm25"),
    "pm25",
  );
  const [mapMode, setMapMode] = useUrlState<MapMode>(
    "mode",
    urlCodec.enum<MapMode>(["markers", "heatmap"], "markers"),
    "markers",
  );
  const [showSensorMarkers, setShowSensorMarkers] = useState(true);
  const [interpMethod, setInterpMethod] = useUrlState<InterpolationMethod>(
    "method",
    urlCodec.enum<InterpolationMethod>(["idw", "kriging"], "idw"),
    "idw",
  );
  const [gridRes, setGridRes] = useUrlState("res", urlCodec.number(100), 100);
  const [idwPower, setIdwPower] = useUrlState("pow", urlCodec.number(2), 2);
  const [followView, setFollowView] = useState(true);
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
    return buildGeoJson(filtered.records, pm25Window, sensorMetric, pm25Slice);
  }, [filtered, pm25Window, sensorMetric, pm25Slice]);

  const interpolationPoints = useMemo(() => {
    if (!filtered) return [];

    return filtered.records.flatMap((record): InterpolationPoint[] => {
      const pm25 = getPm25ValueForSlice(record, pm25Window, pm25Slice);
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
  }, [filtered, pm25Window, pm25Slice]);

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
  const applyViewState = useCallback((view: MapViewState) => {
    const nextBounds = quantizeMapBounds(view.bounds);
    const nextZoom = quantizeZoom(view.zoom);

    setViewBounds((previous) => (
      boundsEqual(previous, nextBounds) ? previous : nextBounds
    ));
    setViewZoom((previous) => (
      previous === nextZoom ? previous : nextZoom
    ));
  }, []);

  // Interpolation bounds follow pan/zoom/resize in heatmap+followView mode,
  // debounced so a drag or a divider resize recomputes once it settles.
  const followViewportRef = useRef(false);
  followViewportRef.current = mapMode === "heatmap" && followView;
  const viewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMoveEnd = useCallback((view: MapViewState) => {
    latestViewRef.current = view;
    if (!followViewportRef.current) return;
    if (viewTimerRef.current) clearTimeout(viewTimerRef.current);
    viewTimerRef.current = setTimeout(() => {
      viewTimerRef.current = null;
      applyViewState(view);
    }, RESIZE_RECOMPUTE_DEBOUNCE_MS);
  }, [applyViewState]);

  // Seed the current view at once when following starts.
  useEffect(() => {
    if (mapMode !== "heatmap" || !followView) return;
    if (latestViewRef.current) applyViewState(latestViewRef.current);
    return () => {
      if (viewTimerRef.current) clearTimeout(viewTimerRef.current);
      viewTimerRef.current = null;
    };
  }, [mapMode, followView, applyViewState]);

  // Track the map's pixel size; the grid's aspect ratio follows it.
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
  }, [followView, viewZoom, gridRes, interpMethod]);

  useEffect(() => {
    setMapSize(rawMapSizeRef.current);
  }, [gridRes, interpMethod]);

  const showHeatmapLayer = mapMode === "heatmap" && interpolationResult !== null;

  // Paint before the canvas layer's own effect uploads the pixels: layout
  // effects run ahead of every passive effect in the commit.
  useLayoutEffect(() => {
    if (!showHeatmapLayer || !interpolationResult) return;
    const renderStartedAt = performance.now();
    const colorizeMs = paintInterpolationCanvas(interpolationResult, heatmapCanvas);
    recordHeatmapDebug((state) => {
      state.sourceRefreshes += 1;
      state.lastColorizeMs = colorizeMs;
      state.lastMainThreadRenderMs = performance.now() - renderStartedAt;
    });
  }, [heatmapCanvas, interpolationResult, recordHeatmapDebug, showHeatmapLayer]);

  useEffect(() => {
    if (!showHeatmapLayer) return;
    return () => {
      recordHeatmapDebug((state) => {
        state.sourceRemovals += 1;
      });
    };
  }, [recordHeatmapDebug, showHeatmapLayer]);

  const windowLabel = pm25WindowOptions.find((o) => o.value === pm25Window)?.label ?? "1hr";
  const sliceLabel = pm25Slice === "current" ? windowLabel : pm25Slice;
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
    if (latestViewRef.current) applyViewState(latestViewRef.current);
    setRecomputeTick((tick) => tick + 1);
  }, [applyViewState]);

  const heatmapRuntimeLabel = interpolationMeta?.durationMs != null
    ? `${interpolationMeta.durationMs.toFixed(0)} ms`
    : isComputing
      ? "Running…"
      : null;

  const sensorsDimmed = mapMode === "heatmap";

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
        pm25Slice={pm25Slice}
        setPm25Slice={setPm25Slice}
        sensorMetric={sensorMetric}
        setSensorMetric={setSensorMetric}
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
          label={`Mean PM2.5 (${sliceLabel})`}
          value={filtered ? `${averagePm.toFixed(1)}` : "..."}
          tone={meanBand.label === "Good" ? "good" : "warn"}
        />
        <StatCard label="AQI" value={filtered ? meanBand.label : "..."} />
        <StatCard
          label="Marker metric"
          value={sensorMetric === "pm25" ? `PM2.5 ${sliceLabel}` : sensorMetric === "humidity" ? "Humidity" : "Temperature"}
        />
        <div className={styles.exportButtons}>
          <Button
            variant="secondary"
            disabled={!filtered}
            onClick={() => {
              if (!filtered) return;
              const rows = filtered.records.map((record) => ({
                id: record.id,
                label: record.label,
                latitude: record.latitude,
                longitude: record.longitude,
                locationType: record.locationType,
                pm25: getPm25ValueForSlice(record, pm25Window, pm25Slice) ?? null,
                pm25Current: record.pm25Current ?? null,
                humidity: record.humidity ?? null,
                temperature: record.temperature ?? null,
              }));
              downloadCsv(suggestFilename(`map-${pm25Window}-${pm25Slice}`, "csv"), objectsToCsv(rows));
            }}
          >
            CSV (filtered sensors)
          </Button>
          <Button
            variant="secondary"
            onClick={async () => {
              const map = mapRef.current;
              if (!map) return;
              downloadBlob(suggestFilename(`map-${pm25Window}`, "png"), await captureMapImage(map));
            }}
          >
            PNG snapshot
          </Button>
        </div>
      </div>

      <div className={styles.mapWrap}>
        <div ref={containerRef} className={styles.map}>
          <PaMap
            ref={mapRef}
            center={[-103.23, 44.08]}
            zoom={4}
            onMoveEnd={handleMoveEnd}
            controls={<MapControls position="top-right" showZoom showCompass showLocate trackLocation />}
          >
            {showHeatmapLayer && interpolationResult && (
              <MapCanvasLayer
                canvas={heatmapCanvas}
                coordinates={boundsToQuad(interpolationResult.bounds)}
                revision={interpolationResult}
                opacity={0.74}
                layerOrder={HEATMAP_ORDER}
              />
            )}
            {overlays.map((overlay) => (
              <MapGeoJsonLayer key={overlay.id} data={overlay.data} color={overlay.color} layerOrder={OVERLAY_ORDER} />
            ))}
            <MapCircleLayer
              data={geojson}
              color={["get", "color"]}
              radius={sensorsDimmed ? 3 : 6}
              opacity={sensorsDimmed ? 0.35 : 0.85}
              strokeColor="#ffffff"
              strokeWidth={1.5}
              visible={showSensorMarkers}
              layerOrder={SENSOR_ORDER}
              clickHtml={buildSensorPopupHtml}
            />
          </PaMap>
        </div>
        {mapMode === "heatmap" && (
          <HeatmapLegend heatmapMethodLabel={heatmapMethodLabel} interpolationMeta={interpolationMeta} />
        )}
      </div>
    </div>
  );
}
