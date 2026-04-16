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
const MISSING_PM_COLOR = "#94a3b8";
const MIN_INTERPOLATION_POINTS = 3;
const VIEWPORT_PADDING_RATIO = 0.2;
const MIN_GRID_RESOLUTION = 50;
const MAX_GRID_EDGE = 384;
const DEFAULT_KRIGING_NEIGHBORS = 12;
const DEFAULT_KRIGING_TILE_SIZE = 4;
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
  durationMs?: number;
  error?: string;
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

function deriveGridDimensions(baseResolution: number, mapSize: MapSize): { width: number; height: number } {
  const safeWidth = Math.max(mapSize.width, 1);
  const safeHeight = Math.max(mapSize.height, 1);
  const aspectRatio = safeWidth / safeHeight;

  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    return { width: baseResolution, height: baseResolution };
  }

  if (aspectRatio >= 1) {
    return {
      width: Math.min(MAX_GRID_EDGE, Math.max(2, Math.round(baseResolution * aspectRatio))),
      height: Math.max(2, baseResolution),
    };
  }

  return {
    width: Math.max(2, baseResolution),
    height: Math.min(MAX_GRID_EDGE, Math.max(2, Math.round(baseResolution / aspectRatio))),
  };
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

export default function MapPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const heatmapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const interpolationWorkerRef = useRef<Worker | null>(null);
  const interpolationJobIdRef = useRef(0);
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

    const zoomForAdaptiveWork = followView ? viewZoom : null;
    const adjustedGridRes = deriveZoomAdjustedGridResolution(gridRes, zoomForAdaptiveWork);
    const krigingNeighbors = interpMethod === "kriging"
      ? deriveKrigingNeighborCount(zoomForAdaptiveWork)
      : undefined;
    const krigingTileSize = interpMethod === "kriging"
      ? deriveKrigingTileSize(zoomForAdaptiveWork)
      : undefined;
    const { width, height } = deriveGridDimensions(adjustedGridRes, mapSize);
    return {
      bounds,
      points: selected,
      gridWidth: width,
      gridHeight: height,
      totalPoints: interpolationPoints.length,
      capped,
      krigingNeighbors,
      krigingTileSize,
    };
    // recomputeTick is intentionally a dep so the manual "Recompute" button re-runs this
    // even when bounds/params are unchanged.
  }, [mapMode, interpolationPoints, interpMethod, gridRes, mapSize, followView, viewBounds, viewZoom, recomputeTick]);

  useEffect(() => {
    const worker = new Worker(new URL("../workers/interpolation.worker.ts", import.meta.url), { type: "module" });
    interpolationWorkerRef.current = worker;

    worker.onmessage = (event: MessageEvent<InterpolationWorkerResponse>) => {
      const response = event.data;
      if (response.jobId !== interpolationJobIdRef.current) return;

      startTransition(() => {
        if (!response.ok) {
          setIsComputing(false);
          setInterpolationResult(null);
          setInterpolationMeta((previous) => (
            previous
              ? { ...previous, durationMs: response.durationMs, error: response.error }
              : previous
          ));
          return;
        }

        setIsComputing(false);
        setInterpolationResult({
          ...response.result,
          values: new Float64Array(response.result.values),
        });
        setInterpolationMeta((previous) => (
          previous
            ? { ...previous, durationMs: response.durationMs, error: undefined }
            : previous
        ));
      });
    };

    return () => {
      worker.terminate();
      interpolationWorkerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const worker = interpolationWorkerRef.current;
    if (!worker) return;

    if (!interpolationWorkload) {
      setIsComputing(false);
      setInterpolationResult(null);
      setInterpolationMeta(null);
      return;
    }

    const jobId = interpolationJobIdRef.current + 1;
    interpolationJobIdRef.current = jobId;

    setIsComputing(true);
    setInterpolationMeta({
      totalPoints: interpolationWorkload.totalPoints,
      pointsUsed: interpolationWorkload.points.length,
      gridWidth: interpolationWorkload.gridWidth,
      gridHeight: interpolationWorkload.gridHeight,
      capped: interpolationWorkload.capped,
      krigingNeighbors: interpolationWorkload.krigingNeighbors,
      krigingTileSize: interpolationWorkload.krigingTileSize,
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
  }, [interpolationWorkload, interpMethod, idwPower]);

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

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const syncSize = () => {
      const nextSize = {
        width: Math.max(node.clientWidth, 1),
        height: Math.max(node.clientHeight, 1),
      };

      setMapSize((previous) => (
        previous.width === nextSize.width && previous.height === nextSize.height
          ? previous
          : nextSize
      ));

      const map = mapRef.current;
      if (map) {
        map.resize();
        if (mapMode === "heatmap" && followView) {
          setViewBounds(getMapBounds(map));
          setViewZoom(map.getZoom());
        }
      }
    };

    syncSize();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => {
        syncSize();
      });
      observer.observe(node);
      return () => observer.disconnect();
    }

    window.addEventListener("resize", syncSize);
    return () => window.removeEventListener("resize", syncSize);
  }, [mapMode, followView]);

  // Update GeoJSON data when the filtered set changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(geojson);
    }
  }, [geojson]);

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
    if (!map || !map.isStyleLoaded()) return;

    if (!interpolationResult) {
      // Remove heatmap layer if exists
      if (map.getLayer(HEATMAP_LAYER_ID)) map.removeLayer(HEATMAP_LAYER_ID);
      if (map.getSource(HEATMAP_SOURCE_ID)) map.removeSource(HEATMAP_SOURCE_ID);
      return;
    }

    // Reuse the backing canvas to avoid repeated allocations during pan/zoom.
    const canvas = heatmapCanvasRef.current ?? document.createElement("canvas");
    heatmapCanvasRef.current = canvas;
    canvas.width = interpolationResult.width;
    canvas.height = interpolationResult.height;
    const ctx = canvas.getContext("2d")!;
    const imageData = ctx.createImageData(interpolationResult.width, interpolationResult.height);
    const colorData = gridToImageData(interpolationResult, true);
    imageData.data.set(colorData);
    ctx.putImageData(imageData, 0, 0);

    const dataUrl = canvas.toDataURL();
    const { west, east, south, north } = interpolationResult.bounds;
    const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
      [west, north], // top-left
      [east, north], // top-right
      [east, south], // bottom-right
      [west, south], // bottom-left
    ];

    // Add or update the image source
    const existingSource = map.getSource(HEATMAP_SOURCE_ID) as maplibregl.ImageSource | undefined;
    if (existingSource) {
      existingSource.updateImage({ url: dataUrl, coordinates });
    } else {
      map.addSource(HEATMAP_SOURCE_ID, {
        type: "image",
        url: dataUrl,
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
    }
  }, [interpolationResult, styleReloadTick]);

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
      if (map.getSource(HEATMAP_SOURCE_ID)) map.removeSource(HEATMAP_SOURCE_ID);
    }
  }, [mapMode]);

  // Track the map viewport in heatmap+followView mode so interpolation bounds follow pan/zoom.
  // Debounced so we don't recompute while the user is actively dragging.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapMode !== "heatmap" || !followView) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const updateBounds = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        setViewBounds(getMapBounds(map));
        setViewZoom(map.getZoom());
      }, 200);
    };

    // Seed once for the current view, then subscribe to future moves.
    const seed = () => {
      setViewBounds(getMapBounds(map));
      setViewZoom(map.getZoom());
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
  }, [mapMode, followView]);

  const windowLabel = pm25WindowOptions.find((o) => o.value === pm25Window)?.label ?? "1hr";
  const averagePm = filtered
    ? interpolationPoints.reduce((sum, point) => sum + point.value, 0) / Math.max(interpolationPoints.length, 1)
    : 0;
  const meanBand = pm25ToAqiBand(averagePm);
  const heatmapMethodLabel = interpMethod === "idw" ? `IDW · p=${idwPower}` : "Ordinary kriging";
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
                  setViewBounds(getMapBounds(map));
                  setViewZoom(map.getZoom());
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
