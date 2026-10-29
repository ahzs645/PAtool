import { useMemo } from "react";
import type { TrajectoryClusterResult, TrajectoryLevelCell, TrajectoryPolyline } from "@patool/shared";
import { MapCircleLayer, MapFillLayer, MapLineLayer, type LngLatPoint } from "@pgmaps/geo-toolkit/map";
import { createScaleLegend, resolvePaletteScale } from "@pgmaps/geo-toolkit/scales";
import { escapeHtml, MapOverlay, ScaleLegend } from "@pgmaps/geo-toolkit/ui";

import { FitMapToPoints } from "../../components/map/FitMapToPoints";
import { PaMap } from "../../components/map/PaMap";
import { useTheme } from "../../hooks/useTheme";

const CLUSTER_COLORS = ["#4754b8", "#e06c5e", "#2e9e8f", "#e5953e", "#6e7ac8", "#7c3aed"];
const CELL_COLORS = ["#ffffb2", "#fecc5c", "#fd8d3c", "#f03b20", "#bd0026"];

type TrajectoryMapProps = {
  polylines: TrajectoryPolyline[];
  clusters: TrajectoryClusterResult["clusters"];
  cells: TrajectoryLevelCell[];
  /** Grid spacing the cells were binned at, in degrees. */
  cellDeg: number;
};

function lineHoverHtml(properties: Record<string, unknown>): string {
  return `<strong>${escapeHtml(properties.id)}</strong><br/>Arrival ${escapeHtml(properties.arrival)}<br/>${escapeHtml(properties.cluster)}`;
}

function cellHoverHtml(properties: Record<string, unknown>): string {
  return `<strong>${escapeHtml(Number(properties.meanValue).toFixed(2))}</strong> mean receptor value`
    + `<br/>${escapeHtml(properties.count)} trajectory points`;
}

/** Back trajectories coloured by cluster over the trajLevel (CWT) grid. */
export function TrajectoryMap({ polylines, clusters, cells, cellDeg }: TrajectoryMapProps) {
  const { theme } = useTheme();
  const clusterOf = useMemo(() => {
    const lookup = new Map<string, { label: string; color: string }>();
    clusters.forEach((cluster, index) => {
      for (const member of cluster.members) {
        lookup.set(member, { label: cluster.label, color: CLUSTER_COLORS[index % CLUSTER_COLORS.length] });
      }
    });
    return lookup;
  }, [clusters]);

  const lines = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: polylines.map((line) => ({
      type: "Feature",
      geometry: { type: "LineString", coordinates: line.coords.map(([lat, lon]) => [lon, lat]) },
      properties: {
        id: line.id,
        arrival: line.arrival,
        cluster: clusterOf.get(line.id)?.label ?? "Unclustered",
        color: clusterOf.get(line.id)?.color ?? "#64748b",
      },
    })),
  }), [clusterOf, polylines]);

  const receptors = useMemo<GeoJSON.FeatureCollection>(() => {
    const seen = new Map<string, [number, number]>();
    for (const line of polylines) {
      const start = line.coords[line.hours.indexOf(0)] ?? line.coords[0];
      if (start && !seen.has(line.receptor)) seen.set(line.receptor, [start[1], start[0]]);
    }
    return {
      type: "FeatureCollection",
      features: Array.from(seen, ([receptor, coordinates]) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates },
        properties: { id: receptor },
      })),
    };
  }, [polylines]);

  const scale = useMemo(() => {
    const values = cells.map((cell) => cell.meanValue).filter(Number.isFinite);
    if (values.length === 0) return null;
    return resolvePaletteScale({
      colors: CELL_COLORS,
      domain: [Math.min(...values), Math.max(...values)],
      classes: CELL_COLORS.length,
      missingColor: "#cbd5e1",
    });
  }, [cells]);

  const grid = useMemo<GeoJSON.FeatureCollection>(() => {
    const half = cellDeg / 2;
    return {
      type: "FeatureCollection",
      features: cells.map((cell, index) => ({
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [[
            [cell.lon - half, cell.lat - half],
            [cell.lon + half, cell.lat - half],
            [cell.lon + half, cell.lat + half],
            [cell.lon - half, cell.lat + half],
            [cell.lon - half, cell.lat - half],
          ]],
        },
        properties: {
          id: index,
          meanValue: cell.meanValue,
          count: cell.count,
          color: scale?.colorForValue(cell.meanValue) ?? "#cbd5e1",
        },
      })),
    };
  }, [cellDeg, cells, scale]);

  const legend = useMemo(
    () => (scale ? createScaleLegend(scale, { title: "Mean receptor value" }) : null),
    [scale],
  );

  const extent = useMemo<LngLatPoint[]>(
    () => polylines.flatMap((line) => line.coords.map(([lat, lon]) => [lon, lat] as const)),
    [polylines],
  );

  return (
    <PaMap center={[-120, 47]} zoom={5}>
      <MapFillLayer
        data={grid}
        fillColor={["get", "color"]}
        fillOpacity={0.55}
        lineColor="#ffffff"
        lineWidth={0.5}
        hoverHtml={cellHoverHtml}
        layerOrder={1}
      />
      <MapLineLayer
        data={lines}
        color={["get", "color"]}
        width={2.5}
        opacity={0.9}
        hoverHtml={lineHoverHtml}
        layerOrder={2}
      />
      <MapCircleLayer
        data={receptors}
        color={theme === "dark" ? "#f8fafc" : "#111827"}
        radius={6}
        strokeColor={theme === "dark" ? "#111827" : "#ffffff"}
        strokeWidth={2}
        hoverHtml={(properties) => `<strong>Receptor ${escapeHtml(properties.id)}</strong>`}
        layerOrder={3}
      />
      <FitMapToPoints points={extent} pad={0.1} maxZoom={9} />
      {legend && (
        <MapOverlay position="bottom-left" className="max-w-[16rem] p-2">
          <ScaleLegend legend={legend} formatValue={(value) => value.toFixed(1)} showMissing={false} />
        </MapOverlay>
      )}
    </PaMap>
  );
}
