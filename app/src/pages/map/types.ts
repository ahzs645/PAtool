import type { InterpolationMethod, KrigingDiagnostics } from "@patool/shared";

export type Pm25Window =
  | "pm25Current"
  | "pm25_10min"
  | "pm25_30min"
  | "pm25_1hr"
  | "pm25_6hr"
  | "pm25_1day"
  | "pm25_1week";

export const pm25WindowOptions: { value: Pm25Window; label: string }[] = [
  { value: "pm25Current", label: "Current" },
  { value: "pm25_10min", label: "10min" },
  { value: "pm25_30min", label: "30min" },
  { value: "pm25_1hr", label: "1hr" },
  { value: "pm25_6hr", label: "6hr" },
  { value: "pm25_1day", label: "1day" },
  { value: "pm25_1week", label: "1week" },
];

export type MapMode = "markers" | "heatmap";

export type MapSize = {
  width: number;
  height: number;
};

export type InterpolationMeta = {
  totalPoints: number;
  pointsUsed: number;
  gridWidth: number;
  gridHeight: number;
  capped: boolean;
  krigingNeighbors?: number;
  krigingTileSize?: number;
  krigingDiagnostics?: KrigingDiagnostics;
  durationMs?: number;
  error?: string;
};

export type HeatmapDebugState = {
  workerJobsPosted: number;
  staleResponsesIgnored: number;
  sourceRefreshes: number;
  sourceRemovals: number;
  workerRestarts: number;
  lastSelectedOverlapPct: number | null;
  lastSelectedOverlapCount: number;
  lastSelectedPointCount: number;
  lastSelectionStabilized: boolean;
  lastColorizeMs: number | null;
  lastMainThreadRenderMs: number | null;
  lastKrigingDiagnostics: KrigingDiagnostics | null;
  lastJob: {
    id: number;
    method: InterpolationMethod;
    gridWidth: number;
    gridHeight: number;
    points: number;
  } | null;
};

export type PatoolDebugWindow = Window & {
  __PAToolHeatmapDebug?: HeatmapDebugState;
};

export type OverlayLayer = {
  id: string;
  name: string;
  color: string;
  data: GeoJSON.FeatureCollection;
};
