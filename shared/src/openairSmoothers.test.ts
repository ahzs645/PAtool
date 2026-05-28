import { describe, expect, it } from "vitest";

import {
  gaussianSmooth,
  kzFilter,
  rollingMean,
  rollingQuantile,
  whittakerSmooth,
} from "./openairSmoothers";

const noisy = Array.from({ length: 64 }, (_, i) =>
  Math.sin(i / 6) * 10 + 20 + (i % 5 === 0 ? 8 : -2),
);

describe("openair smoothers", () => {
  it("rolling mean preserves length and reduces variance", () => {
    const out = rollingMean(noisy, 7);
    expect(out).toHaveLength(noisy.length);
    const rv = variance(noisy);
    const sv = variance(out);
    expect(sv).toBeLessThan(rv);
  });

  it("rolling quantile yields monotone medians under uniform sweep", () => {
    const ramp = Array.from({ length: 20 }, (_, i) => i);
    const med = rollingQuantile(ramp, 5, 0.5);
    expect(med[10]).toBeCloseTo(10, 6);
    expect(med[5]).toBeCloseTo(5, 6);
  });

  it("gaussian smoother handles nulls via interpolation", () => {
    const withGap: Array<number | null> = [1, null, null, 4, 5, 6, 7, 8];
    const out = gaussianSmooth(withGap, 2);
    expect(out).toHaveLength(8);
    expect(out.every(Number.isFinite)).toBe(true);
  });

  it("kz filter is increasingly smooth with iterations", () => {
    const k1 = kzFilter(noisy, 5, 1);
    const k3 = kzFilter(noisy, 5, 3);
    expect(variance(k3)).toBeLessThan(variance(k1));
  });

  it("whittaker recovers a low-frequency signal from noisy input", () => {
    const truth = Array.from({ length: 50 }, (_, i) => Math.sin(i / 8));
    const noise = truth.map((y, i) => y + ((i * 9301 + 49297) % 233280) / 233280 - 0.5);
    const smoothed = whittakerSmooth(noise, 50);
    const err = smoothed.reduce((s, v, i) => s + (v - truth[i]) ** 2, 0) / truth.length;
    const baseline = noise.reduce((s, v, i) => s + (v - truth[i]) ** 2, 0) / truth.length;
    expect(err).toBeLessThan(baseline);
  });
});

function variance(arr: number[]): number {
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  return arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
}
