import { useMemo, useState, type ReactNode } from "react";
import { MapCircleLayer, MapFillLayer, type LngLatPoint } from "@pgmaps/geo-toolkit/map";
import { escapeHtml, MapLegend, MapLegendItem } from "@pgmaps/geo-toolkit/ui";

import { useTheme } from "../../hooks/useTheme";
import { FitMapToPoints } from "./FitMapToPoints";
import { PaMap } from "./PaMap";

/** Properties each receptor point carries; `html` is shown on click and must already be escaped. */
export type ReceptorProperties = {
  id: string;
  color: string;
  radius: number;
  html: string;
};

export type ReceptorSensor = {
  id: string;
  longitude: number;
  latitude: number;
  /** Shown on hover when present. */
  valueLabel?: string;
};

type ReceptorMapProps = {
  receptors: GeoJSON.FeatureCollection<GeoJSON.Point, ReceptorProperties>;
  /** Legend name for the receptor layer, e.g. "Schools / POIs". */
  receptorLabel: string;
  sensors: ReadonlyArray<ReceptorSensor>;
  /** Optional shaded areas under everything, e.g. coverage radii. */
  areas?: GeoJSON.FeatureCollection;
  areaLabel?: string;
  /** Extra legend rows, such as the colour key for receptors. */
  legend?: ReactNode;
};

const SENSOR_COLOR = "#64748b";
const AREA_COLOR = "#4754b8";

function sensorHoverHtml(properties: Record<string, unknown>): string {
  const value = properties.valueLabel ? `<br/>${escapeHtml(properties.valueLabel)}` : "";
  return `<strong>Sensor ${escapeHtml(properties.id)}</strong>${value}`;
}

function receptorClickHtml(properties: Record<string, unknown>): string {
  return String(properties.html ?? "");
}

/**
 * Receptor points (schools, tracts, any points of interest) over the sensor
 * network they are estimated from, with layer toggles in the legend.
 */
export function ReceptorMap({ receptors, receptorLabel, sensors, areas, areaLabel, legend }: ReceptorMapProps) {
  const { theme } = useTheme();
  const outline = theme === "dark" ? "#f8fafc" : "#111827";
  const [showReceptors, setShowReceptors] = useState(true);
  const [showSensors, setShowSensors] = useState(true);
  const [showAreas, setShowAreas] = useState(true);

  const sensorCollection = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: sensors
      .filter((sensor) => Number.isFinite(sensor.longitude) && Number.isFinite(sensor.latitude))
      .map((sensor) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [sensor.longitude, sensor.latitude] },
        properties: { id: sensor.id, valueLabel: sensor.valueLabel ?? "" },
      })),
  }), [sensors]);

  // Frame the receptors; the sensor network can span a continent.
  const extent = useMemo<LngLatPoint[]>(() => {
    const points = receptors.features.map((feature) => feature.geometry.coordinates as unknown as LngLatPoint);
    return points.length > 0
      ? points
      : sensorCollection.features.map((feature) => (feature.geometry as GeoJSON.Point).coordinates as unknown as LngLatPoint);
  }, [receptors, sensorCollection]);

  return (
    <PaMap center={[-100, 45]} zoom={4}>
      {areas && (
        <MapFillLayer
          data={areas}
          fillColor={AREA_COLOR}
          fillOpacity={0.08}
          lineColor={AREA_COLOR}
          lineOpacity={0.5}
          lineWidth={1}
          visible={showAreas}
          layerOrder={1}
        />
      )}
      <MapCircleLayer
        data={sensorCollection}
        color={SENSOR_COLOR}
        radius={3.5}
        opacity={0.7}
        strokeWidth={0.75}
        visible={showSensors}
        hoverHtml={sensorHoverHtml}
        layerOrder={2}
      />
      <MapCircleLayer
        data={receptors}
        color={["get", "color"]}
        radius={["get", "radius"]}
        opacity={0.9}
        strokeColor={outline}
        strokeWidth={1.25}
        visible={showReceptors}
        clickHtml={receptorClickHtml}
        layerOrder={3}
      />
      <FitMapToPoints points={extent} pad={0.15} minSpan={0.05} maxZoom={13} />
      <MapLegend position="bottom-left" title="Layers" className="max-w-[15rem]">
        <MapLegendItem
          color={outline}
          swatchShape="dot"
          label={receptorLabel}
          active={showReceptors}
          onClick={() => setShowReceptors((value) => !value)}
        />
        <MapLegendItem
          color={SENSOR_COLOR}
          swatchShape="dot"
          label={`Sensors (${sensorCollection.features.length})`}
          active={showSensors}
          onClick={() => setShowSensors((value) => !value)}
        />
        {areas && (
          <MapLegendItem
            color={AREA_COLOR}
            label={areaLabel ?? "Areas"}
            active={showAreas}
            onClick={() => setShowAreas((value) => !value)}
          />
        )}
        {legend}
      </MapLegend>
    </PaMap>
  );
}

/** A geodesic circle of `radiusKm` around a point, as a polygon ring. */
export function circlePolygon(longitude: number, latitude: number, radiusKm: number, steps = 64): GeoJSON.Polygon {
  const earthRadiusKm = 6371;
  const angular = radiusKm / earthRadiusKm;
  const lat1 = (latitude * Math.PI) / 180;
  const lon1 = (longitude * Math.PI) / 180;
  const ring: [number, number][] = [];
  for (let step = 0; step <= steps; step += 1) {
    const bearing = (2 * Math.PI * step) / steps;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
    );
    const lon2 = lon1 + Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );
    ring.push([(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
  }
  return { type: "Polygon", coordinates: [ring] };
}
