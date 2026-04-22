// ---------------------------------------------------------------------------
// Sum-metric space-time ordinary kriging
//
// Variogram form (Gneiting-style sum-metric):
//
//   gamma(h, u) = gamma_s(h) + gamma_t(u) + gamma_joint(sqrt(h^2 + (kappa*u)^2))
//
// where h is spatial distance in km, u is time distance in days, and kappa
// is the space-time anisotropy factor (km / day).
//
// Marginal (spatial, temporal) variograms are fit from pairs with small lag in
// the other dimension; the joint term is fit by grid-searching kappa and
// picking the one that best explains residuals not captured by the marginals.
// ---------------------------------------------------------------------------

const EARTH_RADIUS_KM = 6371;
const MS_PER_DAY = 86_400_000;

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

export function haversineKm(ax: number, ay: number, bx: number, by: number): number {
  const lat1 = toRadians(ay);
  const lat2 = toRadians(by);
  const deltaLon = toRadians(bx - ax);
  const deltaLat = lat2 - lat1;
  const x = deltaLon * Math.cos((lat1 + lat2) / 2);
  return Math.sqrt(x * x + deltaLat * deltaLat) * EARTH_RADIUS_KM;
}

export type SpaceTimeObservation = {
  id?: string;
  x: number; // longitude
  y: number; // latitude
  t: number; // ms since epoch
  value: number;
};

export type VariogramParameters = {
  nugget: number;
  sill: number;
  range: number;
};

export type SpaceTimeVariogramModel = {
  spatial: VariogramParameters;
  temporal: VariogramParameters;
  joint: VariogramParameters;
  kappa: number; // km per day
};

export type SpaceTimeKrigingModel = {
  observations: SpaceTimeObservation[];
  variogram: SpaceTimeVariogramModel;
};

export type SpaceTimeFitOptions = {
  maxSpaceKm?: number;
  maxTimeDays?: number;
  spaceBinCount?: number;
  timeBinCount?: number;
  zeroSpaceThresholdKm?: number;
  zeroTimeThresholdDays?: number;
  kappaCandidates?: number[];
};

export type SpaceTimeQuery = {
  id?: string;
  x: number;
  y: number;
  t: number;
};

export type SpaceTimeEstimate = {
  id?: string;
  x: number;
  y: number;
  t: number;
  value: number | null;
  variance: number | null;
  neighborCount: number;
  source: "exact" | "kriging" | "nearest" | "none";
};

// -- Internal helpers -----------------------------------------------------

function sphericalVariogram(h: number, nugget: number, sill: number, range: number): number {
  if (h <= 0) return 0;
  if (h >= range) return nugget + sill;
  const hr = h / range;
  return nugget + sill * (1.5 * hr - 0.5 * hr * hr * hr);
}

type LagBin = { lag: number; gamma: number; count: number };

function binLags(
  entries: Array<{ lag: number; semivariance: number }>,
  binCount: number,
  maxLag: number,
): LagBin[] {
  if (entries.length === 0 || binCount < 1 || maxLag <= 0) return [];
  const bins: LagBin[] = [];
  for (let i = 0; i < binCount; i++) {
    bins.push({ lag: 0, gamma: 0, count: 0 });
  }
  const binWidth = maxLag / binCount;
  for (const entry of entries) {
    if (entry.lag <= 0 || entry.lag > maxLag) continue;
    let idx = Math.floor(entry.lag / binWidth);
    if (idx >= binCount) idx = binCount - 1;
    const b = bins[idx];
    b.lag += entry.lag;
    b.gamma += entry.semivariance;
    b.count += 1;
  }
  const nonEmpty: LagBin[] = [];
  for (let i = 0; i < binCount; i++) {
    const b = bins[i];
    if (b.count > 0) {
      nonEmpty.push({ lag: b.lag / b.count, gamma: b.gamma / b.count, count: b.count });
    }
  }
  return nonEmpty;
}

