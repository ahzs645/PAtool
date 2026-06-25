import { describe, expect, it } from "vitest";

import { evaluateEpaSensorPerformance } from "./epaEvaluation";
import type { MeasurementPair } from "./measurementError";

function pairs(make: (i: number) => MeasurementPair, n = 30): MeasurementPair[] {
  return Array.from({ length: n }, (_, i) => make(i));
}

describe("EPA performance targets", () => {
  it("uses the paper's O3 linearity target of R^2 >= 0.8", () => {
    const result = evaluateEpaSensorPerformance(
      pairs((i) => ({ reference: 20 + i, sensor: 20 + i })),
      { pollutant: "O3" },
    );
    expect(result.target.minR2).toBe(0.8);
  });

  it("uses NRMSE <= 30% (not 50%) and RMSE <= 7 for PM2.5", () => {
    const result = evaluateEpaSensorPerformance(
      pairs((i) => ({ reference: 20 + i, sensor: 20 + i })),
      { pollutant: "PM2.5" },
    );
    expect(result.target.maxNormalizedRmse).toBe(0.3);
    expect(result.target.maxRmse).toBe(7);
  });

  it("passes the PM2.5 error target when RMSE<=7 even if NRMSE>30% (low concentrations)", () => {
    // Constant +2 offset on low (4-8 ug/m3) references: perfect R^2, RMSE=2
    // (<=7) but NRMSE ~= 0.33 (>0.3). EPA's OR rule must let it pass.
    const result = evaluateEpaSensorPerformance(
      pairs((i) => {
        const reference = 4 + (i % 5);
        return { reference, sensor: reference + 2 };
      }),
      { pollutant: "PM2.5" },
    );
    const errorDecision = result.decisions.find((d) => d.criterion.includes("OR"));
    expect(errorDecision).toBeDefined();
    expect(errorDecision?.pass).toBe(true);
  });

  it("fails the PM2.5 error target when both RMSE and NRMSE exceed the targets", () => {
    // reference 20-30, sensor +10: survives the QC <=80% difference gate, but
    // RMSE=10 (>7) and NRMSE ~= 0.4 (>0.3), so both error criteria fail.
    const result = evaluateEpaSensorPerformance(
      pairs((i) => {
        const reference = 20 + (i % 11);
        return { reference, sensor: reference + 10 };
      }),
      { pollutant: "PM2.5" },
    );
    const errorDecision = result.decisions.find((d) => d.criterion.includes("OR"));
    expect(errorDecision?.pass).toBe(false);
  });
});
