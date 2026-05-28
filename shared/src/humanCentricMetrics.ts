/**
 * Human-centric AQ metrics ported from biteSizedAQ notebook #24
 * "human-centric metrics".
 *
 * Translates pollutant concentrations into outcomes a clinician or
 * communicator can reason about: respiratory capacity loss (FEV1
 * percent), nebuliser dependence (extra doses per year), developmental
 * delays (IQ-point loss), and "biological heist" framing (lifespan
 * fraction). Numbers are illustrative — anchored to peer-reviewed
 * effect estimates but with deliberately wide ranges.
 */

export type HumanCentricExposure = {
  /** µg/m³ */
  pm25Annual: number;
  /** ppb (1-hour or annual depending on metric) */
  no2Annual?: number;
  /** ppb */
  o3Summer?: number;
};

export type HumanCentricMetrics = {
  fev1PercentLoss: number;
  extraNebuliserDosesPerYear: number;
  childhoodIqPointLoss: number;
  lifespanFractionLost: number;
  notes: string[];
};

/** Compute the suite of human-centric metrics for a given exposure mix. */
export function humanCentricMetrics(exposure: HumanCentricExposure): HumanCentricMetrics {
  const pm = Math.max(0, exposure.pm25Annual);
  const no2 = Math.max(0, exposure.no2Annual ?? 0);
  const o3 = Math.max(0, exposure.o3Summer ?? 0);

  // FEV1: ≈ 0.7 % loss per 10 µg/m³ above 5 µg/m³ (anchored to Schultz 2017).
  const fev1PercentLoss = Math.max(0, 0.7 * (pm - 5) / 10);
  // Nebuliser doses: 1 extra dose / yr per 5 µg/m³ pm above 12 (Gauderman 2007 surrogate).
  const extraNebuliserDosesPerYear = Math.max(0, (pm - 12) / 5);
  // IQ loss: ~0.5 IQ pts per 5 µg/m³ for children (Wang 2009 / 2017 syntheses).
  const childhoodIqPointLoss = Math.max(0, 0.5 * (pm - 5) / 5);
  // Lifespan fraction: AQLI ≈ −0.6 yr per 10 µg/m³ above 5; normalize to 78 yr life.
  const lifespanFractionLost = Math.max(0, (0.6 * (pm - 5) / 10) / 78);
  const notes: string[] = [];
  if (no2 > 20) notes.push("NO₂ above 20 ppb compounds respiratory effects.");
  if (o3 > 70) notes.push("Summer ozone above 70 ppb adds to FEV1 decline.");
  return {
    fev1PercentLoss,
    extraNebuliserDosesPerYear,
    childhoodIqPointLoss,
    lifespanFractionLost,
    notes,
  };
}
