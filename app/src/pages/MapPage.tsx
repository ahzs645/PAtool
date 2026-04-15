import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import maplibregl from "maplibre-gl";

import {
  pasFilter,
  pm25ToAqi,
  pm25ToAqiBand,
  idwInterpolate,
  ordinaryKrigingInterpolate,
  gridToImageData,
  type PasCollection,
  type PasRecord,
  type InterpolationPoint,
  type InterpolationMethod,
} from "@patool/shared";

import { StatCard } from "../components";
import { getJson } from "../lib/api";
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

function getPm25ForWindow(record: PasRecord, window: Pm25Window): number {
  return record[window] ?? record.pm25Current ?? 0;
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
        pm25: getPm25ForWindow(r, pm25Window).toFixed(2),
        color: pm25ToAqiBand(getPm25ForWindow(r, pm25Window)).color,
        stateCode: r.stateCode ?? "NA",
      },
    })),
  };
}

export default function MapPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const { theme } = useTheme();

  const [query, setQuery] = useState("");
  const [outsideOnly, setOutsideOnly] = useState(true);
  const [pm25Window, setPm25Window] = useState<Pm25Window>("pm25_1hr");
  const [mapMode, setMapMode] = useState<"markers" | "heatmap">("markers");
  const [interpMethod, setInterpMethod] = useState<InterpolationMethod>("idw");
  const [gridRes, setGridRes] = useState(100);
  const [idwPower, setIdwPower] = useState(2);
  const [followView, setFollowView] = useState(true);
  const [viewBounds, setViewBounds] = useState<{
    west: number;
    east: number;
    south: number;
    north: number;
  } | null>(null);
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

  const interpolationResult = useMemo(() => {
    if (mapMode !== "heatmap" || !filtered) return null;

    // Convert PM2.5 (ug/m3) -> AQI so interpolated values align with the AQI color scale.
    // Without this, typical PM2.5 values (~10-30 ug/m3) all fall in the 0-50 "Good/Green" bucket.
    const points: InterpolationPoint[] = filtered.records.map((r) => ({
      x: r.longitude,
      y: r.latitude,
      value: pm25ToAqi(getPm25ForWindow(r, pm25Window)),
    }));

    if (points.length < 3) return null;

    // Bounds: follow the map viewport when enabled, otherwise use the data envelope.
    // Viewport-bound grids give high-resolution detail as the user zooms in, since the
    // same NxN grid now covers a smaller area.
    let bounds: { west: number; east: number; south: number; north: number };
    if (followView && viewBounds) {
      bounds = viewBounds;
    } else {
      const lons = points.map((p) => p.x);
      const lats = points.map((p) => p.y);
      const pad = 0.5; // degree padding around data envelope
      bounds = {
        west: Math.min(...lons) - pad,
        east: Math.max(...lons) + pad,
        south: Math.min(...lats) - pad,
        north: Math.max(...lats) + pad,
      };
    }

    if (interpMethod === "idw") {
      return idwInterpolate(points, gridRes, gridRes, bounds, idwPower);
    } else {
      return ordinaryKrigingInterpolate(points, gridRes, gridRes, bounds);
    }
    // recomputeTick is intentionally a dep so the manual "Recompute" button re-runs this
    // even when bounds/params are unchanged.
  }, [mapMode, filtered, pm25Window, interpMethod, gridRes, idwPower, followView, viewBounds, recomputeTick]);

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
          + `${props.pm25} ug/m3<br/>`
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
    map.setStyle(style, { diff: true });

    map.once("styledata", () => {
      // Re-add source and layer after a style swap
      if (!map.getSource(SOURCE_ID)) {
        addSensorLayer(map);
      }
    });
  }, [theme, addSensorLayer]);

  // Render heatmap overlay from interpolation result
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    if (!interpolationResult) {
      // Remove heatmap layer if exists
      if (map.getLayer("heatmap-layer")) map.removeLayer("heatmap-layer");
      if (map.getSource("heatmap-source")) map.removeSource("heatmap-source");
      return;
    }

    // Create canvas and draw interpolated image
    const canvas = document.createElement("canvas");
    canvas.width = interpolationResult.width;
    canvas.height = interpolationResult.height;
    const ctx = canvas.getContext("2d")!;
    const imageData = ctx.createImageData(interpolationResult.width, interpolationResult.height);
    const colorData = gridToImageData(interpolationResult, true); // Use AQI colors
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
    const existingSource = map.getSource("heatmap-source") as maplibregl.ImageSource | undefined;
    if (existingSource) {
      existingSource.updateImage({ url: dataUrl, coordinates });
    } else {
      map.addSource("heatmap-source", {
        type: "image",
        url: dataUrl,
        coordinates,
      });

      // Add layer below the sensor circles
      const beforeLayer = map.getLayer(LAYER_ID) ? LAYER_ID : undefined;
      map.addLayer(
        {
          id: "heatmap-layer",
          type: "raster",
          source: "heatmap-source",
          paint: {
            "raster-opacity": 0.7,
            "raster-fade-duration": 0,
          },
        },
        beforeLayer,
      );
    }
  }, [interpolationResult]);

  // Toggle sensor circle visibility based on map mode
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded() || !map.getLayer(LAYER_ID)) return;

    if (mapMode === "heatmap") {
      map.setPaintProperty(LAYER_ID, "circle-radius", 3);
      map.setPaintProperty(LAYER_ID, "circle-opacity", 0.5);
    } else {
      map.setPaintProperty(LAYER_ID, "circle-radius", 6);
      map.setPaintProperty(LAYER_ID, "circle-opacity", 0.85);
    }
  }, [mapMode]);

  // Cleanup heatmap layer when switching back to markers mode
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (mapMode === "markers") {
      if (map.getLayer("heatmap-layer")) map.removeLayer("heatmap-layer");
      if (map.getSource("heatmap-source")) map.removeSource("heatmap-source");
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
        const b = map.getBounds();
        setViewBounds({
          west: b.getWest(),
          east: b.getEast(),
          south: b.getSouth(),
          north: b.getNorth(),
        });
      }, 200);
    };

    // Seed once for the current view, then subscribe to future moves.
    const seed = () => {
      const b = map.getBounds();
      setViewBounds({
        west: b.getWest(),
        east: b.getEast(),
        south: b.getSouth(),
        north: b.getNorth(),
      });
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
    ? filtered.records.reduce((sum, r) => sum + getPm25ForWindow(r, pm25Window), 0)
      / Math.max(filtered.records.length, 1)
    : 0;
  const meanBand = pm25ToAqiBand(averagePm);

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
                  const b = map.getBounds();
                  setViewBounds({
                    west: b.getWest(),
                    east: b.getEast(),
                    south: b.getSouth(),
                    north: b.getNorth(),
                  });
                }
                setRecomputeTick((t) => t + 1);
              }}
              title="Recompute interpolation for the current viewport"
            >
              Recompute
            </button>
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
            <div className={styles.legendTitle}>AQI</div>
            <div className={styles.legendBar} />
            <div className={styles.legendLabels}>
              <span>0</span>
              <span>50</span>
              <span>100</span>
              <span>150</span>
              <span>200</span>
              <span>300</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
