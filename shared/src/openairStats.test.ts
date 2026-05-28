import { describe, expect, it } from "vitest";

import { conditionalQuantile, modStats, taylorDiagram } from "./openairStats";

describe("modStats", () => {
  it("perfect agreement yields IOA=1, COE=1, r=1, RMSE=0", () => {
    const stats = modStats([
      { obs: 1, mod: 1 }, { obs: 2, mod: 2 }, { obs: 3, mod: 3 }, { obs: 4, mod: 4 },
    ]);
    expect(stats.n).toBe(4);
    expect(stats.r).toBeCloseTo(1, 6);
    expect(stats.IOA).toBeCloseTo(1, 6);
    expect(stats.COE).toBeCloseTo(1, 6);
    expect(stats.RMSE).toBeCloseTo(0, 6);
  });

  it("FAC2 counts pairs within factor of two", () => {
    const stats = modStats([
      { obs: 10, mod: 11 }, { obs: 10, mod: 25 }, { obs: 10, mod: 4 },
    ]);
    expect(stats.FAC2).toBeCloseTo(1 / 3, 6);
  });
});

describe("taylorDiagram", () => {
  it("places a perfect mimic at the reference SD with r=1", () => {
    const ref = [1, 2, 3, 4, 5];
    const td = taylorDiagram(ref, [
      { label: "perfect", values: ref },
      { label: "noisy", values: [1.5, 2.5, 3.5, 4.5, 5.5] },
    ]);
    expect(td.sdRef).toBeGreaterThan(0);
    expect(td.points[0].r).toBeCloseTo(1, 6);
    expect(td.points[0].sdMod).toBeCloseTo(td.sdRef, 6);
    expect(td.points[1].r).toBeCloseTo(1, 6);
  });
});

describe("conditionalQuantile", () => {
  it("yields ascending medians under linear data", () => {
    const pairs = Array.from({ length: 100 }, (_, i) => ({ obs: i, mod: i + 1 }));
    const bands = conditionalQuantile(pairs, 5);
    expect(bands).toHaveLength(5);
    for (let i = 1; i < bands.length; i += 1) {
      expect(bands[i].q50).toBeGreaterThanOrEqual(bands[i - 1].q50);
    }
  });
});
