import { describe, expect, it } from "vitest";

import { applyPurpleAirCorrection } from "./domain";

function fsmap(pm25: number, humidity: number | null = 50): number {
  const result = applyPurpleAirCorrection({
    pm25,
    humidity,
    inputBasis: "cf_1",
    profileId: "epa-airnow-fsmap-cf1",
  });
  if (!result) throw new Error("expected a correction result");
  return result.pm25Corrected;
}

describe("EPA AirNow Fire & Smoke Map US-wide correction (Equation 1)", () => {
  it("uses the Barkjohn-2021 0.524 slope below 30 ug/m3", () => {
    expect(fsmap(20, 60)).toBeCloseTo(0.524 * 20 - 0.0862 * 60 + 5.75, 3);
  });

  it("uses the 0.786 mid-range slope on 50-210", () => {
    expect(fsmap(100, 60)).toBeCloseTo(0.786 * 100 - 0.0862 * 60 + 5.75, 3);
    expect(fsmap(200, 40)).toBeCloseTo(0.786 * 200 - 0.0862 * 40 + 5.75, 3);
  });

  it("uses the high-smoke quadratic above 260 and drops the RH term", () => {
    expect(fsmap(300, 60)).toBeCloseTo(2.966 + 0.69 * 300 + 8.84e-4 * 300 ** 2, 3);
    // RH must not influence the result at extreme loads.
    expect(fsmap(300, 10)).toBeCloseTo(fsmap(300, 90), 6);
  });

  it("is continuous across every breakpoint", () => {
    const eps = 1e-6;
    for (const bp of [30, 50, 210, 260]) {
      const below = fsmap(bp - eps, 55);
      const above = fsmap(bp + eps, 55);
      expect(Math.abs(below - above)).toBeLessThan(1e-2);
    }
  });

  it("is monotonically increasing through the smoke range", () => {
    let prev = -Infinity;
    for (let pa = 0; pa <= 600; pa += 5) {
      const value = fsmap(pa, 50);
      expect(value).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = value;
    }
  });
});
