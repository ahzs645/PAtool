import { describe, expect, it } from "vitest";

import {
  fitRandomForest,
  predictRandomForest,
  predictRandomForestBatch,
  predictWithOob,
} from "./randomForest";

function syntheticRegression(n: number, seed: number) {
  const rng = mulberry32(seed);
  const features: number[][] = [];
  const target: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const x = rng() * 2 - 1;
    const y = rng() * 2 - 1;
    const f = 3 * x - 2 * y + Math.sin(x * 4) + 0.05 * (rng() - 0.5);
    features.push([x, y]);
    target.push(f);
  }
  return { features, target };
}

describe("regression random forest", () => {
  it("fits the structure of a synthetic non-linear regression", () => {
    const { features, target } = syntheticRegression(200, 11);
    const model = fitRandomForest(features, target, { numTrees: 30, seed: 7 });
    const predictions = predictRandomForestBatch(model, features.slice(0, 50));
    const errors = predictions.map((prediction, i) => Math.abs(prediction.mean - target[i]));
    const meanError = errors.reduce((sum, value) => sum + value, 0) / errors.length;
    expect(meanError).toBeLessThan(1);
    expect(predictions.every((prediction) => prediction.std >= 0)).toBe(true);
  });

  it("OOB predictions are present for most rows when bagFraction = 1", () => {
    const { features, target } = syntheticRegression(80, 22);
    const model = fitRandomForest(features, target, { numTrees: 30, seed: 9 });
    const oob = predictWithOob(model, features);
    const covered = oob.filter((row) => row.count > 0).length;
    expect(covered).toBeGreaterThan(features.length * 0.6);
  });

  it("respects feature-count contracts", () => {
    const { features, target } = syntheticRegression(40, 33);
    const model = fitRandomForest(features, target, { numTrees: 5, seed: 1 });
    expect(() => predictRandomForest(model, [0])).toThrow(/Feature length mismatch/);
  });
});

function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
