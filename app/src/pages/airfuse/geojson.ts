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

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
