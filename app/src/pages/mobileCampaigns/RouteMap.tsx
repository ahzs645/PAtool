import { useMemo } from "react";
import { MapCircleLayer, MapControls, MapLineLayer, type LngLatPoint } from "@pgmaps/geo-toolkit/map";
import { escapeHtml } from "@pgmaps/geo-toolkit/ui";

import type { MobileSensingPoint, ReferenceMonitorMatch } from "@patool/shared";
import { FitMapToPoints } from "../../components/map/FitMapToPoints";
import { PaMap } from "../../components/map/PaMap";
import { useTheme } from "../../hooks/useTheme";
import styles from "../MobileCampaignsPage.module.css";

type RouteMapProps = {
  points: MobileSensingPoint[];
  monitors: ReferenceMonitorMatch[];
};

const IS_LINE = ["==", ["geometry-type"], "LineString"] as const;
const IS_POINT = ["==", ["geometry-type"], "Point"] as const;

function routePointHtml(properties: Record<string, unknown>): string {
  return `<strong>${escapeHtml(properties.sessionId)}</strong><br/>PM2.5 ${escapeHtml(properties.pm25)} ug/m3`;
}

function monitorHtml(properties: Record<string, unknown>): string {
  return `<strong>${escapeHtml(properties.name)}</strong><br/>${escapeHtml(properties.source)}<br/>${escapeHtml(properties.distanceKm)} km away`;
}

export function RouteMap({ points, monitors }: RouteMapProps) {
  const { theme } = useTheme();
  const routeGeoJson = useMemo(() => buildRouteGeoJson(points), [points]);
  const monitorGeoJson = useMemo(() => buildMonitorGeoJson(monitors), [monitors]);
  const coordinates = useMemo<LngLatPoint[]>(() => [
    ...points.map((point) => [point.longitude, point.latitude] as const),
    ...monitors.map((match) => [match.monitor.longitude, match.monitor.latitude] as const),
  ], [points, monitors]);
  const stroke = theme === "dark" ? "#111827" : "#ffffff";

  return (
    <div className={styles.mapPanel}>
      <div className={styles.mapCanvas}>
        <PaMap
          center={initialCenter(points, monitors)}
          zoom={11}
          attributionControl={false}
          controls={<MapControls position="top-right" showZoom />}
        >
          <MapLineLayer
            data={routeGeoJson}
            filter={IS_LINE}
            color={["get", "color"]}
            width={5}
            opacity={0.9}
            interactive={false}
            layerOrder={1}
          />
          <MapCircleLayer
            data={routeGeoJson}
            filter={IS_POINT}
            color={["get", "color"]}
            radius={4}
            opacity={1}
            strokeColor={stroke}
            strokeWidth={1.25}
            clickHtml={routePointHtml}
            layerOrder={2}
          />
          <MapCircleLayer
            data={monitorGeoJson}
            color={theme === "dark" ? "#f8fafc" : "#111827"}
            radius={7}
            opacity={1}
            strokeColor={stroke}
            strokeWidth={2}
            clickHtml={monitorHtml}
            layerOrder={3}
          />
          <FitMapToPoints points={coordinates} padding={44} pad={0} minSpan={0.005} maxZoom={14} />
        </PaMap>
      </div>
      <div className={styles.mapLegend}>
        <span className={styles.legendSwatch} />
        <span>Lower to higher PM2.5</span>
      </div>
    </div>
  );
}

function initialCenter(points: MobileSensingPoint[], monitors: ReferenceMonitorMatch[]): [number, number] {
  const first = points[0];
  const monitor = monitors[0]?.monitor;
  return first ? [first.longitude, first.latitude] : monitor ? [monitor.longitude, monitor.latitude] : [-123.12, 49.28];
}

function buildRouteGeoJson(points: MobileSensingPoint[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = points.map((point) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [point.longitude, point.latitude] },
    properties: {
      id: point.id,
      sessionId: point.sessionId,
      pm25: point.pm25.toFixed(1),
      color: pmColor(point.pm25),
    },
  }));

  for (let index = 1; index < points.length; index += 1) {
    if (points[index - 1].sessionId !== points[index].sessionId) continue;
    features.push({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [points[index - 1].longitude, points[index - 1].latitude],
          [points[index].longitude, points[index].latitude],
        ],
      },
      properties: { color: pmColor(points[index].pm25), sessionId: points[index].sessionId },
    });
  }

  return { type: "FeatureCollection", features };
}

function buildMonitorGeoJson(monitors: ReferenceMonitorMatch[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: monitors.map((match) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [match.monitor.longitude, match.monitor.latitude] },
      properties: {
        id: match.monitor.id,
        name: match.monitor.name,
        source: match.monitor.source ?? "reference",
        distanceKm: match.distanceKm.toFixed(2),
      },
    })),
  };
}

function pmColor(pm25: number) {
  if (pm25 <= 12) return "#3aa76d";
  if (pm25 <= 35) return "#d6a100";
  if (pm25 <= 55) return "#d96c2c";
  if (pm25 <= 150) return "#cf3f4b";
  return "#7c4bb7";
}
