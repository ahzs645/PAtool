import type { AirFuseLayerConfig, AirFuseLayerKey } from "./types";

export const AIRFUSE_BUCKET_BASE_URL = "https://airnow-navigator-layers.s3.us-east-2.amazonaws.com";
export const AIRFUSE_SOURCE_REFERENCE = {
  upstream: "https://github.com/barronh/airfuse",
  localPath: "/Users/ahmadjalil/Downloads/airfuse-main",
  example: "/Users/ahmadjalil/Downloads/airfuse-main/examples/typical/map.html",
};

export const STYLE_LIGHT = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
export const STYLE_DARK = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
export const AIRFUSE_SOURCE_ID = "airfuse-surface";
export const AIRFUSE_FILL_LAYER_ID = "airfuse-surface-fill";
export const AIRFUSE_LINE_LAYER_ID = "airfuse-surface-line";

export const AIRFUSE_LAYERS: Record<AirFuseLayerKey, AirFuseLayerConfig> = {
  "airfuse-pm25": {
    key: "airfuse-pm25",
    label: "AirFuse PM2.5",
    shortLabel: "AirFuse PM2.5",
    source: "fusion",
    species: "PM25",
    expectedDailyCount: 24,
    unit: "ug/m3",
    observedColumn: "pm25",
    predictedColumn: "FUSED_aVNA",
  },
  "airfuse-o3": {
    key: "airfuse-o3",
    label: "AirFuse O3",
    shortLabel: "AirFuse O3",
    source: "fusion",
    species: "O3",
    expectedDailyCount: 24,
    unit: "ppb",
    observedColumn: "ozone",
    predictedColumn: "LOO_aVNA",
  },
  "goes-pm25": {
    key: "goes-pm25",
    label: "GOES PM2.5",
    shortLabel: "GOES PM2.5",
    source: "goes",
    species: "PM25",
    expectedDailyCount: 13,
    unit: "ug/m3",
  },
};

export const LAYER_OPTIONS = Object.values(AIRFUSE_LAYERS);
