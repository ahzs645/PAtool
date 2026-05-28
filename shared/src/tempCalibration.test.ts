import { describe, expect, it } from "vitest";

import { fitTempCalibration } from "./tempCalibration";

describe("temperature-corrected calibration", () => {
  it("recovers a known linear relationship", () => {
    const truth = (x: number, t: number) => 2 + 1.5 * x - 0.1 * t;
    const rows = Array.from({ length: 50 }, (_, i) => {
      const x = i;
      const t = 20 + (i % 10);
      return { sensor: x, temperature: t, reference: truth(x, t) };
    });
    const fit = fitTempCalibration(rows, "linear");
    expect(fit.r2).toBeCloseTo(1, 4);
    expect(fit.predict(10, 25)).toBeCloseTo(truth(10, 25), 4);
  });

  it("quadratic fit improves on cross-term data", () => {
    const truth = (x: number, t: number) => x * x * 0.05 + t * 0.2 + x * t * 0.01;
    const rows: { sensor: number; temperature: number; reference: number }[] = [];
    for (let x = 0; x < 30; x += 1) for (let t = 10; t < 30; t += 2) {
      rows.push({ sensor: x, temperature: t, reference: truth(x, t) });
    }
    const linear = fitTempCalibration(rows, "linear");
    const quad = fitTempCalibration(rows, "quadratic");
    expect(quad.rmse).toBeLessThan(linear.rmse);
  });

  it("returns empty fit gracefully with no data", () => {
    const fit = fitTempCalibration([], "linear");
    expect(fit.r2).toBe(0);
    expect(fit.coefficients.length).toBe(3);
  });
});
