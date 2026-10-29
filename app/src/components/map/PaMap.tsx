import { forwardRef, type ReactNode } from "react";
import type { StyleSpecification } from "maplibre-gl";
import { Map, MapControls, type MapProps, type MapRef } from "@pgmaps/geo-toolkit/map";
import { WorkspaceProvider } from "@pgmaps/geo-toolkit/workspace";

import { useTheme } from "../../hooks/useTheme";
import "./PaMap.css";

export const STYLE_LIGHT = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
export const STYLE_DARK = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

const BASEMAP_STYLES = { light: STYLE_LIGHT, dark: STYLE_DARK };

function backgroundStyle(color: string): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [{ id: "background", type: "background", paint: { "background-color": color } }],
  };
}

// Tile-free stand-ins so data layers still draw offline or behind a firewall.
const FALLBACK_STYLES = { light: backgroundStyle("#e6ebf2"), dark: backgroundStyle("#0b0b0b") };

/** Zoom and compass, top-right: the controls every PAtool map shows. */
export const PA_MAP_CONTROLS = <MapControls position="top-right" showZoom showCompass />;

export type PaMapProps = Omit<MapProps, "theme" | "children"> & {
  children?: ReactNode;
  /** Classes for the workspace root, which fills the map's container. */
  workspaceClassName?: string;
};

/**
 * The toolkit map in PAtool's theme: it follows the app's light/dark setting,
 * uses the Carto basemaps with an offline fallback, and maps PAtool's colour
 * tokens onto the toolkit's (see PaMap.css). Give its container a height.
 */
export const PaMap = forwardRef<MapRef, PaMapProps>(function PaMap(
  { workspaceClassName, styles = BASEMAP_STYLES, controls = PA_MAP_CONTROLS, ...props },
  ref,
) {
  const { theme } = useTheme();
  return (
    <WorkspaceProvider
      theme={theme}
      className={workspaceClassName ? `patool-map ${workspaceClassName}` : "patool-map"}
      style={{ width: "100%", height: "100%" }}
    >
      <Map
        ref={ref}
        theme={theme}
        styles={styles}
        fallbackStyles={FALLBACK_STYLES}
        styleTimeoutMs={3500}
        loader="spinner"
        controls={controls}
        // MapLibre's default; without copies a zoomed-out map clamps its
        // centre and zooming back in lands somewhere else.
        renderWorldCopies
        {...props}
      />
    </WorkspaceProvider>
  );
});
