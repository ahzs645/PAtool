/**
 * Model-evaluation statistics ported from openair: modStats (FAC2, MB,
 * NMB, MGE, NMGE, RMSE, COE, IOA, R), Taylor diagram coordinates,
 * conditional quantile bands.
 */

export type PairedObsMod = {
  obs: number;
  mod: number;
};

export type ModStats = {
  n: number;
  FAC2: number;
  MB: number;
  NMB: number;
  MGE: number;
  NMGE: number;
  RMSE: number;
  COE: number;
  IOA: number;
  r: number;
  meanObs: number;
  meanMod: number;
};

function valid(pairs: ReadonlyArray<PairedObsMod>): PairedObsMod[] {
  return pairs.filter(
    (p) => Number.isFinite(p.obs) && Number.isFinite(p.mod),
  );
}

/**
 * Compute openair `modStats` metrics for a set of observed/modelled pairs.
 *
 * - FAC2: fraction within a factor of 2 of obs
 * - MB:   mean bias (mod − obs)
 * - NMB:  normalised mean bias = MB / mean(obs)
 * - MGE:  mean gross error = mean(|mod − obs|)
 * - NMGE: normalised MGE = MGE / mean(obs)
 * - RMSE: root mean squared error
 * - COE:  coefficient of efficiency (Legates–McCabe)
 * - IOA:  index of agreement (Willmott)
 * - r:    Pearson correlation
 */
export function modStats(pairs: ReadonlyArray<PairedObsMod>): ModStats {
  const usable = valid(pairs);
  const n = usable.length;
  const empty: ModStats = {
    n: 0, FAC2: 0, MB: 0, NMB: 0, MGE: 0, NMGE: 0, RMSE: 0,
    COE: 0, IOA: 0, r: 0, meanObs: 0, meanMod: 0,
  };
  if (n === 0) return empty;

  let sumObs = 0;
  let sumMod = 0;
  for (const p of usable) {
    sumObs += p.obs;
    sumMod += p.mod;
  }
  const meanObs = sumObs / n;
  const meanMod = sumMod / n;

  let fac2 = 0;
  let bias = 0;
  let absErr = 0;
  let sqErr = 0;
  let denomCoe = 0;
  let denomIoaA = 0;
  let denomIoaB = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of usable) {
    const ratio = p.obs === 0 ? (p.mod === 0 ? 1 : Infinity) : p.mod / p.obs;
    if (ratio >= 0.5 && ratio <= 2) fac2 += 1;
    const e = p.mod - p.obs;
    bias += e;
    absErr += Math.abs(e);
    sqErr += e * e;
    denomCoe += Math.abs(p.obs - meanObs);
    const a = Math.abs(p.mod - meanObs);
    const b = Math.abs(p.obs - meanObs);
    denomIoaA += (a + b) ** 2;
    denomIoaB += e * e;
    const dx = p.obs - meanObs;
    const dy = p.mod - meanMod;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const MB = bias / n;
  const MGE = absErr / n;
  const RMSE = Math.sqrt(sqErr / n);
  const NMB = meanObs === 0 ? 0 : MB / meanObs;
  const NMGE = meanObs === 0 ? 0 : MGE / meanObs;
  const COE = denomCoe === 0 ? 0 : 1 - absErr / denomCoe;
  const IOA = denomIoaA === 0 ? 0 : 1 - denomIoaB / denomIoaA;
  const r = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
  return {
    n, FAC2: fac2 / n, MB, NMB, MGE, NMGE, RMSE, COE, IOA, r, meanObs, meanMod,
  };
}

export type TaylorPoint = {
  label: string;
  /** Standard deviation of the model series. */
  sdMod: number;
  /** Pearson correlation with reference. */
  r: number;
  /** Centred RMS difference between model and reference. */
  crmsd: number;
};

export type TaylorDiagram = {
  /** Reference standard deviation (observations). */
  sdRef: number;
  points: TaylorPoint[];
};

/**
 * Compute Taylor-diagram coordinates for a set of model series sharing a
 * reference series. Each model entry yields (sdMod, r, centred RMS
 * difference). Plot polar with angle = acos(r), radius = sdMod.
 */
export function taylorDiagram(
  reference: ReadonlyArray<number | null>,
  models: ReadonlyArray<{ label: string; values: ReadonlyArray<number | null> }>,
): TaylorDiagram {
  const obs = reference.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const meanObs = obs.length ? obs.reduce((s, v) => s + v, 0) / obs.length : 0;
  const sdRef = obs.length
    ? Math.sqrt(obs.reduce((s, v) => s + (v - meanObs) ** 2, 0) / obs.length)
    : 0;

  const points: TaylorPoint[] = [];
  for (const m of models) {
    const aligned: Array<{ o: number; mv: number }> = [];
    for (let i = 0; i < reference.length && i < m.values.length; i += 1) {
      const r = reference[i];
      const mv = m.values[i];
      if (typeof r === "number" && Number.isFinite(r) && typeof mv === "number" && Number.isFinite(mv)) {
        aligned.push({ o: r, mv });
      }
    }
    const n = aligned.length;
    if (n === 0) {
      points.push({ label: m.label, sdMod: 0, r: 0, crmsd: 0 });
      continue;
    }
    const mo = aligned.reduce((s, p) => s + p.o, 0) / n;
    const mm = aligned.reduce((s, p) => s + p.mv, 0) / n;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    let crmsd = 0;
    for (const p of aligned) {
      const dx = p.o - mo;
      const dy = p.mv - mm;
      sxx += dx * dx;
      syy += dy * dy;
      sxy += dx * dy;
      crmsd += (dy - dx) ** 2;
    }
    const sdMod = Math.sqrt(syy / n);
    const r = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
    points.push({
      label: m.label,
      sdMod,
      r,
      crmsd: Math.sqrt(crmsd / n),
    });
  }
  return { sdRef, points };
}

export type ConditionalQuantileBand = {
  binCenter: number;
  q25: number;
  q50: number;
  q75: number;
  q05: number;
  q95: number;
  count: number;
};

/**
 * Conditional quantile estimates: for each bin of observed values, return
 * the [5,25,50,75,95] percentile of model values that fall in that bin.
 * Inspired by openair's `conditionalQuantile`. Bins are equal-width.
 */
export function conditionalQuantile(
  pairs: ReadonlyArray<PairedObsMod>,
  numBins = 10,
): ConditionalQuantileBand[] {
  const usable = valid(pairs);
  if (usable.length === 0 || numBins < 1) return [];
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of usable) {
    if (p.obs < lo) lo = p.obs;
    if (p.obs > hi) hi = p.obs;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi === lo) return [];
  const width = (hi - lo) / numBins;
  const bins: number[][] = Array.from({ length: numBins }, () => []);
  for (const p of usable) {
    const idx = Math.min(numBins - 1, Math.floor((p.obs - lo) / width));
    bins[idx].push(p.mod);
  }
  return bins.map((vals, idx) => {
    const center = lo + (idx + 0.5) * width;
    if (vals.length === 0) {
      return { binCenter: center, q05: 0, q25: 0, q50: 0, q75: 0, q95: 0, count: 0 };
    }
    const sorted = [...vals].sort((a, b) => a - b);
    return {
      binCenter: center,
      q05: pct(sorted, 0.05),
      q25: pct(sorted, 0.25),
      q50: pct(sorted, 0.5),
      q75: pct(sorted, 0.75),
      q95: pct(sorted, 0.95),
      count: vals.length,
    };
  });
}

function pct(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = Math.min(sorted.length - 1, Math.max(0, q * (sorted.length - 1)));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
