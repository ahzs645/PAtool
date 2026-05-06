import {
  applyPurpleAirCorrection,
  PURPLEAIR_CORRECTION_PROFILES,
  type PurpleAirCorrectionProfileId,
  type PurpleAirInputBasis,
} from "./domain";
import type { Pm25Regime } from "./regimeSeparation";

export type CorrectionBenchmarkObservation = {
  id?: string;
  timestamp?: string;
  pm25: number | null;
  humidity?: number | null;
  inputBasis: PurpleAirInputBasis;
  referencePm25: number | null;
  regime?: Pm25Regime;
};

export type CorrectionBenchmarkMetrics = {
  n: number;
  rmse: number | null;
  mae: number | null;
  bias: number | null;
  rSquared: number | null;
};

export type CorrectionBenchmarkRow = CorrectionBenchmarkMetrics & {
  profileId: PurpleAirCorrectionProfileId | "local-linear";
  label: string;
  regime: Pm25Regime | "all";
};

export type CorrectionBenchmarkOptions = {
  profileIds?: PurpleAirCorrectionProfileId[];
  groupByRegime?: boolean;
};

export type LocalCorrectionModel = {
  coefficients: {
    intercept: number;
    pm25: number;
    humidity: number;
    wildfire: number;
  };
  inputBasis: PurpleAirInputBasis;
  n: number;
  metrics: CorrectionBenchmarkMetrics;
};

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function round(value: number, digits = 4): number {
  return Number(value.toFixed(digits));
}

function metrics(pairs: Array<{ observed: number; predicted: number }>): CorrectionBenchmarkMetrics {
  if (pairs.length === 0) return { n: 0, rmse: null, mae: null, bias: null, rSquared: null };
  const meanObserved = pairs.reduce((sum, pair) => sum + pair.observed, 0) / pairs.length;
  let squareError = 0;
  let absoluteError = 0;
  let bias = 0;
  let totalSquares = 0;
  for (const pair of pairs) {
    const error = pair.predicted - pair.observed;
    squareError += error * error;
    absoluteError += Math.abs(error);
    bias += error;
    totalSquares += (pair.observed - meanObserved) ** 2;
  }
  return {
    n: pairs.length,
    rmse: round(Math.sqrt(squareError / pairs.length)),
    mae: round(absoluteError / pairs.length),
    bias: round(bias / pairs.length),
    rSquared: totalSquares > 0 ? round(1 - squareError / totalSquares) : null,
  };
}

function groupsFor(
  observations: CorrectionBenchmarkObservation[],
  groupByRegime: boolean,
): Array<{ regime: Pm25Regime | "all"; observations: CorrectionBenchmarkObservation[] }> {
  if (!groupByRegime) return [{ regime: "all", observations }];
  const regimes = new Set<Pm25Regime>();
  for (const observation of observations) {
    if (observation.regime) regimes.add(observation.regime);
  }
  return [
    { regime: "all", observations },
    ...[...regimes].sort().map((regime) => ({
      regime,
      observations: observations.filter((observation) => observation.regime === regime),
    })),
  ];
}

export function evaluateCorrectionBenchmarks(
  observations: CorrectionBenchmarkObservation[],
  options: CorrectionBenchmarkOptions = {},
): CorrectionBenchmarkRow[] {
  const profileIds = options.profileIds ?? Object.keys(PURPLEAIR_CORRECTION_PROFILES) as PurpleAirCorrectionProfileId[];
  const rows: CorrectionBenchmarkRow[] = [];
  for (const profileId of profileIds) {
    const profile = PURPLEAIR_CORRECTION_PROFILES[profileId];
    for (const group of groupsFor(observations, options.groupByRegime ?? true)) {
      const pairs: Array<{ observed: number; predicted: number }> = [];
      for (const observation of group.observations) {
        if (!finiteNumber(observation.pm25) || !finiteNumber(observation.referencePm25)) continue;
        if (observation.inputBasis !== profile.inputBasis) continue;
        const corrected = applyPurpleAirCorrection({
          pm25: observation.pm25,
          humidity: observation.humidity,
          inputBasis: observation.inputBasis,
          profileId,
        });
        if (!corrected) continue;
        pairs.push({ observed: observation.referencePm25, predicted: corrected.pm25Corrected });
      }
      rows.push({
        profileId,
        label: profile.label,
        regime: group.regime,
        ...metrics(pairs),
      });
    }
  }
  return rows;
}

function solveLinearSystem(matrix: number[][], vector: number[]): number[] | null {
  const n = vector.length;
  const aug = matrix.map((row, i) => [...row, vector[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[pivot][col])) pivot = row;
    }
    if (Math.abs(aug[pivot][col]) < 1e-10) return null;
    if (pivot !== col) [aug[pivot], aug[col]] = [aug[col], aug[pivot]];
    const pivotValue = aug[col][col];
    for (let j = col; j <= n; j += 1) aug[col][j] /= pivotValue;
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = aug[row][col];
      for (let j = col; j <= n; j += 1) aug[row][j] -= factor * aug[col][j];
    }
  }
  return aug.map((row) => row[n]);
}

export function fitLocalCorrectionModel(
  observations: CorrectionBenchmarkObservation[],
  inputBasis: PurpleAirInputBasis,
): LocalCorrectionModel | null {
  const usable = observations.filter(
    (observation) =>
      observation.inputBasis === inputBasis &&
      finiteNumber(observation.pm25) &&
      finiteNumber(observation.referencePm25),
  );
  if (usable.length < 4) return null;

  const xtx = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => 0));
  const xty = Array.from({ length: 4 }, () => 0);
  for (const observation of usable) {
    const features = [
      1,
      observation.pm25!,
      finiteNumber(observation.humidity) ? observation.humidity : 0,
      observation.regime === "wildfire" || observation.regime === "mixed" ? 1 : 0,
    ];
    for (let i = 0; i < features.length; i += 1) {
      xty[i] += features[i] * observation.referencePm25!;
      for (let j = 0; j < features.length; j += 1) {
        xtx[i][j] += features[i] * features[j];
      }
    }
  }

  const beta = solveLinearSystem(xtx, xty);
  if (!beta) return null;
  const model: LocalCorrectionModel = {
    coefficients: {
      intercept: round(beta[0]),
      pm25: round(beta[1]),
      humidity: round(beta[2]),
      wildfire: round(beta[3]),
    },
    inputBasis,
    n: usable.length,
    metrics: { n: 0, rmse: null, mae: null, bias: null, rSquared: null },
  };
  const pairs = usable.map((observation) => ({
    observed: observation.referencePm25!,
    predicted: predictLocalCorrection(model, observation),
  }));
  return { ...model, metrics: metrics(pairs) };
}

export function predictLocalCorrection(
  model: LocalCorrectionModel,
  observation: Pick<CorrectionBenchmarkObservation, "pm25" | "humidity" | "regime">,
): number {
  const pm25 = finiteNumber(observation.pm25) ? observation.pm25 : 0;
  const humidity = finiteNumber(observation.humidity) ? observation.humidity : 0;
  const wildfire = observation.regime === "wildfire" || observation.regime === "mixed" ? 1 : 0;
  return round(
    model.coefficients.intercept
    + model.coefficients.pm25 * pm25
    + model.coefficients.humidity * humidity
    + model.coefficients.wildfire * wildfire,
  );
}
