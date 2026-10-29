import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapCircleLayer, type LngLatPoint } from "@pgmaps/geo-toolkit/map";
import { escapeHtml, PlaybackControls } from "@pgmaps/geo-toolkit/ui";

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
import { FitMapToPoints } from "../components/map/FitMapToPoints";
import { PaMap } from "../components/map/PaMap";
import { ToolkitScope } from "../components/map/ToolkitScope";
import { getJson } from "../lib/api";
import { useTheme } from "../hooks/useTheme";
import styles from "./MapPage.module.css";

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

function siteHoverHtml(properties: Record<string, unknown>): string {
  return `<strong>${escapeHtml(properties.label)}</strong><br/>${escapeHtml(properties.valueLabel)}`;
}

export default function TimeLapsePage() {
  const { theme } = useTheme();
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

  const sites = useMemo<LngLatPoint[]>(
    () => (series ? series.sites.map((site) => [site.longitude, site.latitude] as const) : []),
    [series],
  );

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
          <ToolkitScope style={{ flex: "1 1 360px" }}>
            <PlaybackControls
              label="Timestep"
              frame={frame}
              frameCount={timestamps.length}
              onFrameChange={setFrame}
              playing={playing}
              onPlayingChange={setPlaying}
              intervalMs={400}
              frameLabel={currentTimestamp.slice(0, 10)}
              disabled={!series}
            />
          </ToolkitScope>
          <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span>Colormap</span>
            <select value={colormap} onChange={(event) => setColormap(event.target.value as ColormapId)}>
              {COLORMAP_IDS.map((id) => (
                <option key={id} value={id}>{id.toUpperCase()}</option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ width: "100%", height: "520px", borderRadius: "8px", overflow: "hidden" }}>
          <PaMap center={[-122.78, 53.9]} zoom={8}>
            <MapCircleLayer
              data={featureCollection}
              color={["get", "color"]}
              radius={8}
              opacity={0.9}
              strokeWidth={1}
              strokeColor={theme === "dark" ? "#0b0b0b" : "#ffffff"}
              hoverHtml={siteHoverHtml}
            />
            <FitMapToPoints points={sites} padding={60} pad={0} maxZoom={14} />
          </PaMap>
        </div>

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
