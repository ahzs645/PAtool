/**
 * Tiny pure-TypeScript regression forest for browser-side PM2.5 modeling.
 *
 * Implements bagged regression trees with per-split feature subsampling so
 * it produces actually-trained Random-Forest predictions instead of the
 * deterministic "RFSI-lite" trend approximations the model zoo previously
 * shipped. Designed for small fitting problems (hundreds of points,
 * dozens of features) — fits in a worker call without dragging in a heavy
 * ML library.
 *
 * Limitations:
 * - No categorical splits; numeric features only.
 * - No probabilistic OOB inference for individual rows beyond the
 *   per-tree bag mask.
 * - Default hyperparameters tuned for spatial PM2.5 grids; pass
 *   `randomForestHyperparams` overrides if your problem is wildly
 *   different.
 */

export type RandomForestFitOptions = {
  numTrees?: number;
  maxDepth?: number;
  minSamplesSplit?: number;
  /** Number of features sampled at each split. Defaults to ceil(sqrt(F)). */
  mtry?: number;
  /** Bag fraction (default 1.0 — same N as input, with replacement). */
  bagFraction?: number;
  /** Optional deterministic seed; defaults to time-based. */
  seed?: number;
};

export type RandomForestModel = {
  trees: RegressionTree[];
  featureCount: number;
  hyperparameters: Required<Omit<RandomForestFitOptions, "seed">>;
};

export type RegressionTreeNode =
  | { kind: "leaf"; mean: number; count: number }
  | {
      kind: "split";
      featureIndex: number;
      threshold: number;
      left: RegressionTreeNode;
      right: RegressionTreeNode;
    };

export type RegressionTree = {
  root: RegressionTreeNode;
  /** OOB sample indices for this tree (used by `predictWithOob`). */
  oobIndices: number[];
};

export type RandomForestPrediction = {
  mean: number;
  /** Standard deviation across trees — proxy for predictive variance. */
  std: number;
  /** Optional out-of-bag mean if the prediction was OOB for some trees. */
  oobMean?: number;
  oobCount?: number;
};

const DEFAULTS: Required<Omit<RandomForestFitOptions, "seed">> = {
  numTrees: 50,
  maxDepth: 12,
  minSamplesSplit: 4,
  mtry: 0,
  bagFraction: 1.0,
};

/**
 * Train a regression random forest on `featureMatrix` with target `target`.
 * `featureMatrix` is a row-major 2D array (each row = one observation).
 */
export function fitRandomForest(
  featureMatrix: ReadonlyArray<ReadonlyArray<number>>,
  target: ReadonlyArray<number>,
  options: RandomForestFitOptions = {},
): RandomForestModel {
  if (featureMatrix.length === 0 || target.length !== featureMatrix.length) {
    throw new Error("Random forest fit: feature matrix and target must have matching, non-zero length.");
  }

  const featureCount = featureMatrix[0].length;
  const hyperparameters: Required<Omit<RandomForestFitOptions, "seed">> = {
    ...DEFAULTS,
    ...Object.fromEntries(Object.entries(options).filter(([key]) => key !== "seed")),
    mtry: options.mtry && options.mtry > 0 ? options.mtry : Math.max(1, Math.ceil(Math.sqrt(featureCount))),
  };

  const rng = mulberry32(options.seed ?? Math.floor(Math.random() * 0xffffffff));
  const n = featureMatrix.length;
  const bagSize = Math.max(1, Math.round(n * hyperparameters.bagFraction));
  const trees: RegressionTree[] = [];

  for (let t = 0; t < hyperparameters.numTrees; t += 1) {
    const inBagCounts = new Array<number>(n).fill(0);
    const sampleIndices: number[] = new Array(bagSize);
    for (let i = 0; i < bagSize; i += 1) {
      const idx = Math.floor(rng() * n);
      sampleIndices[i] = idx;
      inBagCounts[idx] += 1;
    }
    const oobIndices: number[] = [];
    for (let i = 0; i < n; i += 1) {
      if (inBagCounts[i] === 0) oobIndices.push(i);
    }
    const root = growTree(
      featureMatrix,
      target,
      sampleIndices,
      featureCount,
      hyperparameters.mtry,
      hyperparameters.maxDepth,
      hyperparameters.minSamplesSplit,
      0,
      rng,
    );
    trees.push({ root, oobIndices });
  }

  return { trees, featureCount, hyperparameters };
}

/** Single-row prediction with mean and tree-spread std. */
export function predictRandomForest(
  model: RandomForestModel,
  features: ReadonlyArray<number>,
): RandomForestPrediction {
  if (features.length !== model.featureCount) {
    throw new Error(
      `Feature length mismatch: expected ${model.featureCount}, got ${features.length}.`,
    );
  }
  const predictions = model.trees.map((tree) => predictTree(tree.root, features));
  const mean = average(predictions);
  const std = predictions.length > 1 ? sampleStdDev(predictions, mean) : 0;
  return { mean, std };
}

/** Predict for a batch; convenience for cross-validation loops. */
export function predictRandomForestBatch(
  model: RandomForestModel,
  featureMatrix: ReadonlyArray<ReadonlyArray<number>>,
): RandomForestPrediction[] {
  return featureMatrix.map((row) => predictRandomForest(model, row));
}

