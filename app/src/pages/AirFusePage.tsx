import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EChartsCoreOption } from "echarts/core";
import maplibregl from "maplibre-gl";

import { Card, Loader, PageHeader, StatCard } from "../components";
import { EChart } from "../components/EChart";
import { apiPath } from "../lib/api";
import { useChartTheme } from "../hooks/useChartTheme";
import { useTheme } from "../hooks/useTheme";
import styles from "./AirFusePage.module.css";

import "maplibre-gl/dist/maplibre-gl.css";

const AIRFUSE_BUCKET_BASE_URL = "https://airnow-navigator-layers.s3.us-east-2.amazonaws.com";
const AIRFUSE_SOURCE_REFERENCE = {
  upstream: "https://github.com/barronh/airfuse",
  localPath: "/Users/ahmadjalil/Downloads/airfuse-main",
  example: "/Users/ahmadjalil/Downloads/airfuse-main/examples/typical/map.html",
};

const STYLE_LIGHT = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const STYLE_DARK = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const AIRFUSE_SOURCE_ID = "airfuse-surface";
const AIRFUSE_FILL_LAYER_ID = "airfuse-surface-fill";
const AIRFUSE_LINE_LAYER_ID = "airfuse-surface-line";

type AirFuseLayerKey = "airfuse-pm25" | "airfuse-o3" | "goes-pm25";
type AirFuseSource = "fusion" | "goes";
type AirFuseSpecies = "PM25" | "O3";
type ArtifactKind = "geojson" | "csv" | "netcdf";

type AirFuseLayerConfig = {
  key: AirFuseLayerKey;
  label: string;
  shortLabel: string;
  source: AirFuseSource;
  species: AirFuseSpecies;
  expectedDailyCount: number;
  unit: string;
  observedColumn?: string;
  predictedColumn?: string;
};

type AirFuseIndex = Record<string, unknown>;
type AirFuseHourEntry = Record<string, string>;

type ActiveArtifact = {
  layer: AirFuseLayerConfig;
  timestamp: string;
  geojsonPath: string;
  csvPath?: string;
  netcdfPath?: string;
  featureCount: number;
  description?: string;
};

type ValidationResult = {
  observedColumn: string;
  predictedColumn: string;
  n: number;
  rmse: number;
  mae: number;
  bias: number;
  r: number;
  slope: number;
  intercept: number;
  maxAxis: number;
  points: Array<[number, number]>;
};

const AIRFUSE_LAYERS: Record<AirFuseLayerKey, AirFuseLayerConfig> = {
  "airfuse-pm25": {
    key: "airfuse-pm25",
    label: "AirFuse PM2.5",
    shortLabel: "AirFuse PM2.5",
    source: "fusion",
    species: "PM25",
    expectedDailyCount: 24,
    unit: "ug/m3",
    observedColumn: "pm25",
    predictedColumn: "FUSED_aVNA",
  },
  "airfuse-o3": {
    key: "airfuse-o3",
    label: "AirFuse O3",
    shortLabel: "AirFuse O3",
    source: "fusion",
    species: "O3",
    expectedDailyCount: 24,
    unit: "ppb",
    observedColumn: "ozone",
    predictedColumn: "LOO_aVNA",
  },
  "goes-pm25": {
    key: "goes-pm25",
    label: "GOES PM2.5",
    shortLabel: "GOES PM2.5",
    source: "goes",
    species: "PM25",
    expectedDailyCount: 13,
    unit: "ug/m3",
  },
};

const LAYER_OPTIONS = Object.values(AIRFUSE_LAYERS);

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function nowUtcInput(): string {
  const date = new Date();
  date.setUTCMinutes(0, 0, 0);
  date.setUTCHours(date.getUTCHours() - 3);
  return date.toISOString().slice(0, 16);
}

function inputToDate(value: string): Date {
  return new Date(`${value}:00Z`);
}

function shiftUtcInput(value: string, hours: number): string {
  const date = inputToDate(value);
  date.setUTCHours(date.getUTCHours() + hours);
  return date.toISOString().slice(0, 16);
}

function utcParts(value: string) {
  const date = inputToDate(value);
  return {
    yyyy: date.getUTCFullYear().toString(),
    mm: pad2(date.getUTCMonth() + 1),
    dd: pad2(date.getUTCDate()),
    hh: pad2(date.getUTCHours()),
  };
}

