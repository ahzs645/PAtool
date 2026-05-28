import { describe, expect, it } from "vitest";

import { qcInvalidateConsecutiveSuspectValues } from "./stickyValueQc";

describe("sticky-value QC", () => {
  it("flags a run of identical values", () => {
    const result = qcInvalidateConsecutiveSuspectValues([1, 2, 7, 7, 7, 7, 8]);
    expect(result.flags.map((f) => f.index)).toEqual([2, 3, 4, 5]);
    expect(result.values).toEqual([1, 2, null, null, null, null, 8]);
  });

  it("respects min run length", () => {
    const result = qcInvalidateConsecutiveSuspectValues([5, 5, 6], { minRun: 3 });
    expect(result.flags).toHaveLength(0);
  });

  it("can ignore zero-stuck periods (sensor off)", () => {
    const r = qcInvalidateConsecutiveSuspectValues([0, 0, 0, 0, 4], { ignoreZero: true });
    expect(r.flags).toHaveLength(0);
  });

  it("tolerance allows approximate equality", () => {
    const r = qcInvalidateConsecutiveSuspectValues([10, 10.05, 10.02, 10.04], { tolerance: 0.01 });
    expect(r.flags.length).toBe(4);
  });
});
