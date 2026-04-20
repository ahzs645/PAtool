function colorFromOgrStyle(value: unknown): string {
  if (typeof value !== "string") return "#64748b";
  const match = /#([0-9a-fA-F]{6})/.exec(value);
  return match ? `#${match[1]}` : "#64748b";
}

export function normalizeAirFuseGeoJson(raw: unknown): GeoJSON.FeatureCollection {
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

export function geoJsonDescription(raw: unknown): string | undefined {
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

export function geoJsonBounds(collection: GeoJSON.FeatureCollection): [[number, number], [number, number]] | null {
  const bounds = { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity };
  for (const feature of collection.features) {
    extendGeometryBounds(feature.geometry, bounds);
  }
  if (!Number.isFinite(bounds.west) || !Number.isFinite(bounds.south)) return null;
  return [[bounds.west, bounds.south], [bounds.east, bounds.north]];
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