function timestampLabel(value: string): string {
  const { yyyy, mm, dd, hh } = utcParts(value);
  return `${yyyy}-${mm}-${dd} ${hh}:00Z`;
}

function airFuseProxyUrl(path: string): string {
  const explicitBase = import.meta.env.VITE_AIRFUSE_API_BASE?.replace(/\/$/, "");
  const route = `/api/airfuse/proxy?path=${encodeURIComponent(path)}`;
  return explicitBase ? `${explicitBase}${route}` : apiPath(route);
}

function airFuseRawUrl(path: string): string {
  return `${AIRFUSE_BUCKET_BASE_URL}/${path}`;
}

async function fetchAirFuseJson<T>(path: string): Promise<T> {
  const response = await fetch(airFuseProxyUrl(path));
  if (!response.ok) {
    throw new Error(`AirFuse request failed for ${path}`);
  }
  return response.json() as Promise<T>;
}

async function fetchAirFuseText(path: string): Promise<string> {
  const response = await fetch(airFuseProxyUrl(path));
  if (!response.ok) {
    throw new Error(`AirFuse request failed for ${path}`);
  }
  return response.text();
}

function artifactDirectory(layer: AirFuseLayerConfig, value: string): string {
  const { yyyy, mm, dd, hh } = utcParts(value);
  return layer.source === "goes"
    ? `goes/${layer.species}/${yyyy}/${mm}/${dd}/${hh}`
    : `fusion/${layer.species}/${yyyy}/${mm}/${dd}/${hh}`;
}

function artifactFileName(layer: AirFuseLayerConfig, value: string, kind: ArtifactKind): string | null {
  const { yyyy, mm, dd, hh } = utcParts(value);

  if (layer.key === "goes-pm25") {
    return kind === "geojson" ? `pm25_gwr_aod_exp50_${yyyy}${mm}${dd}${hh}_dnn.geojson` : null;
  }

  if (layer.key === "airfuse-o3") {
    const stem = `Fusion_O3_NAQFC_airnow_${yyyy}-${mm}-${dd}T${hh}Z`;
    if (kind === "geojson") return `${stem}.geojson`;
    if (kind === "csv") return `${stem}_CV.csv`;
    return `${stem}.nc`;
  }

  const stem = `Fusion_PM25_NAQFC_${yyyy}-${mm}-${dd}T${hh}Z`;
  if (kind === "geojson") return `${stem}.geojson`;
  if (kind === "csv") return `${stem}_AirNow_CV.csv`;
  return `${stem}.nc`;
}

function layerTree(index: AirFuseIndex | undefined, layer: AirFuseLayerConfig): Record<string, unknown> | undefined {
  const source = index?.[layer.source];
  if (!source || typeof source !== "object") return undefined;
  const species = (source as Record<string, unknown>)[layer.species];
  return species && typeof species === "object" ? species as Record<string, unknown> : undefined;
}

function hourEntry(index: AirFuseIndex | undefined, layer: AirFuseLayerConfig, value: string): AirFuseHourEntry | null {
  const tree = layerTree(index, layer);
  if (!tree) return null;
  const { yyyy, mm, dd, hh } = utcParts(value);
  const year = tree[yyyy] as Record<string, unknown> | undefined;
  const month = year?.[mm] as Record<string, unknown> | undefined;
  const day = month?.[dd] as Record<string, unknown> | undefined;
  const hour = day?.[hh] as Record<string, unknown> | undefined;
  return hour && typeof hour === "object" ? hour as AirFuseHourEntry : null;
}

function resolveArtifactPath(
  index: AirFuseIndex | undefined,
  layer: AirFuseLayerConfig,
  value: string,
  kind: ArtifactKind,
): string | null {
  const fileName = artifactFileName(layer, value, kind);
  if (!fileName) return null;
  const indexed = hourEntry(index, layer, value)?.[fileName];
  return indexed ?? `${artifactDirectory(layer, value)}/${fileName}`;
}

function maxDateFromIndex(index: AirFuseIndex | undefined, layer: AirFuseLayerConfig): string | null {
  const tree = layerTree(index, layer);
  const raw = tree?.max_date;
  return typeof raw === "string" ? raw.slice(0, 16) : null;
}

