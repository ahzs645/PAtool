import { describe, expect, it } from "vitest";

import { fitAdditiveGam, type GamRecord } from "./gamCalibration";

describe("fitAdditiveGam", () => {
  it("returns the empty model when no records are usable", () => {
    const fit = fitAdditiveGam([], [{ name: "temp" }]);
    expect(fit.intercept).toBe(0);
    expect(fit.terms).toEqual([]);
    expect(fit.predict({ temp: 20 })).toBe(0);
  });

  it("recovers a near-linear smooth on a single covariate", () => {
    const records: GamRecord[] = Array.from({ length: 80 }, (_, i) => ({
      response: i * 0.5 + (i % 7 === 0 ? 0.4 : -0.4),
      covariates: { temp: i },
    }));
    const fit = fitAdditiveGam(records, [{ name: "temp", knots: 5 }]);
    const inSampleResiduals = records.map((row) => fit.predict(row.covariates) - row.response);
    const meanAbsRes = inSampleResiduals.reduce((sum, r) => sum + Math.abs(r), 0) / records.length;
    expect(meanAbsRes).toBeLessThan(0.6);
  });

  it("handles additive contributions from two covariates", () => {
    const records: GamRecord[] = [];
    for (let i = 0; i < 80; i += 1) {
      const t = i;
      const rh = (i * 0.7) % 100;
      records.push({
        response: 0.3 * t + 0.2 * rh + (i % 5 === 0 ? 0.5 : -0.5),
        covariates: { temp: t, rh },
      });
    }
    const fit = fitAdditiveGam(records, [
      { name: "temp", knots: 5 },
      { name: "rh",   knots: 5 },
    ]);
    expect(fit.terms.map((term) => term.name)).toEqual(["temp", "rh"]);
    expect(fit.predict({ temp: 40, rh: 50 })).toBeGreaterThan(0);
  });
});
