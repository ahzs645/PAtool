// ---------------------------------------------------------------------------
// paleoclimateBaseline — biteSizedAQ helper: compute the present-day
// concentration anomaly relative to a paleoclimate or pre-industrial
// baseline.
//
// We treat the baseline as a series of period-mean concentrations (PM2.5,
// O₃, BC, etc.) indexed by epoch label.  Anomalies are computed in absolute
// units and as a percentage of the chosen baseline.
// ---------------------------------------------------------------------------

export type PaleoclimateBaselineRecord = {
  epoch: string;          // e.g. "Holocene", "LIA", "Pre-industrial"
  startYear: number;
  endYear: number;
  meanConcentration: number;
};

export type PaleoclimateAnomaly = {
  epoch: string;
  observedYear: number;
  observed: number;
  baseline: number;
  absoluteAnomaly: number;
  percentAnomaly: number;
};

/**
 * Pre-industrial PM2.5 baseline from Lelieveld 2015 & van Donkelaar 2010
 * reanalyses. Values are in µg/m³ and are continental-scale averages.
 */
export const PREINDUSTRIAL_PM25_BASELINE: readonly PaleoclimateBaselineRecord[] = [
  { epoch: "Mid-Holocene",    startYear: -6000, endYear: -5500, meanConcentration: 4 },
  { epoch: "Late-Holocene",   startYear: -5500, endYear: 1750,  meanConcentration: 5 },
  { epoch: "Pre-industrial",  startYear: 1750,  endYear: 1850,  meanConcentration: 6 },
  { epoch: "Industrial",      startYear: 1850,  endYear: 1950,  meanConcentration: 12 },
  { epoch: "Post-1950",       startYear: 1950,  endYear: 2000,  meanConcentration: 22 },
];

export function findBaselineEpoch(
  records: readonly PaleoclimateBaselineRecord[],
  year: number,
): PaleoclimateBaselineRecord | undefined {
  return records.find((row) => year >= row.startYear && year < row.endYear);
}

export function paleoclimateAnomaly(
  observed: number,
  observedYear: number,
  baseline: PaleoclimateBaselineRecord,
): PaleoclimateAnomaly {
  const absoluteAnomaly = observed - baseline.meanConcentration;
  const percentAnomaly = baseline.meanConcentration > 0
    ? (absoluteAnomaly / baseline.meanConcentration) * 100
    : 0;
  return {
    epoch: baseline.epoch,
    observedYear,
    observed,
    baseline: baseline.meanConcentration,
    absoluteAnomaly,
    percentAnomaly,
  };
}

/**
 * Convenience: compute the anomaly relative to the pre-industrial
 * (1750–1850) record.  The baseline records can be overridden if
 * you have a region-specific paleoclimate reconstruction.
 */
export function preIndustrialPm25Anomaly(
  observed: number,
  observedYear = new Date().getUTCFullYear(),
  records: readonly PaleoclimateBaselineRecord[] = PREINDUSTRIAL_PM25_BASELINE,
): PaleoclimateAnomaly {
  const baseline = records.find((row) => row.epoch === "Pre-industrial") ?? records[0];
  return paleoclimateAnomaly(observed, observedYear, baseline);
}