function fitSphericalVariogram(bins: LagBin[]): VariogramParameters {
  if (bins.length === 0) return { nugget: 0, sill: 0, range: 1 };
  const sorted = [...bins].sort((a, b) => a.lag - b.lag);
  const firstGamma = sorted.find((b) => b.gamma > 0)?.gamma ?? 0;
  const maxGamma = Math.max(...sorted.map((b) => b.gamma), 1e-6);
  const upperTail = sorted.slice(Math.max(0, Math.floor(sorted.length * 0.6)));
  const upperTailMean = upperTail.reduce((s, b) => s + b.gamma, 0) / Math.max(upperTail.length, 1);
  const totalSillCandidates = Array.from(
    new Set([maxGamma, upperTailMean, Math.max(maxGamma * 0.9, firstGamma)]
      .filter((v) => v > 0)
      .map((v) => Number(v.toFixed(6)))),
  );
  const nuggetCandidates = Array.from(
    new Set([0, firstGamma * 0.25, firstGamma * 0.5]
      .map((v) => Number(Math.max(0, v).toFixed(6)))),
  );
  let best: VariogramParameters = {
    nugget: 0,
    sill: Math.max(maxGamma, 1e-6),
    range: Math.max(sorted[sorted.length - 1]?.lag ?? 1, 1e-3),
  };
  let bestScore = Infinity;
  for (const totalSill of totalSillCandidates) {
    for (const nugget of nuggetCandidates) {
      const partialSill = Math.max(totalSill - nugget, 1e-6);
      for (const candidate of sorted) {
        const range = Math.max(candidate.lag, 1e-3);
        let score = 0;
        for (const entry of sorted) {
          const modeled = sphericalVariogram(entry.lag, nugget, partialSill, range);
          const residual = entry.gamma - modeled;
          const weight = entry.count / Math.max(entry.lag * entry.lag, 1);
          score += weight * residual * residual;
        }
        if (score < bestScore) {
          bestScore = score;
          best = { nugget, sill: partialSill, range };
        }
      }
    }
  }
  return best;
}

function solveAugmentedLinearSystem(
  aug: Float64Array,
  n: number,
  stride: number,
  solution: Float64Array,
): boolean {
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    let maxVal = Math.abs(aug[col * stride + col]);
    for (let row = col + 1; row < n; row++) {
      const value = Math.abs(aug[row * stride + col]);
      if (value > maxVal) {
        maxVal = value;
        maxRow = row;
      }
    }
    let rowScale = 0;
    const maxRowOffset = maxRow * stride;
    for (let j = 0; j < n; j++) rowScale += Math.abs(aug[maxRowOffset + j]);
    if (maxVal <= Math.max(1e-12, rowScale * 1e-10)) return false;

    if (maxRow !== col) {
      const colOffset = col * stride;
      for (let j = col; j <= n; j++) {
        const tmp = aug[colOffset + j];
        aug[colOffset + j] = aug[maxRowOffset + j];
        aug[maxRowOffset + j] = tmp;
      }
    }

    const pivotOffset = col * stride;
    const pivot = aug[pivotOffset + col];
    for (let row = col + 1; row < n; row++) {
      const rowOffset = row * stride;
      const factor = aug[rowOffset + col] / pivot;
      aug[rowOffset + col] = 0;
      for (let j = col + 1; j <= n; j++) {
        aug[rowOffset + j] -= factor * aug[pivotOffset + j];
      }
    }
  }

  for (let row = n - 1; row >= 0; row--) {
    const rowOffset = row * stride;
    let sum = aug[rowOffset + n];
    for (let j = row + 1; j < n; j++) sum -= aug[rowOffset + j] * solution[j];
    solution[row] = sum / aug[rowOffset + row];
  }
  return true;
}

// -- Fitting --------------------------------------------------------------

export function sumMetricVariogramValue(
  h: number,
  u: number,
  model: SpaceTimeVariogramModel,
): number {
  const gs = sphericalVariogram(h, model.spatial.nugget, model.spatial.sill, model.spatial.range);
  const gt = sphericalVariogram(u, model.temporal.nugget, model.temporal.sill, model.temporal.range);
  const d = Math.sqrt(h * h + (model.kappa * u) * (model.kappa * u));
  const gj = sphericalVariogram(d, model.joint.nugget, model.joint.sill, model.joint.range);
  return gs + gt + gj;
}

