import { describe, expect, it } from "vitest";

import { developCorrection, exportCorrection, type CorrectionInputRow } from "./asnatCorrections";

function rows(n: number, make: (i: number) => CorrectionInputRow): CorrectionInputRow[] {
  return Array.from({ length: n }, (_, i) => make(i));
}

describe("ASNAT correction development", () => {
  it("recovers a single-variable linear model", () => {
    const result = developCorrection(
      rows(25, (i) => ({ x: i, y: 2 + 3 * i })),
      { form: "single", order: "linear" },
    );
    expect(result.coefficients[0]).toBeCloseTo(2, 3);
    expect(result.coefficients[1]).toBeCloseTo(3, 3);
    expect(result.r2).toBeCloseTo(1, 6);
    expect(result.canGenerateCoefficients).toBe(true);
    expect(result.equation).toContain("x");
  });

  it("recovers a multivariable additive model", () => {
    const result = developCorrection(
      rows(30, (i) => ({ x: i, z: (i * 7) % 13, y: 1 + 2 * i + 0.5 * ((i * 7) % 13) })),
      { form: "additive", order: "linear", useThirdVariable: true },
    );
    expect(result.usedThirdVariable).toBe(true);
    expect(result.terms).toEqual(["1", "x", "z"]);
    expect(result.coefficients[0]).toBeCloseTo(1, 2);
    expect(result.coefficients[1]).toBeCloseTo(2, 2);
    expect(result.coefficients[2]).toBeCloseTo(0.5, 2);
  });

  it("recovers a multivariable interactive model with a cross term", () => {
    const result = developCorrection(
      rows(30, (i) => {
        const z = (i * 3) % 7 + 1;
        return { x: i, z, y: 1 + 2 * i + 0.5 * z + 0.1 * i * z };
      }),
      { form: "interactive", order: "linear", useThirdVariable: true },
    );
    expect(result.terms).toEqual(["1", "x", "z", "x*z"]);
    expect(result.coefficients[3]).toBeCloseTo(0.1, 2);
    expect(result.r2).toBeCloseTo(1, 5);
  });

  it("drops the third variable when it is < 50% complete", () => {
    const result = developCorrection(
      rows(20, (i) => ({ x: i, z: i < 5 ? i : null, y: 2 + 3 * i })),
      { form: "additive", order: "linear", useThirdVariable: true },
    );
    expect(result.usedThirdVariable).toBe(false);
    expect(result.form).toBe("single");
    expect(result.gates.find((g) => g.id === "completeness-z")?.pass).toBe(false);
  });

  it("allows R2 but not coefficient generation below the sample thresholds", () => {
    const result = developCorrection(
      rows(10, (i) => ({ x: i, y: 2 + 3 * i })),
      { form: "single", order: "linear" },
    );
    expect(result.canComputeR2).toBe(true); // >= 2 rows
    expect(result.canGenerateCoefficients).toBe(false); // < 20 rows
  });

  it("enforces quadratic/cubic coefficient minimums", () => {
    const quad = developCorrection(rows(25, (i) => ({ x: i, y: i * i })), { form: "single", order: "quadratic" });
    expect(quad.canGenerateCoefficients).toBe(false); // needs >= 30
    const cubic = developCorrection(rows(35, (i) => ({ x: i, y: i ** 3 })), { form: "single", order: "cubic" });
    expect(cubic.canGenerateCoefficients).toBe(false); // needs >= 40
  });

  it("excludes flagged rows", () => {
    const result = developCorrection(
      rows(25, (i) => ({ x: i, y: 2 + 3 * i, flag: i < 3 ? "85" : "0" })),
      { form: "single", order: "linear" },
    );
    expect(result.n).toBe(22);
    expect(result.coefficients[1]).toBeCloseTo(3, 3);
  });

  it("exports a correction as JSON", () => {
    const result = developCorrection(rows(25, (i) => ({ x: i, y: 2 + 3 * i })), { form: "single", order: "linear" });
    const json = JSON.parse(exportCorrection(result, { sensorId: "1001" }));
    expect(json.sensorId).toBe("1001");
    expect(json.coefficients.length).toBe(2);
    expect(json.statistics.r2).toBeCloseTo(1, 5);
  });
});
