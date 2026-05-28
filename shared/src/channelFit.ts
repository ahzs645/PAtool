/**
 * `pat_internalFit` and `pat_externalFit` adapted from AirSensor (R).
 *
 *   - internalFit: regress channel B on channel A for a PurpleAir sensor.
 *     Quality indicator — slope ≈ 1, intercept ≈ 0, R² high.
 *
 *   - externalFit: regress a PurpleAir sensor on a co-located federal
 *     reference (FRM/FEM) monitor. Used for validation and bias estimates.
 */

import { linearFit, type LinearFit } from "./measurementError";

export type ChannelFitPoint = {
  timestamp: string;
  a: number | null;
  b: number | null;
};

export type ExternalPoint = {
  timestamp: string;
  pa: number | null;
  reference: number | null;
};

export type ChannelFitDiagnostic = {
  label: string;
  fit: LinearFit;
  /** Standard "channel quality" rule: |slope−1|≤0.05 and |intercept|≤2 µg/m³ and R²≥0.7. */
  qualityPass: boolean;
};

export function internalChannelFit(points: ReadonlyArray<ChannelFitPoint>): ChannelFitDiagnostic {
  const usable = points
    .filter((p) => typeof p.a === "number" && Number.isFinite(p.a) && typeof p.b === "number" && Number.isFinite(p.b))
    .map((p) => ({ reference: p.a as number, sensor: p.b as number }));
  const fit = linearFit(usable);
  const slopeOk = Math.abs(fit.slope - 1) <= 0.05;
  const interceptOk = Math.abs(fit.intercept) <= 2;
  const r2Ok = fit.r2 >= 0.7;
  return { label: "A→B internal", fit, qualityPass: slopeOk && interceptOk && r2Ok };
}

export function externalChannelFit(points: ReadonlyArray<ExternalPoint>): ChannelFitDiagnostic {
  const usable = points
    .filter((p) => typeof p.pa === "number" && Number.isFinite(p.pa) && typeof p.reference === "number" && Number.isFinite(p.reference))
    .map((p) => ({ reference: p.reference as number, sensor: p.pa as number }));
  const fit = linearFit(usable);
  const slopeOk = Math.abs(fit.slope - 1) <= 0.2;
  const interceptOk = Math.abs(fit.intercept) <= 5;
  const r2Ok = fit.r2 >= 0.7;
  return { label: "PA vs. federal external", fit, qualityPass: slopeOk && interceptOk && r2Ok };
}