/**
 * Out-of-bag predictions: for each input row, average the trees that did
 * NOT include that row in their bootstrap. Returns one prediction per
 * training row; useful for quick generalization estimates without an
 * external CV loop.
 */
export function predictWithOob(
  model: RandomForestModel,
  featureMatrix: ReadonlyArray<ReadonlyArray<number>>,
): Array<{ mean: number; count: number; spread: number }> {
  const result: Array<{ mean: number; count: number; spread: number }> = [];
  for (let i = 0; i < featureMatrix.length; i += 1) {
    const treePreds: number[] = [];
    for (const tree of model.trees) {
      if (tree.oobIndices.includes(i)) {
        treePreds.push(predictTree(tree.root, featureMatrix[i]));
      }
    }
    const mean = treePreds.length === 0 ? Number.NaN : average(treePreds);
    const spread = treePreds.length > 1 ? sampleStdDev(treePreds, mean) : 0;
    result.push({ mean, count: treePreds.length, spread });
  }
  return result;
}

function growTree(
  featureMatrix: ReadonlyArray<ReadonlyArray<number>>,
  target: ReadonlyArray<number>,
  sampleIndices: number[],
  featureCount: number,
  mtry: number,
  maxDepth: number,
  minSamplesSplit: number,
  depth: number,
  rng: () => number,
): RegressionTreeNode {
  const values = sampleIndices.map((idx) => target[idx]);
  const mean = average(values);

  if (depth >= maxDepth || sampleIndices.length < minSamplesSplit || sampleVariance(values, mean) < 1e-6) {
    return { kind: "leaf", mean, count: sampleIndices.length };
  }

  const featureSubset = sampleFeatureIndices(featureCount, mtry, rng);
  let bestGain = 0;
  let bestFeature = -1;
  let bestThreshold = 0;
  let bestLeft: number[] = [];
  let bestRight: number[] = [];
  const baseImpurity = sampleVariance(values, mean) * sampleIndices.length;

  for (const feature of featureSubset) {
    const sortedIndices = [...sampleIndices].sort(
      (a, b) => featureMatrix[a][feature] - featureMatrix[b][feature],
    );
    const sortedValues = sortedIndices.map((idx) => target[idx]);

    let leftSum = 0;
    let leftSqSum = 0;
    const totalSum = sortedValues.reduce((sum, v) => sum + v, 0);
    const totalSqSum = sortedValues.reduce((sum, v) => sum + v * v, 0);

    for (let i = 0; i < sortedIndices.length - 1; i += 1) {
      leftSum += sortedValues[i];
      leftSqSum += sortedValues[i] * sortedValues[i];
      const leftCount = i + 1;
      const rightCount = sortedIndices.length - leftCount;
      if (rightCount === 0) break;

      // Skip splits where threshold is identical to the next feature value.
      const a = featureMatrix[sortedIndices[i]][feature];
      const b = featureMatrix[sortedIndices[i + 1]][feature];
      if (a === b) continue;

      const leftMean = leftSum / leftCount;
      const rightMean = (totalSum - leftSum) / rightCount;
      const leftVarianceTimesN = leftSqSum - leftSum * leftMean;
      const rightSqSum = totalSqSum - leftSqSum;
      const rightVarianceTimesN = rightSqSum - (totalSum - leftSum) * rightMean;
      const childImpurity = leftVarianceTimesN + rightVarianceTimesN;
      const gain = baseImpurity - childImpurity;

      if (gain > bestGain) {
        bestGain = gain;
        bestFeature = feature;
        bestThreshold = (a + b) / 2;
        bestLeft = sortedIndices.slice(0, leftCount);
        bestRight = sortedIndices.slice(leftCount);
      }
    }
  }

  if (bestFeature === -1 || bestLeft.length === 0 || bestRight.length === 0) {
    return { kind: "leaf", mean, count: sampleIndices.length };
  }

  return {
    kind: "split",
    featureIndex: bestFeature,
    threshold: bestThreshold,
    left: growTree(featureMatrix, target, bestLeft, featureCount, mtry, maxDepth, minSamplesSplit, depth + 1, rng),
    right: growTree(featureMatrix, target, bestRight, featureCount, mtry, maxDepth, minSamplesSplit, depth + 1, rng),
  };
}

function predictTree(node: RegressionTreeNode, features: ReadonlyArray<number>): number {
  let current = node;
  while (current.kind === "split") {
    current = features[current.featureIndex] <= current.threshold ? current.left : current.right;
  }
  return current.mean;
}

function sampleFeatureIndices(featureCount: number, count: number, rng: () => number): number[] {
  const all = Array.from({ length: featureCount }, (_, i) => i);
  for (let i = featureCount - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, Math.min(count, featureCount));
}

function average(values: ReadonlyArray<number>): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

function sampleVariance(values: ReadonlyArray<number>, mean: number): number {
  if (values.length < 2) return 0;
  let sq = 0;
  for (const value of values) sq += (value - mean) * (value - mean);
  return sq / (values.length - 1);
}

function sampleStdDev(values: ReadonlyArray<number>, mean: number): number {
  return Math.sqrt(sampleVariance(values, mean));
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