function dailyAvailability(index: AirFuseIndex | undefined, layer: AirFuseLayerConfig, value: string): number | null {
  const tree = layerTree(index, layer);
  if (!tree) return null;
  const { yyyy, mm, dd } = utcParts(value);
  const year = tree[yyyy] as Record<string, unknown> | undefined;
  const month = year?.[mm] as Record<string, unknown> | undefined;
  const day = month?.[dd] as Record<string, unknown> | undefined;
  if (!day || typeof day !== "object") return 0;

  return Object.values(day).filter((entry) => {
    if (!entry || typeof entry !== "object") return false;
    return Object.keys(entry).some((name) => name.endsWith(".geojson"));
  }).length;
}

function monthAvailability(index: AirFuseIndex | undefined, layer: AirFuseLayerConfig, value: string) {
  const tree = layerTree(index, layer);
  const { yyyy, mm } = utcParts(value);
  const year = tree?.[yyyy] as Record<string, unknown> | undefined;
  const month = year?.[mm] as Record<string, unknown> | undefined;
  const daysInMonth = new Date(Number(yyyy), Number(mm), 0).getDate();

  return Array.from({ length: daysInMonth }, (_, index) => {
    const day = pad2(index + 1);
    const dayEntry = month?.[day] as Record<string, unknown> | undefined;
    const count = dayEntry && typeof dayEntry === "object"
      ? Object.values(dayEntry).filter((entry) => {
        if (!entry || typeof entry !== "object") return false;
        return Object.keys(entry).some((name) => name.endsWith(".geojson"));
      }).length
      : 0;
    return { day: index + 1, count };
  });
}

function colorFromOgrStyle(value: unknown): string {
  if (typeof value !== "string") return "#64748b";
  const match = /#([0-9a-fA-F]{6})/.exec(value);
  return match ? `#${match[1]}` : "#64748b";
}

function normalizeAirFuseGeoJson(raw: unknown): GeoJSON.FeatureCollection {
  if (!raw || typeof raw !== "object") {
    throw new Error("AirFuse artifact is not GeoJSON");
  }
  const collection = raw as GeoJSON.FeatureCollection & { description?: string };
  if (collection.type !== "FeatureCollection" || !Array.isArray(collection.features)) {
    throw new Error("AirFuse artifact is not a FeatureCollection");
  }

  return {
    type: "FeatureCollection",
    features: collection.features
      .filter((feature) => feature.geometry)
      .map((feature) => {
        const properties = (feature.properties ?? {}) as Record<string, unknown>;
        return {
          ...feature,
          properties: {
            ...properties,
            fillColor: colorFromOgrStyle(properties.OGR_STYLE),
            displayName: typeof properties.Name === "string" ? properties.Name : "AirFuse surface",
          },
        };
      }),
  };
}

function geoJsonDescription(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const description = (raw as { description?: unknown }).description;
  return typeof description === "string" ? description : undefined;
}

function extendCoordinateBounds(
  coordinates: unknown,
  bounds: { west: number; east: number; south: number; north: number },
) {
  if (!Array.isArray(coordinates)) return;
  if (typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
    const lon = coordinates[0];
    const lat = coordinates[1];
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      bounds.west = Math.min(bounds.west, lon);
      bounds.east = Math.max(bounds.east, lon);
      bounds.south = Math.min(bounds.south, lat);
      bounds.north = Math.max(bounds.north, lat);
    }
    return;
  }
  for (const child of coordinates) {
    extendCoordinateBounds(child, bounds);
  }
}

function extendGeometryBounds(
  geometry: GeoJSON.Geometry | null | undefined,
  bounds: { west: number; east: number; south: number; north: number },
) {
  if (!geometry) return;
  if (geometry.type === "GeometryCollection") {
    for (const child of geometry.geometries) {
      extendGeometryBounds(child, bounds);
    }
    return;
  }
  extendCoordinateBounds(geometry.coordinates, bounds);
}

