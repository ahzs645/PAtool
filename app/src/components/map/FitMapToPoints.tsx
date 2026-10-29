import { useEffect } from "react";
import { fitMapToPoints, useMap, type FitMapToPointsOptions, type LngLatPoint } from "@pgmaps/geo-toolkit/map";

/**
 * Frame the map on `[longitude, latitude]` points once it is ready, and again
 * whenever the points change. Render it inside a PaMap. Pass a memoized array:
 * a new one each render would refit on every render.
 */
export function FitMapToPoints({ points, ...options }: { points: readonly LngLatPoint[] } & FitMapToPointsOptions) {
  const { map, isLoaded } = useMap();
  const { padding = 48, pad = 0.05, minSpan = 0.02, maxZoom = 13, duration = 0, trim } = options;

  useEffect(() => {
    if (!map || !isLoaded || points.length === 0) return;
    fitMapToPoints(map, points, { padding, pad, minSpan, maxZoom, duration, trim });
  }, [map, isLoaded, points, padding, pad, minSpan, maxZoom, duration, trim]);

  return null;
}
