import {
  applyLinearBiasCorrection,
  blandAltman,
  linearFit,
  relativeExpandedUncertainty,
  type MeasurementPair,
} from "@patool/shared";

export function finiteMeasurementPairs(pairs: MeasurementPair[]): MeasurementPair[] {
  return pairs.filter((pair) => Number.isFinite(pair.reference) && Number.isFinite(pair.sensor));
}

export function maxMeasurementValue(pairs: MeasurementPair[]): number {
  const values = finiteMeasurementPairs(pairs).flatMap((pair) => [pair.reference, pair.sensor]);
  return values.length ? Math.ceil(Math.max(...values) * 1.05) : 1;
}

export function median(values: number[]): number | undefined {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return undefined;
  return sorted[Math.floor(sorted.length / 2)];
}

export function analyzeMeasurements(
  pairs: MeasurementPair[],
  correctedPairs: MeasurementPair[] = [],
  includeGeneratedCorrection = true,
) {
  const corrected = correctedPairs.length || !includeGeneratedCorrection
    ? correctedPairs
    : applyLinearBiasCorrection(pairs).pairs;
  const reu = relativeExpandedUncertainty(pairs, { k: 2, minSamples: 10 });

  return {
    finitePairs: finiteMeasurementPairs(pairs),
    fit: linearFit(pairs),
    correctedPairs: corrected,
    correctedFit: linearFit(corrected),
    agreement: blandAltman(pairs),
    reu,
    medianReu: median(reu.points.map((point) => point.reu)),
    maxValue: maxMeasurementValue(pairs),
  };
}
