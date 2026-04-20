import type maplibregl from "maplibre-gl";

import { AIRFUSE_FILL_LAYER_ID, AIRFUSE_LINE_LAYER_ID, AIRFUSE_SOURCE_ID } from "./config";

export function syncAirFuseLayer(map: maplibregl.Map, collection: GeoJSON.FeatureCollection) {
  const existing = map.getSource(AIRFUSE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (existing) {
    existing.setData(collection);
  } else {
    map.addSource(AIRFUSE_SOURCE_ID, { type: "geojson", data: collection });
  }

  if (!map.getLayer(AIRFUSE_FILL_LAYER_ID)) {
    map.addLayer({
      id: AIRFUSE_FILL_LAYER_ID,
      type: "fill",
      source: AIRFUSE_SOURCE_ID,
      paint: {
        "fill-color": ["get", "fillColor"],
        "fill-opacity": 0.58,
      },
    });
  }

  if (!map.getLayer(AIRFUSE_LINE_LAYER_ID)) {
    map.addLayer({
      id: AIRFUSE_LINE_LAYER_ID,
      type: "line",
      source: AIRFUSE_SOURCE_ID,
      paint: {
        "line-color": ["get", "fillColor"],
        "line-opacity": 0.78,
        "line-width": 0.75,
      },
    });
  }
}
