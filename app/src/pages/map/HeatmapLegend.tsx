import type { InterpolationMeta } from "./types";
import styles from "../MapPage.module.css";

type HeatmapLegendProps = {
  heatmapMethodLabel: string;
  interpolationMeta: InterpolationMeta | null;
};

export function HeatmapLegend({ heatmapMethodLabel, interpolationMeta }: HeatmapLegendProps) {
  const krigingDiagnostics = interpolationMeta?.krigingDiagnostics ?? null;
  const exactComparison = krigingDiagnostics?.artifacts.exactSampleComparison;

  return (
    <div className={styles.legend}>
      <div className={styles.legendTitle}>AQI Surface</div>
      <div className={styles.legendSubtitle}>{heatmapMethodLabel}</div>
      <div className={styles.legendBar} />
      <div className={styles.legendLabels}>
        <span>0</span>
        <span>50</span>
        <span>100</span>
        <span>150</span>
        <span>200</span>
        <span>300</span>
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
