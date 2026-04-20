import type { Dispatch, RefObject, SetStateAction } from "react";
import type { InterpolationMethod } from "@patool/shared";

import type { InterpolationMeta, MapMode, OverlayLayer, Pm25Window } from "./types";
import { pm25WindowOptions } from "./types";
import styles from "../MapPage.module.css";

type MapToolbarProps = {
  mapMode: MapMode;
  setMapMode: Dispatch<SetStateAction<MapMode>>;
  interpMethod: InterpolationMethod;
  setInterpMethod: Dispatch<SetStateAction<InterpolationMethod>>;
  gridRes: number;
  setGridRes: Dispatch<SetStateAction<number>>;
  idwPower: number;
  setIdwPower: Dispatch<SetStateAction<number>>;
  followView: boolean;
  setFollowView: Dispatch<SetStateAction<boolean>>;
  onRecompute: () => void;
  heatmapMethodLabel: string;
  heatmapRuntimeLabel: string | null;
  interpolationMeta: InterpolationMeta | null;
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  pm25Window: Pm25Window;
  setPm25Window: Dispatch<SetStateAction<Pm25Window>>;
  outsideOnly: boolean;
  setOutsideOnly: Dispatch<SetStateAction<boolean>>;
  overlayInputRef: RefObject<HTMLInputElement | null>;
  overlayUrl: string;
  setOverlayUrl: Dispatch<SetStateAction<string>>;
  overlays: OverlayLayer[];
  overlayError: string | null;
  onOverlayFile: (file: File) => Promise<void>;
  onOverlayUrl: (url: string) => Promise<void>;
  onRemoveOverlay: (id: string) => void;
};

