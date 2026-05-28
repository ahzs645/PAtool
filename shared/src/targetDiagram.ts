/**
 * Target diagram (Jolliff 2009 / EPA sensor evaluation protocol). Each
 * model/sensor lands at a point whose distance to the origin is the
 * normalised RMSE; horizontal axis is normalised standard-deviation bias
 * (mod − ref), vertical axis is normalised bias (mean error).
 */

export type TargetPoint = {
  label: string;
  /** Normalised bias = (mean_mod - mean_obs) / sd_obs. */
  bias: number;
  /** Normalised unbiased RMSE with sign of sd_mod − sd_obs. */
  ubRmseNorm: number;
  /** Sqrt(bias² + ubRmse²). |targetScore| < 1 lands inside the bullseye. */
  targetScore: number;
};

export type TargetDiagramResult = {
  reference: { mean: number; sd: number };
  points: TargetPoint[];
};

function statsForSeries(values: ReadonlyArray<number | null>): { mean: number; sd: number } {
  const usable = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (usable.length === 0) return { mean: 0, sd: 0 };
  const mean = usable.reduce((s, v) => s + v, 0) / usable.length;
  const sd = Math.sqrt(usable.reduce((s, v) => s + (v - mean) ** 2, 0) / usable.length);
  return { mean, sd };
}

export function targetDiagram(
  reference: ReadonlyArray<number | null>,
  models: ReadonlyArray<{ label: string; values: ReadonlyArray<number | null> }>,
): TargetDiagramResult {
  const ref = statsForSeries(reference);
  const sdRef = ref.sd || 1; // avoid divide-by-zero; flag downstream if needed
  const points: TargetPoint[] = models.map((m) => {
    const aligned = align(reference, m.values);
    const obs = aligned.map((p) => p.obs);
    const mod = aligned.map((p) => p.mod);
    const sObs = statsForSeries(obs);
    const sMod = statsForSeries(mod);
    const bias = (sMod.mean - sObs.mean) / sdRef;
    const ubRmse = unbiasedRmse(aligned, sMod.mean, sObs.mean) / sdRef;
    const sign = sMod.sd >= sObs.sd ? 1 : -1;
    const signedUb = sign * ubRmse;
    return {
      label: m.label,
      bias,
      ubRmseNorm: signedUb,
      targetScore: Math.sqrt(bias * bias + ubRmse * ubRmse),
    };
  });
  return { reference: ref, points };
}

function align(
  reference: ReadonlyArray<number | null>,
  values: ReadonlyArray<number | null>,
): Array<{ obs: number; mod: number }> {
  const out: Array<{ obs: number; mod: number }> = [];
  for (let i = 0; i < reference.length && i < values.length; i += 1) {
    const r = reference[i];
    const v = values[i];
    if (typeof r === "number" && Number.isFinite(r) && typeof v === "number" && Number.isFinite(v)) {
      out.push({ obs: r, mod: v });
    }
  }
  return out;
}

function unbiasedRmse(pairs: ReadonlyArray<{ obs: number; mod: number }>, meanMod: number, meanObs: number): number {
  if (pairs.length === 0) return 0;
  let sumSq = 0;
  for (const p of pairs) {
    const d = (p.mod - meanMod) - (p.obs - meanObs);
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / pairs.length);
}
