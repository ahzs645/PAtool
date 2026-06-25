import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import maplibregl from "maplibre-gl";

import {
  COLORMAP_IDS,
  colorForValue,
  colormapLegend,
  networkFrameAt,
  networkFrameMeans,
  networkValueRange,
  type ColormapId,
  type NetworkTimeSeries,
} from "@patool/shared";

import { Card, PageHeader, StatCard } from "../components";
import { getJson } from "../lib/api";
import { useTheme } from "../hooks/useTheme";
import { STYLE_DARK, STYLE_LIGHT } from "./map/config";
import styles from "./MapPage.module.css";

import "maplibre-gl/dist/maplibre-gl.css";

const SOURCE = "network-frame";
const LAYER = "network-frame-circles";

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

export default function TimeLapsePage() {
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapReadyRef = useRef(false);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [colormap, setColormap] = useState<ColormapId>("aqi");

  const { data: series } = useQuery({
    queryKey: ["network-timeseries"],
    queryFn: () => getJson<NetworkTimeSeries>("/api/network/timeseries"),
  });

  const range = useMemo(() => (series ? networkValueRange(series) : { min: 0, max: 0 }), [series]);
  const frameMeans = useMemo(() => (series ? networkFrameMeans(series) : []), [series]);
  // Continuous ramps scale to the 98th percentile so smoke spikes don't crush
  // the rest of the range into one color; AQI/SCAQMD use their fixed breaks.
  const displayMax = useMemo(() => {
    if (!series) return 0;
    const finite = series.sites.flatMap((s) => s.values).filter((v): v is number => typeof v === "number");
    return Math.max(range.min + 1, percentile(finite, 98));
  }, [series, range]);

  const scaleMax = colormap === "viridis" || colormap === "magma" ? displayMax : range.max;
  const legend = useMemo(() => colormapLegend(colormap, range.min, displayMax), [colormap, range, displayMax]);

  const featureCollection = useMemo(() => {
    if (!series) return { type: "FeatureCollection" as const, features: [] };
    const f = networkFrameAt(series, frame);
    return {
      type: "FeatureCollection" as const,
      features: f.points
        .filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
        .map((p) => ({
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [p.longitude, p.latitude] },
          properties: {
            id: p.id,
            label: p.label ?? p.id,
            value: p.value,
            color: colorForValue(p.value, { colormap, min: range.min, max: scaleMax }),
            valueLabel: typeof p.value === "number" ? `${p.value.toFixed(1)} ug/m3` : "no data",
          },
        })),
    };
  }, [series, frame, colormap, range, scaleMax]);

  const featureRef = useRef(featureCollection);
  featureRef.current = featureCollection;

  // Initialize the map once. The circle layer is installed on whichever style
  // loads, and a tile-free inline style is swapped in when the remote basemap
  // can't be reached (offline / locked-down networks) so the network frame
  // still renders.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: theme === "dark" ? STYLE_DARK : STYLE_LIGHT,
      center: [-122.78, 53.9],
      zoom: 8,
    });
    map.addControl(new maplibregl.NavigationControl({}), "top-right");
    mapRef.current = map;
    let popupAttached = false;

    const install = () => {
      if (!map.isStyleLoaded()) return;
      const existing = map.getSource(SOURCE) as maplibregl.GeoJSONSource | undefined;
      if (existing) existing.setData(featureRef.current as GeoJSON.FeatureCollection);
      else map.addSource(SOURCE, { type: "geojson", data: featureRef.current as GeoJSON.FeatureCollection });
      if (!map.getLayer(LAYER)) {
        map.addLayer({
          id: LAYER,
          type: "circle",
          source: SOURCE,
          paint: {
            "circle-radius": 8,
            "circle-color": ["get", "color"],
            "circle-stroke-width": 1,
            "circle-stroke-color": theme === "dark" ? "#0b0b0b" : "#ffffff",
            "circle-opacity": 0.9,
          },
        });
      }
      if (!popupAttached) {
        const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
        map.on("mouseenter", LAYER, (event) => {
          const feature = event.features?.[0];
          if (!feature) return;
          map.getCanvas().style.cursor = "pointer";
          const props = feature.properties as { label: string; valueLabel: string };
          const [lng, lat] = (feature.geometry as GeoJSON.Point).coordinates;
          popup.setLngLat([lng, lat]).setHTML(`<strong>${props.label}</strong><br/>${props.valueLabel}`).addTo(map);
        });
        map.on("mouseleave", LAYER, () => { map.getCanvas().style.cursor = ""; popup.remove(); });
        popupAttached = true;
      }
      mapReadyRef.current = true;
    };

    map.on("styledata", install);

    let fellBack = false;
    const fallbackTimer = window.setTimeout(() => {
      if (!map.isStyleLoaded() && !fellBack) {
        fellBack = true;
        map.setStyle({
          version: 8,
          sources: {},
          layers: [{ id: "bg", type: "background", paint: { "background-color": theme === "dark" ? "#0b0b0b" : "#e6ebf2" } }],
        } as maplibregl.StyleSpecification);
      }
    }, 3500);

    return () => {
      window.clearTimeout(fallbackTimer);
      map.remove();
      mapRef.current = null;
      mapReadyRef.current = false;
    };
  }, [theme]);

  // Fit bounds when the series is available and the style is ready.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !series || series.sites.length === 0) return;
    const lngs = series.sites.map((s) => s.longitude).filter(Number.isFinite);
    const lats = series.sites.map((s) => s.latitude).filter(Number.isFinite);
    if (!lngs.length) return;
    const bounds: [[number, number], [number, number]] = [
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    ];
    const apply = () => map.fitBounds(bounds, { padding: 60, duration: 0 });
    if (mapReadyRef.current) apply();
    else map.once("styledata", apply);
  }, [series]);

  // Push the current frame's colored features to the map source.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    const source = map.getSource(SOURCE) as maplibregl.GeoJSONSource | undefined;
    source?.setData(featureCollection as GeoJSON.FeatureCollection);
  }, [featureCollection]);

  // Playback timer.
  useEffect(() => {
    if (!playing || !series) return;
    const id = window.setInterval(() => {
      setFrame((prev) => (prev + 1) % series.timestamps.length);
    }, 400);
    return () => window.clearInterval(id);
  }, [playing, series]);

  const timestamps = series?.timestamps ?? [];
  const currentTimestamp = timestamps[frame] ?? "";
  const currentMean = frameMeans[frame];
  const reporting = series ? networkFrameAt(series, frame).points.filter((p) => typeof p.value === "number").length : 0;

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow="Network time-lapse"
        title="Animated PM2.5 over the sensor network"
        subtitle="Steps a colormapped network frame through time (ASNAT map-tab timestep slider). Demo data: a PurpleAir network around Prince George, BC, EPA AirNow F&SM corrected."
      />

      <div className={styles.stats ?? undefined} style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
        <StatCard label="Date" value={currentTimestamp ? currentTimestamp.slice(0, 10) : "—"} />
        <StatCard label="Sites reporting" value={`${reporting} / ${series?.sites.length ?? 0}`} />
        <StatCard label="Network mean" value={typeof currentMean === "number" ? `${currentMean.toFixed(1)} ug/m3` : "—"} />
        <StatCard label="Frame" value={`${frame + 1} / ${timestamps.length || 0}`} />
      </div>

      <Card title="Time-lapse map">
        <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", alignItems: "center", marginBottom: "12px" }}>
          <button type="button" onClick={() => setPlaying((p) => !p)} disabled={!series} aria-label={playing ? "Pause" : "Play"}>
            {playing ? "⏸ Pause" : "▶ Play"}
          </button>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", flex: "1 1 320px" }}>
            <span style={{ whiteSpace: "nowrap" }}>{currentTimestamp.slice(0, 10)}</span>
            <input
              type="range"
              min={0}
              max={Math.max(0, timestamps.length - 1)}
              value={frame}
              onChange={(event) => { setPlaying(false); setFrame(Number(event.target.value)); }}
              style={{ flex: 1 }}
              aria-label="Timestep"
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span>Colormap</span>
            <select value={colormap} onChange={(event) => setColormap(event.target.value as ColormapId)}>
              {COLORMAP_IDS.map((id) => (
                <option key={id} value={id}>{id.toUpperCase()}</option>
              ))}
            </select>
          </label>
        </div>

        <div ref={containerRef} style={{ width: "100%", height: "520px", borderRadius: "8px", overflow: "hidden" }} />

        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", marginTop: "12px" }} aria-label="Colormap legend">
          {legend.map((stop) => (
            <span key={`${stop.color}-${stop.label}`} style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px" }}>
              <span style={{ width: "14px", height: "14px", borderRadius: "3px", background: stop.color, display: "inline-block" }} />
              {stop.label}
            </span>
          ))}
        </div>
      </Card>
    </div>
  );
}
