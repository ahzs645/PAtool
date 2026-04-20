export function parseOverlayGeoJson(raw: unknown): GeoJSON.FeatureCollection {
  if (!raw || typeof raw !== "object") {
    throw new Error("GeoJSON root must be an object");
  }

  const obj = raw as { type?: string; features?: unknown };
  if (obj.type === "FeatureCollection" && Array.isArray(obj.features)) {
    return raw as GeoJSON.FeatureCollection;
  }

  if (obj.type === "Feature") {
    return { type: "FeatureCollection", features: [raw as GeoJSON.Feature] };
  }

  if (
    obj.type === "Point" || obj.type === "MultiPoint"
    || obj.type === "LineString" || obj.type === "MultiLineString"
    || obj.type === "Polygon" || obj.type === "MultiPolygon"
  ) {
    return {
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: raw as GeoJSON.Geometry, properties: {} }],
    };
  }

  throw new Error(`Unsupported GeoJSON type "${obj.type ?? "unknown"}"`);
}
