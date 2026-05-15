import { useEffect, useMemo, useRef } from "react";
import maplibregl from "maplibre-gl";

import type { MobileSensingPoint, ReferenceMonitorMatch } from "@patool/shared";
import { STYLE_LIGHT } from "../map/config";
import styles from "../MobileCampaignsPage.module.css";

import "maplibre-gl/dist/maplibre-gl.css";

type RouteMapProps = {
  points: MobileSensingPoint[];
  monitors: ReferenceMonitorMatch[];
};

const ROUTE_SOURCE = "mobile-campaign-route";
const MONITOR_SOURCE = "mobile-campaign-monitors";
const ROUTE_LINE_LAYER = "mobile-campaign-route-line";
const ROUTE_POINT_LAYER = "mobile-campaign-route-points";
const MONITOR_LAYER = "mobile-campaign-monitor-points";

export function RouteMap({ points, monitors }: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const routeGeoJson = useMemo(() => buildRouteGeoJson(points), [points]);
  const monitorGeoJson = useMemo(() => buildMonitorGeoJson(monitors), [monitors]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node || mapRef.current) return;

    const map = new maplibregl.Map({
      container: node,
      style: STYLE_LIGHT,
      center: initialCenter(points, monitors),
      zoom: 11,
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    map.on("load", () => {
      map.addSource(ROUTE_SOURCE, { type: "geojson", data: routeGeoJson });
      map.addSource(MONITOR_SOURCE, { type: "geojson", data: monitorGeoJson });

      map.addLayer({
        id: ROUTE_LINE_LAYER,
        type: "line",
        source: ROUTE_SOURCE,
        filter: ["==", ["geometry-type"], "LineString"],
        paint: {
          "line-color": ["get", "color"],
          "line-width": 5,
          "line-opacity": 0.9,
        },
      });

      map.addLayer({
        id: ROUTE_POINT_LAYER,
        type: "circle",
        source: ROUTE_SOURCE,
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": 4,
          "circle-color": ["get", "color"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1,
        },
      });

      map.addLayer({
        id: MONITOR_LAYER,
        type: "circle",
        source: MONITOR_SOURCE,
        paint: {
          "circle-radius": 7,
          "circle-color": "#111827",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });
      fitMap(map, points, monitors);
    });

    map.on("click", ROUTE_POINT_LAYER, (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      new maplibregl.Popup()
        .setLngLat(event.lngLat)
        .setHTML(`<strong>${escapeHtml(feature.properties?.sessionId)}</strong><br/>PM2.5 ${escapeHtml(feature.properties?.pm25)} ug/m3`)
        .addTo(map);
    });

    map.on("click", MONITOR_LAYER, (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      new maplibregl.Popup()
        .setLngLat(event.lngLat)
        .setHTML(`<strong>${escapeHtml(feature.properties?.name)}</strong><br/>${escapeHtml(feature.properties?.source)}<br/>${escapeHtml(feature.properties?.distanceKm)} km away`)
        .addTo(map);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const routeSource = map.getSource(ROUTE_SOURCE) as maplibregl.GeoJSONSource | undefined;
    const monitorSource = map.getSource(MONITOR_SOURCE) as maplibregl.GeoJSONSource | undefined;
    routeSource?.setData(routeGeoJson);
    monitorSource?.setData(monitorGeoJson);
    fitMap(map, points, monitors);
  }, [routeGeoJson, monitorGeoJson, points, monitors]);

  return (
    <div className={styles.mapPanel}>
      <div ref={containerRef} className={styles.mapCanvas} />
      <div className={styles.mapLegend}>
        <span className={styles.legendSwatch} />
        <span>Lower to higher PM2.5</span>
      </div>
    </div>
  );
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

function fitMap(map: maplibregl.Map, points: MobileSensingPoint[], monitors: ReferenceMonitorMatch[]) {
  const coordinates = [
    ...points.map((point) => [point.longitude, point.latitude] as [number, number]),
    ...monitors.map((match) => [match.monitor.longitude, match.monitor.latitude] as [number, number]),
  ];
  if (!coordinates.length) return;
  const bounds = coordinates.reduce(
    (next, coordinate) => next.extend(coordinate),
    new maplibregl.LngLatBounds(coordinates[0], coordinates[0]),
  );
  map.fitBounds(bounds, { padding: 44, maxZoom: 14, duration: 0 });
}

function initialCenter(points: MobileSensingPoint[], monitors: ReferenceMonitorMatch[]): [number, number] {
  const first = points[0];
  const monitor = monitors[0]?.monitor;
  return first ? [first.longitude, first.latitude] : monitor ? [monitor.longitude, monitor.latitude] : [-123.12, 49.28];
}

function pmColor(pm25: number) {
  if (pm25 <= 12) return "#3aa76d";
  if (pm25 <= 35) return "#d6a100";
  if (pm25 <= 55) return "#d96c2c";
  if (pm25 <= 150) return "#cf3f4b";
  return "#7c4bb7";
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}