export function fitSumMetricSpaceTimeVariogram(
  observations: SpaceTimeObservation[],
  options: SpaceTimeFitOptions = {},
): SpaceTimeVariogramModel {
  if (observations.length < 4) {
    return {
      spatial: { nugget: 0, sill: 0, range: 1 },
      temporal: { nugget: 0, sill: 0, range: 1 },
      joint: { nugget: 0, sill: 0, range: 1 },
      kappa: 1,
    };
  }

  // Precompute all pairwise (h_km, u_days, semivariance).
  const n = observations.length;
  let maxH = 0;
  let maxU = 0;
  const pairs: Array<{ h: number; u: number; sv: number }> = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = observations[i];
      const b = observations[j];
      const h = haversineKm(a.x, a.y, b.x, b.y);
      const u = Math.abs(a.t - b.t) / MS_PER_DAY;
      const diff = a.value - b.value;
      const sv = 0.5 * diff * diff;
      pairs.push({ h, u, sv });
      if (h > maxH) maxH = h;
      if (u > maxU) maxU = u;
    }
  }

  const maxSpaceKm = options.maxSpaceKm ?? maxH / 2;
  const maxTimeDays = options.maxTimeDays ?? maxU / 2;
  const zeroSpaceThresholdKm = options.zeroSpaceThresholdKm ?? Math.max(maxH * 0.02, 0.5);
  const zeroTimeThresholdDays = options.zeroTimeThresholdDays ?? Math.max(maxU * 0.02, 0.25);
  const spaceBinCount = options.spaceBinCount ?? 12;
  const timeBinCount = options.timeBinCount ?? 10;
  const kappaCandidates = options.kappaCandidates ?? [0.1, 0.5, 1, 2, 5, 10, 20, 50];

  // Marginal spatial variogram from pairs with small u.
  const spatialEntries: Array<{ lag: number; semivariance: number }> = [];
  for (const p of pairs) {
    if (p.u <= zeroTimeThresholdDays && p.h <= maxSpaceKm) {
      spatialEntries.push({ lag: p.h, semivariance: p.sv });
    }
  }
  const spatialBins = binLags(spatialEntries, spaceBinCount, maxSpaceKm);
  const spatial = fitSphericalVariogram(spatialBins);

  // Marginal temporal variogram from pairs with small h.
  const temporalEntries: Array<{ lag: number; semivariance: number }> = [];
  for (const p of pairs) {
    if (p.h <= zeroSpaceThresholdKm && p.u <= maxTimeDays) {
      temporalEntries.push({ lag: p.u, semivariance: p.sv });
    }
  }
  const temporalBins = binLags(temporalEntries, timeBinCount, maxTimeDays);
  const temporal = fitSphericalVariogram(temporalBins);

  // Joint residual variogram by kappa grid search.
  let bestKappa = kappaCandidates[0];
  let bestJoint: VariogramParameters = { nugget: 0, sill: 0, range: 1 };
  let bestScore = Infinity;
  for (const kappa of kappaCandidates) {
    const jointEntries: Array<{ lag: number; semivariance: number }> = [];
    for (const p of pairs) {
      const gsPred = sphericalVariogram(p.h, spatial.nugget, spatial.sill, spatial.range);
      const gtPred = sphericalVariogram(p.u, temporal.nugget, temporal.sill, temporal.range);
      const residual = p.sv - gsPred - gtPred;
      if (!Number.isFinite(residual)) continue;
      const d = Math.sqrt(p.h * p.h + (kappa * p.u) * (kappa * p.u));
      jointEntries.push({ lag: d, semivariance: Math.max(0, residual) });
    }
    if (jointEntries.length < 3) continue;
    const maxD = Math.max(...jointEntries.map((e) => e.lag), 1e-3);
    const jointBins = binLags(jointEntries, spaceBinCount, maxD);
    const candidate = fitSphericalVariogram(jointBins);

    // Score: weighted SSE of the full model over all pairs.
    let score = 0;
    for (const p of pairs) {
      const d = Math.sqrt(p.h * p.h + (kappa * p.u) * (kappa * p.u));
      const predicted =
        sphericalVariogram(p.h, spatial.nugget, spatial.sill, spatial.range)
        + sphericalVariogram(p.u, temporal.nugget, temporal.sill, temporal.range)
        + sphericalVariogram(d, candidate.nugget, candidate.sill, candidate.range);
      const residual = p.sv - predicted;
      score += residual * residual;
    }

    if (score < bestScore) {
      bestScore = score;
      bestKappa = kappa;
      bestJoint = candidate;
    }
  }

  return {
    spatial,
    temporal,
    joint: bestJoint,
    kappa: bestKappa,
  };
}

export function createSpaceTimeKrigingModel(
  observations: SpaceTimeObservation[],
  options: SpaceTimeFitOptions = {},
): SpaceTimeKrigingModel {
  return {
    observations: observations.slice(),
    variogram: fitSumMetricSpaceTimeVariogram(observations, options),
  };
}

// -- Estimation -----------------------------------------------------------

export type SpaceTimeEstimateOptions = {
  maxNeighbors?: number;
  maxDistanceKm?: number;
  maxDaysBack?: number;
  maxDaysForward?: number;
};

