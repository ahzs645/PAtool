import type { InterpolationMethod } from "@patool/shared";

export const STYLE_LIGHT = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
export const STYLE_DARK = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

export const LAYER_ID = "sensors-circles";
export const SOURCE_ID = "sensors";
export const HEATMAP_LAYER_ID = "heatmap-layer";
export const HEATMAP_SOURCE_ID = "heatmap-source";
export const OVERLAY_ID_PREFIX = "user-overlay-";
export const OVERLAY_PALETTE = ["#2563eb", "#db2777", "#0d9488", "#ea580c", "#7c3aed"];
export const MISSING_PM_COLOR = "#94a3b8";

export const MIN_INTERPOLATION_POINTS = 3;
export const VIEWPORT_PADDING_RATIO = 0.2;
export const MIN_GRID_RESOLUTION = 50;
export const MAX_GRID_EDGE = 384;
export const MAX_KRIGING_GRID_CELLS = 76_800;
export const MAX_IDW_GRID_CELLS = 120_000;
export const DEFAULT_KRIGING_NEIGHBORS = 12;
export const DEFAULT_KRIGING_TILE_SIZE = 4;
export const VIEW_BOUNDS_QUANTIZATION_STEPS = 512;
export const MIN_VIEW_BOUNDS_QUANTIZATION_DEGREES = 0.0001;
export const VIEW_ZOOM_QUANTIZATION_STEP = 0.05;
export const RESIZE_RECOMPUTE_DEBOUNCE_MS = 200;
export const KRIGING_SELECTION_STABILITY_THRESHOLD = 0.85;

export const MAX_POINTS_BY_METHOD: Record<InterpolationMethod, number> = {
  idw: 2400,
  kriging: 400,
};
