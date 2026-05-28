import { describe, expect, it } from "vitest";

import { targetDiagram } from "./targetDiagram";

describe("target diagram", () => {
  it("places a perfect mimic at the origin", () => {
    const ref = [1, 2, 3, 4, 5];
    const td = targetDiagram(ref, [{ label: "perfect", values: ref }]);
    expect(td.points[0].bias).toBeCloseTo(0, 6);
    expect(td.points[0].ubRmseNorm).toBeCloseTo(0, 6);
    expect(td.points[0].targetScore).toBeCloseTo(0, 6);
  });

  it("biased model has nonzero bias and finite score", () => {
    const ref = [10, 20, 30, 40, 50];
    const td = targetDiagram(ref, [{ label: "hi", values: [11, 22, 33, 44, 55] }]);
    expect(td.points[0].bias).toBeGreaterThan(0);
    expect(td.points[0].targetScore).toBeGreaterThan(0);
  });
});