export function MapToolbar({
  mapMode,
  setMapMode,
  interpMethod,
  setInterpMethod,
  gridRes,
  setGridRes,
  idwPower,
  setIdwPower,
  followView,
  setFollowView,
  onRecompute,
  heatmapMethodLabel,
  heatmapRuntimeLabel,
  interpolationMeta,
  query,
  setQuery,
  pm25Window,
  setPm25Window,
  outsideOnly,
  setOutsideOnly,
  overlayInputRef,
  overlayUrl,
  setOverlayUrl,
  overlays,
  overlayError,
  onOverlayFile,
  onOverlayUrl,
  onRemoveOverlay,
}: MapToolbarProps) {
  return (
    <div className={styles.toolbar}>
      <div className={styles.modeToggle}>
        <button
          type="button"
          className={`${styles.modeButton} ${mapMode === "markers" ? styles.modeButtonActive : ""}`}
          onClick={() => setMapMode("markers")}
        >
          Markers
        </button>
        <button
          type="button"
          className={`${styles.modeButton} ${mapMode === "heatmap" ? styles.modeButtonActive : ""}`}
          onClick={() => setMapMode("heatmap")}
        >
          Heatmap
        </button>
      </div>

      {mapMode === "heatmap" && (
        <div className={styles.interpControls}>
          <select
            className={styles.select}
            value={interpMethod}
            onChange={(e) => setInterpMethod(e.target.value as InterpolationMethod)}
          >
            <option value="idw">IDW</option>
            <option value="kriging">Kriging</option>
          </select>
          <select
            className={styles.select}
            value={gridRes}
            onChange={(e) => setGridRes(Number(e.target.value))}
          >
            <option value={50}>Low (50x50)</option>
            <option value={100}>Medium (100x100)</option>
            <option value={200}>High (200x200)</option>
          </select>
          {interpMethod === "idw" && (
            <>
              <span className={styles.rangeLabel}>p={idwPower}</span>
              <input
                type="range"
                className={styles.rangeInput}
                min={1}
                max={4}
                step={0.5}
                value={idwPower}
                onChange={(e) => setIdwPower(Number(e.target.value))}
              />
            </>
          )}
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={followView}
              onChange={() => setFollowView((value) => !value)}
            />
            Follow view
          </label>
          <button
            type="button"
            className={styles.modeButton}
            onClick={onRecompute}
            title="Recompute interpolation for the current viewport"
          >
            Recompute
          </button>
          <div className={styles.heatmapStatus}>
            <span className={styles.statusPill}>{heatmapMethodLabel}</span>
            {interpolationMeta && (
              <span className={styles.statusPill}>
                {interpolationMeta.pointsUsed}/{interpolationMeta.totalPoints} sensors
              </span>
            )}
            {interpolationMeta && (
              <span className={styles.statusPill}>
                {interpolationMeta.gridWidth}x{interpolationMeta.gridHeight}
              </span>
            )}
            {interpolationMeta?.capped && (
              <span className={styles.statusPillMuted}>Capped for speed</span>
            )}
            {interpolationMeta?.krigingNeighbors && (
              <span className={styles.statusPillMuted}>{interpolationMeta.krigingNeighbors} neighbors</span>
            )}
            {interpolationMeta?.krigingTileSize && (
              <span className={styles.statusPillMuted}>{interpolationMeta.krigingTileSize}x{interpolationMeta.krigingTileSize} tiles</span>
            )}
            {interpolationMeta?.krigingDiagnostics && (
              <span className={styles.statusPillMuted}>
                {interpolationMeta.krigingDiagnostics.mode === "exact"
                  ? "Exact solve"
                  : `${interpolationMeta.krigingDiagnostics.effectiveTileSize}x${interpolationMeta.krigingDiagnostics.effectiveTileSize} active tiles`}
              </span>
            )}
            {interpolationMeta?.krigingDiagnostics?.fallbackReason && (
              <span className={styles.statusPillMuted}>Tile fallback</span>
            )}
            {interpolationMeta?.krigingDiagnostics && import.meta.env.DEV && (
              <span className={styles.statusPillMuted}>
                boundary {(interpolationMeta.krigingDiagnostics.artifacts.tileBoundaryOutlierRate * 100).toFixed(0)}%
              </span>
            )}
            {heatmapRuntimeLabel && (
              <span className={styles.computing}>{heatmapRuntimeLabel}</span>
            )}
            {interpolationMeta?.error && (
              <span className={styles.statusPillError}>Interpolation fallback</span>
            )}
          </div>
        </div>
      )}

      <input
        aria-label="Sensor search"
        className={styles.search}
        placeholder="Search by label..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <select
        aria-label="PM2.5 time window"
        className={styles.select}
        value={pm25Window}
        onChange={(e) => setPm25Window(e.target.value as Pm25Window)}
      >
        {pm25WindowOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>
            PM2.5 {opt.label}
          </option>
        ))}
      </select>
      <label className={styles.toggle}>
        <input
          type="checkbox"
          checked={outsideOnly}
          onChange={() => setOutsideOnly((value) => !value)}
        />
        Outside only
      </label>

      <div className={styles.overlayControls}>
        <button
          type="button"
          className={styles.modeButton}
          onClick={() => overlayInputRef.current?.click()}
          title="Load a GeoJSON overlay (boundaries, emissions, traffic, etc.)"
        >
          Load overlay
        </button>
        <input
          ref={overlayInputRef}
          type="file"
          accept=".geojson,.json,application/geo+json,application/json"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onOverlayFile(file);
            e.target.value = "";
          }}
        />
        <input
          type="url"
          className={styles.search}
          placeholder="…or paste a GeoJSON URL"
          value={overlayUrl}
          onChange={(e) => setOverlayUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void onOverlayUrl(overlayUrl);
            }
          }}
        />
        {overlays.map((overlay) => (
          <span
            key={overlay.id}
            className={styles.statusPill}
            style={{ borderColor: overlay.color, color: overlay.color }}
            title={overlay.name}
          >
            {overlay.name.length > 24 ? `${overlay.name.slice(0, 24)}…` : overlay.name}
            <button
              type="button"
              onClick={() => onRemoveOverlay(overlay.id)}
              style={{ marginLeft: 6, background: "none", border: "none", cursor: "pointer", color: "inherit" }}
              aria-label={`Remove overlay ${overlay.name}`}
            >
              ×
            </button>
          </span>
        ))}
        {overlayError && <span className={styles.statusPillError}>{overlayError}</span>}
      </div>
    </div>
  );
}
