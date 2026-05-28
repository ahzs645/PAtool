import { describe, expect, it } from "vitest";

import { DEFAULT_RH_BINS, stratifyByHumidity, stratifyByTemperature } from "./climateStratified";

describe("climate-stratified evaluation", () => {
  it("places observations in the right temperature bin", () => {
    const data = [
      { obs: 10, mod: 11, temperature: 5 },
      { obs: 20, mod: 22, temperature: 15 },
      { obs: 30, mod: 35, temperature: 25 },
      { obs: 40, mod: 48, temperature: 35 },
    ];
    const out = stratifyByTemperature(data);
    expect(out.rows).toHaveLength(4);
    expect(out.rows.every((r) => r.stats.n === 1)).toBe(true);
  });

  it("computes per-bin shares that sum to 1", () => {
    const data = [
      { obs: 1, mod: 2, humidity: 10 },
      { obs: 1, mod: 2, humidity: 35 },
      { obs: 1, mod: 2, humidity: 80 },
    ];
    const out = stratifyByHumidity(data, DEFAULT_RH_BINS);
    const sumShare = out.rows.reduce((s, r) => s + r.share, 0);
    expect(sumShare).toBeCloseTo(1, 6);
  });
});