export function spaceTimeKrigingEstimate(
  model: SpaceTimeKrigingModel,
  queries: SpaceTimeQuery[],
  options: SpaceTimeEstimateOptions = {},
): SpaceTimeEstimate[] {
  const obs = model.observations;
  const out: SpaceTimeEstimate[] = [];
  if (obs.length === 0) {
    return queries.map((q) => ({
      id: q.id,
      x: q.x, y: q.y, t: q.t,
      value: null, variance: null,
      neighborCount: 0, source: "none",
    }));
  }

  const maxNeighbors = options.maxNeighbors ?? 12;
  const maxDistanceKm = options.maxDistanceKm ?? 500;
  const maxDaysBack = options.maxDaysBack ?? 90;
  const maxDaysForward = options.maxDaysForward ?? 90;

  for (const q of queries) {
    // Rank observations by their variogram distance to the query (smaller = closer).
    const candidates: Array<{ idx: number; h: number; u: number; gq: number }> = [];
    let exactIdx = -1;
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      const h = haversineKm(q.x, q.y, o.x, o.y);
      const uSignedDays = (q.t - o.t) / MS_PER_DAY;
      if (uSignedDays > maxDaysBack) continue;
      if (-uSignedDays > maxDaysForward) continue;
      if (h > maxDistanceKm) continue;
      const u = Math.abs(uSignedDays);
      if (h < 1e-6 && u < 1e-6) {
        exactIdx = i;
        break;
      }
      const gq = sumMetricVariogramValue(h, u, model.variogram);
      candidates.push({ idx: i, h, u, gq });
    }

    if (exactIdx >= 0) {
      out.push({
        id: q.id,
        x: q.x, y: q.y, t: q.t,
        value: obs[exactIdx].value,
        variance: 0,
        neighborCount: 1,
        source: "exact",
      });
      continue;
    }

    if (candidates.length === 0) {
      out.push({
        id: q.id,
        x: q.x, y: q.y, t: q.t,
        value: null, variance: null,
        neighborCount: 0, source: "none",
      });
      continue;
    }

    candidates.sort((a, b) => a.gq - b.gq);
    const selected = candidates.slice(0, Math.max(1, Math.min(maxNeighbors, candidates.length)));

    if (selected.length < 2) {
      out.push({
        id: q.id,
        x: q.x, y: q.y, t: q.t,
        value: obs[selected[0].idx].value,
        variance: null,
        neighborCount: 1,
        source: "nearest",
      });
      continue;
    }

    // Build and solve ordinary kriging system with Lagrange multiplier.
    const nn = selected.length;
    const size = nn + 1;
    const stride = size + 1;
    const aug = new Float64Array(size * stride);
    const weights = new Float64Array(size);
    const vg = model.variogram;
    const totalSill = vg.spatial.sill + vg.temporal.sill + vg.joint.sill
      + vg.spatial.nugget + vg.temporal.nugget + vg.joint.nugget;
    const diagonalJitter = Math.max(totalSill * 1e-6, 1e-8);

    for (let i = 0; i < nn; i++) {
      const a = obs[selected[i].idx];
      for (let j = 0; j < nn; j++) {
        if (i === j) {
          aug[i * stride + j] = diagonalJitter;
          continue;
        }
        const b = obs[selected[j].idx];
        const h = haversineKm(a.x, a.y, b.x, b.y);
        const u = Math.abs(a.t - b.t) / MS_PER_DAY;
        aug[i * stride + j] = sumMetricVariogramValue(h, u, model.variogram);
      }
      aug[i * stride + nn] = 1; // Lagrange column
      aug[i * stride + size] = selected[i].gq; // RHS: variogram to query
    }
    const lagrangeRowOffset = nn * stride;
    for (let j = 0; j < nn; j++) aug[lagrangeRowOffset + j] = 1;
    aug[lagrangeRowOffset + nn] = 0;
    aug[lagrangeRowOffset + size] = 1;

    const solved = solveAugmentedLinearSystem(aug, size, stride, weights);

    if (!solved) {
      // Fallback: inverse-of-variogram weighting.
      let wSum = 0;
      let vSum = 0;
      for (const s of selected) {
        const w = s.gq > 0 ? 1 / s.gq : 1;
        wSum += w;
        vSum += w * obs[s.idx].value;
      }
      out.push({
        id: q.id,
        x: q.x, y: q.y, t: q.t,
        value: wSum > 0 ? vSum / wSum : null,
        variance: null,
        neighborCount: nn,
        source: "kriging",
      });
      continue;
    }

    let value = 0;
    let variance = weights[nn]; // Lagrange multiplier contribution to variance
    for (let i = 0; i < nn; i++) {
      value += weights[i] * obs[selected[i].idx].value;
      variance += weights[i] * selected[i].gq;
    }

    out.push({
      id: q.id,
      x: q.x, y: q.y, t: q.t,
      value: Number.isFinite(value) ? value : null,
      variance: Number.isFinite(variance) ? Math.max(0, variance) : null,
      neighborCount: nn,
      source: "kriging",
    });
  }

  return out;
}