function geoJsonBounds(collection: GeoJSON.FeatureCollection): [[number, number], [number, number]] | null {
  const bounds = { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity };
  for (const feature of collection.features) {
    extendGeometryBounds(feature.geometry, bounds);
  }
  if (!Number.isFinite(bounds.west) || !Number.isFinite(bounds.south)) return null;
  return [[bounds.west, bounds.south], [bounds.east, bounds.north]];
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (quoted && next === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

function finiteNumber(value: string | undefined): number | null {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function calculateValidation(rows: string[][], layer: AirFuseLayerConfig): ValidationResult | null {
  if (!layer.observedColumn || !layer.predictedColumn || rows.length < 2) return null;

  const header = rows[0];
  const observedIndex = header.indexOf(layer.observedColumn);
  const predictedIndex = header.indexOf(layer.predictedColumn);
  if (observedIndex === -1 || predictedIndex === -1) return null;

  const allPoints: Array<[number, number]> = [];
  let sq = 0;
  let abs = 0;
  let bias = 0;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  let sumY2 = 0;
  let maxAxis = 1;

  for (const row of rows.slice(1)) {
    const observed = finiteNumber(row[observedIndex]);
    const predicted = finiteNumber(row[predictedIndex]);
    if (observed === null || predicted === null) continue;

    const error = predicted - observed;
    allPoints.push([observed, predicted]);
    sq += error * error;
    abs += Math.abs(error);
    bias += error;
    sumX += observed;
    sumY += predicted;
    sumXY += observed * predicted;
    sumX2 += observed * observed;
    sumY2 += predicted * predicted;
    maxAxis = Math.max(maxAxis, observed, predicted);
  }

  const n = allPoints.length;
  if (!n) return null;

  const denominator = n * sumX2 - sumX * sumX;
  const slope = denominator === 0 ? 0 : (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;
  const rDenominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  const r = rDenominator === 0 ? 0 : (n * sumXY - sumX * sumY) / rDenominator;
  const stride = Math.max(1, Math.ceil(allPoints.length / 2500));

  return {
    observedColumn: layer.observedColumn,
    predictedColumn: layer.predictedColumn,
    n,
    rmse: Math.sqrt(sq / n),
    mae: abs / n,
    bias: bias / n,
    r,
    slope,
    intercept,
    maxAxis: Math.ceil(maxAxis * 1.05),
    points: allPoints.filter((_, index) => index % stride === 0),
  };
}

function syncAirFuseLayer(map: maplibregl.Map, collection: GeoJSON.FeatureCollection) {
  const existing = map.getSource(AIRFUSE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (existing) {
    existing.setData(collection);
  } else {
    map.addSource(AIRFUSE_SOURCE_ID, { type: "geojson", data: collection });
  }

  if (!map.getLayer(AIRFUSE_FILL_LAYER_ID)) {
    map.addLayer({
      id: AIRFUSE_FILL_LAYER_ID,
      type: "fill",
      source: AIRFUSE_SOURCE_ID,
      paint: {
        "fill-color": ["get", "fillColor"],
        "fill-opacity": 0.58,
      },
    });
  }

  if (!map.getLayer(AIRFUSE_LINE_LAYER_ID)) {
    map.addLayer({
      id: AIRFUSE_LINE_LAYER_ID,
      type: "line",
      source: AIRFUSE_SOURCE_ID,
      paint: {
        "line-color": ["get", "fillColor"],
        "line-opacity": 0.78,
        "line-width": 0.75,
      },
    });
  }
}

export default function AirFusePage() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupBoundRef = useRef(false);
  const popupContextRef = useRef({ layerLabel: "AirFuse PM2.5", timestamp: timestampLabel(nowUtcInput()) });
  const [selectedLayer, setSelectedLayer] = useState<AirFuseLayerKey>("airfuse-pm25");
  const [utcValue, setUtcValue] = useState(nowUtcInput);
  const [timeTouched, setTimeTouched] = useState(false);
  const [activeGeoJson, setActiveGeoJson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [activeArtifact, setActiveArtifact] = useState<ActiveArtifact | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [artifactError, setArtifactError] = useState<string | null>(null);
  const [loadingArtifact, setLoadingArtifact] = useState(false);
  const [styleReloadTick, setStyleReloadTick] = useState(0);
  const { theme } = useTheme();
  const chartTheme = useChartTheme();

  const layer = AIRFUSE_LAYERS[selectedLayer];

  const { data: airFuseIndex, isLoading: indexLoading, error: indexError } = useQuery({
    queryKey: ["airfuse-index"],
    queryFn: () => fetchAirFuseJson<AirFuseIndex>("index.json"),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const indexedAvailability = useMemo(
    () => dailyAvailability(airFuseIndex, layer, utcValue),
    [airFuseIndex, layer, utcValue],
  );

  const calendarDays = useMemo(
    () => monthAvailability(airFuseIndex, layer, utcValue),
    [airFuseIndex, layer, utcValue],
  );

  const availableText = indexedAvailability == null
    ? "Index pending"
    : `${indexedAvailability}/${layer.expectedDailyCount}`;

  useEffect(() => {
    if (timeTouched) return;
    const latest = maxDateFromIndex(airFuseIndex, layer);
    if (latest) setUtcValue(latest);
  }, [airFuseIndex, layer, timeTouched]);

  useEffect(() => {
    popupContextRef.current = {
      layerLabel: layer.shortLabel,
      timestamp: activeArtifact?.timestamp ?? timestampLabel(utcValue),
    };
  }, [activeArtifact?.timestamp, layer.shortLabel, utcValue]);

  const loadArtifact = useCallback(async () => {
    const geojsonPath = resolveArtifactPath(airFuseIndex, layer, utcValue, "geojson");
    if (!geojsonPath) return;

    const csvPath = resolveArtifactPath(airFuseIndex, layer, utcValue, "csv") ?? undefined;
    const netcdfPath = resolveArtifactPath(airFuseIndex, layer, utcValue, "netcdf") ?? undefined;

    setLoadingArtifact(true);
    setArtifactError(null);
    setValidation(null);
    setValidationError(null);

    try {
      const rawGeoJson = await fetchAirFuseJson<unknown>(geojsonPath);
      const normalized = normalizeAirFuseGeoJson(rawGeoJson);
      const description = geoJsonDescription(rawGeoJson);
      setActiveGeoJson(normalized);
      setActiveArtifact({
        layer,
        timestamp: timestampLabel(utcValue),
        geojsonPath,
        csvPath,
        netcdfPath,
        featureCount: normalized.features.length,
        description,
      });

      const bounds = geoJsonBounds(normalized);
      if (bounds && mapRef.current) {
        mapRef.current.fitBounds(bounds, { padding: 32, duration: 0, maxZoom: 5.5 });
      }

      if (csvPath && layer.observedColumn && layer.predictedColumn) {
        try {
          const csv = await fetchAirFuseText(csvPath);
          const parsed = calculateValidation(parseCsv(csv), layer);
          setValidation(parsed);
          if (!parsed) setValidationError("Validation CSV did not include the expected columns.");
        } catch (err) {
          setValidationError(err instanceof Error ? err.message : "Validation CSV is unavailable.");
        }
      }
    } catch (err) {
      setActiveGeoJson(null);
      setActiveArtifact(null);
      setArtifactError(err instanceof Error ? err.message : "AirFuse artifact is unavailable.");
    } finally {
      setLoadingArtifact(false);
    }
  }, [airFuseIndex, layer, utcValue]);

  useEffect(() => {
    void loadArtifact();
  }, [loadArtifact]);

  const bindPopup = useCallback((map: maplibregl.Map) => {
    if (popupBoundRef.current) return;
    popupBoundRef.current = true;

    map.on("click", AIRFUSE_FILL_LAYER_ID, (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      const properties = feature.properties as Record<string, unknown>;
      const label = properties.displayName ?? properties.Name ?? "AirFuse surface";
      const aqic = finiteNumber(String(properties.AQIC ?? ""));
      const context = popupContextRef.current;
      new maplibregl.Popup({ offset: 10 })
        .setLngLat(event.lngLat)
        .setHTML(
          `<strong>${escapeHtml(label)}</strong><br/>`
          + `${aqic == null ? "" : `AQI midpoint: ${escapeHtml(aqic.toFixed(1))}<br/>`}`
          + `${escapeHtml(context.layerLabel)} / ${escapeHtml(context.timestamp)}`,
        )
        .addTo(map);
    });

    map.on("mouseenter", AIRFUSE_FILL_LAYER_ID, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", AIRFUSE_FILL_LAYER_ID, () => {
      map.getCanvas().style.cursor = "";
    });
  }, []);

  useEffect(() => {
    const node = containerRef.current;
    if (!node || mapRef.current) return;

    const map = new maplibregl.Map({
      container: node,
      style: theme === "dark" ? STYLE_DARK : STYLE_LIGHT,
      center: [-97, 39],
      zoom: 3.25,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.on("load", () => {
      setStyleReloadTick((tick) => tick + 1);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      popupBoundRef.current = false;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.once("styledata", () => {
      setStyleReloadTick((tick) => tick + 1);
    });
    map.setStyle(theme === "dark" ? STYLE_DARK : STYLE_LIGHT, { diff: true });
  }, [theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !activeGeoJson || !map.isStyleLoaded()) return;
    syncAirFuseLayer(map, activeGeoJson);
    bindPopup(map);
  }, [activeGeoJson, bindPopup, styleReloadTick]);

  const validationOption = useMemo<EChartsCoreOption | null>(() => {
    if (!validation) return null;
    const regressionEnd = validation.slope * validation.maxAxis + validation.intercept;
    return {
      color: [chartTheme.colors[0], chartTheme.colors[2], chartTheme.colors[3]],
      backgroundColor: "transparent",
      tooltip: {
        trigger: "item",
        backgroundColor: chartTheme.tooltipBg,
        borderColor: chartTheme.tooltipBorder,
        textStyle: { color: chartTheme.tooltipText },
      },
      grid: { left: 54, right: 20, top: 16, bottom: 48 },
      xAxis: {
        type: "value",
        name: `Observed ${layer.unit}`,
        nameLocation: "middle",
        nameGap: 30,
        min: 0,
        max: validation.maxAxis,
        axisLine: { lineStyle: { color: chartTheme.axis } },
        axisLabel: { color: chartTheme.text },
        splitLine: { lineStyle: { color: chartTheme.grid } },
      },
      yAxis: {
        type: "value",
        name: `Modeled ${layer.unit}`,
        nameLocation: "middle",
        nameGap: 38,
        min: 0,
        max: validation.maxAxis,
        axisLine: { lineStyle: { color: chartTheme.axis } },
        axisLabel: { color: chartTheme.text },
        splitLine: { lineStyle: { color: chartTheme.grid } },
      },
      series: [
        {
          type: "scatter",
          name: "Monitor pairs",
          symbolSize: 4,
          data: validation.points,
        },
        {
          type: "line",
          name: "1:1",
          showSymbol: false,
          data: [[0, 0], [validation.maxAxis, validation.maxAxis]],
          lineStyle: { type: "dashed", width: 1.5 },
        },
        {
          type: "line",
          name: "Regression",
          showSymbol: false,
          data: [[0, validation.intercept], [validation.maxAxis, regressionEnd]],
          lineStyle: { width: 2 },
        },
      ],
    };
  }, [chartTheme, layer.unit, validation]);

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow="AirFuse"
        title="AirFuse surface viewer"
        subtitle="Client viewer for AirFuse and GOES static artifacts through the PAtool serverless API surface."
      />

      <div className={styles.controls}>
        <select
          className={styles.select}
          value={selectedLayer}
          onChange={(event) => {
            setSelectedLayer(event.target.value as AirFuseLayerKey);
            setTimeTouched(false);
          }}
          aria-label="AirFuse layer"
        >
          {LAYER_OPTIONS.map((option) => (
            <option key={option.key} value={option.key}>{option.label}</option>
          ))}
        </select>

        <button className={styles.iconButton} type="button" onClick={() => { setTimeTouched(true); setUtcValue((value) => shiftUtcInput(value, -24)); }} title="Previous day" aria-label="Previous day">
          {"<<"}
        </button>
        <button className={styles.iconButton} type="button" onClick={() => { setTimeTouched(true); setUtcValue((value) => shiftUtcInput(value, -1)); }} title="Previous hour" aria-label="Previous hour">
          {"<"}
        </button>
        <input
          className={styles.datetime}
          type="datetime-local"
          value={utcValue}
          step={3600}
          onChange={(event) => {
            setTimeTouched(true);
            setUtcValue(event.target.value);
          }}
          aria-label="UTC time"
        />
        <button className={styles.iconButton} type="button" onClick={() => { setTimeTouched(true); setUtcValue((value) => shiftUtcInput(value, 1)); }} title="Next hour" aria-label="Next hour">
          {">"}
        </button>
        <button className={styles.iconButton} type="button" onClick={() => { setTimeTouched(true); setUtcValue((value) => shiftUtcInput(value, 24)); }} title="Next day" aria-label="Next day">
          {">>"}
        </button>
        <button className={styles.button} type="button" onClick={() => void loadArtifact()}>
          Refresh
        </button>
      </div>

      {indexError && (
        <div className={styles.warning}>
          AirFuse index is unavailable through the configured proxy. Deploy the Worker or set VITE_AIRFUSE_API_BASE to a serverless proxy URL.
        </div>
      )}

      <div className={styles.stats}>
        <StatCard label="Layer" value={layer.shortLabel} />
        <StatCard label="UTC hour" value={timestampLabel(utcValue)} />
        <StatCard label="Daily artifacts" value={indexLoading ? "..." : availableText} />
        <StatCard label="Features" value={activeArtifact ? `${activeArtifact.featureCount}` : "..."} />
      </div>

      <div className={styles.mainGrid}>
        <section className={styles.mapPanel}>
          <div className={styles.mapToolbar}>
            <span className={styles.statusPill}>{loadingArtifact ? "Loading" : activeArtifact ? "Loaded" : "Waiting"}</span>
            <span className={styles.timestamp}>{activeArtifact?.timestamp ?? timestampLabel(utcValue)}</span>
          </div>
          <div ref={containerRef} className={styles.map} />
          {artifactError && <div className={styles.mapError}>{artifactError}</div>}
        </section>

        <aside className={styles.sidePanel}>
          <Card title="Artifacts">
            {activeArtifact ? (
              <div className={styles.linkList}>
                <a href={airFuseRawUrl(activeArtifact.geojsonPath)} target="_blank" rel="noreferrer">GeoJSON surface</a>
                {activeArtifact.csvPath && <a href={airFuseRawUrl(activeArtifact.csvPath)} target="_blank" rel="noreferrer">Validation CSV</a>}
                {activeArtifact.netcdfPath && <a href={airFuseRawUrl(activeArtifact.netcdfPath)} target="_blank" rel="noreferrer">NetCDF result</a>}
              </div>
            ) : (
              <p className={styles.empty}>No artifact loaded.</p>
            )}
          </Card>

          <Card title="Month Coverage">
            <div className={styles.calendar}>
              {calendarDays.map((day) => {
                const complete = day.count >= layer.expectedDailyCount;
                const partial = day.count > 0 && !complete;
                return (
                  <span
                    key={day.day}
                    className={`${styles.dayCell} ${complete ? styles.dayComplete : partial ? styles.dayPartial : styles.dayMissing}`}
                    title={`${day.count}/${layer.expectedDailyCount} artifacts`}
                  >
                    <span>{day.day}</span>
                    <strong>{day.count}</strong>
                  </span>
                );
              })}
            </div>
          </Card>

          <Card title="Source Reference">
            <div className={styles.reference}>
              <span>Ported from AirFuse example viewer</span>
              <code>{AIRFUSE_SOURCE_REFERENCE.localPath}</code>
              <code>{AIRFUSE_SOURCE_REFERENCE.example}</code>
              <a href={AIRFUSE_SOURCE_REFERENCE.upstream} target="_blank" rel="noreferrer">Upstream repository</a>
            </div>
          </Card>
        </aside>
      </div>

      <div className={styles.validationGrid}>
        <Card title="Validation Scatter">
          {loadingArtifact ? (
            <Loader message="Loading validation..." />
          ) : validation && validationOption ? (
            <EChart option={validationOption} height={340} />
          ) : (
            <p className={styles.empty}>{validationError ?? "Validation is not available for this layer/hour."}</p>
          )}
        </Card>

        <Card title="Validation Metrics">
          {validation ? (
            <div className={styles.metricGrid}>
              <span className={styles.metric}><small>Pairs</small><strong>{validation.n}</strong></span>
              <span className={styles.metric}><small>RMSE</small><strong>{validation.rmse.toFixed(2)}</strong></span>
              <span className={styles.metric}><small>Bias</small><strong>{validation.bias.toFixed(2)}</strong></span>
              <span className={styles.metric}><small>r</small><strong>{validation.r.toFixed(2)}</strong></span>
              <span className={styles.metric}><small>Slope</small><strong>{validation.slope.toFixed(2)}</strong></span>
              <span className={styles.metric}><small>MAE</small><strong>{validation.mae.toFixed(2)}</strong></span>
            </div>
          ) : (
            <p className={styles.empty}>No validation metrics loaded.</p>
          )}
        </Card>
      </div>

      {activeArtifact?.description && (
        <Card title="Artifact Description">
          <p className={styles.description}>{activeArtifact.description}</p>
        </Card>
      )}
    </div>
  );
}
