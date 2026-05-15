import { aqiBreakpointsWithPalette, EPA_PM25_AQI_PROFILE } from "@patool/shared";

import type { InterpolationMeta } from "./types";
import styles from "../MapPage.module.css";

type HeatmapLegendProps = {
  heatmapMethodLabel: string;
  interpolationMeta: InterpolationMeta | null;
};

export function HeatmapLegend({ heatmapMethodLabel, interpolationMeta }: HeatmapLegendProps) {
  const krigingDiagnostics = interpolationMeta?.krigingDiagnostics ?? null;
  const exactComparison = krigingDiagnostics?.artifacts.exactSampleComparison;
  const bands = aqiBreakpointsWithPalette(EPA_PM25_AQI_PROFILE, "subdued");

  return (
    <div className={styles.legend}>
      <div className={styles.legendTitle}>AQI Surface</div>
      <div className={styles.legendSubtitle}>{heatmapMethodLabel}</div>
      <div
        className={styles.legendBar}
        style={{ background: `linear-gradient(90deg, ${bands.map((band) => band.color).join(", ")})` }}
      />
      <div className={styles.legendLabels}>
        {bands.map((band) => <span key={`${band.aqiLow}-${band.aqiHigh}`}>{band.aqiLow}</span>)}
      </div>
      {interpolationMeta && (
        <div className={styles.legendMeta}>
          <span>{interpolationMeta.pointsUsed} sensors in play</span>
          <span>{interpolationMeta.gridWidth}x{interpolationMeta.gridHeight} grid</span>
          {interpolationMeta.capped && <span>Viewport-prioritized sampling</span>}
        </div>
      )}
      {krigingDiagnostics && (
        <div className={styles.diagnosticsPanel}>
          <div className={styles.diagnosticsTitle}>Variogram / QC</div>
          <div className={styles.diagnosticsGrid}>
            <span>Range</span>
            <strong>{krigingDiagnostics.variogram.rangeKm.toFixed(1)} km</strong>
            <span>Sill</span>
            <strong>{krigingDiagnostics.variogram.sill.toFixed(2)}</strong>
            <span>Nugget</span>
            <strong>{krigingDiagnostics.variogram.nugget.toFixed(2)}</strong>
            <span>Boundary</span>
            <strong>{(krigingDiagnostics.artifacts.tileBoundaryOutlierRate * 100).toFixed(0)}%</strong>
            {exactComparison && (
              <>
                <span>Sample CV</span>
                <strong>{exactComparison.meanAbs.toFixed(2)} ug/m3</strong>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
