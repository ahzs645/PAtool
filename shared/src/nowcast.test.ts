import { describe, expect, it } from "vitest";

import { monitorNowcast, nowcastToAqi, nowcastValue } from "./nowcast";

describe("EPA NowCast", () => {
  it("returns most recent value when all hours equal", () => {
    const vals = new Array(12).fill(10) as Array<number | null>;
    expect(nowcastValue(vals)).toBeCloseTo(10, 6);
  });

  it("weights recent hours more when concentrations vary", () => {
    const lowThenHigh = [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 50];
    const result = nowcastValue(lowThenHigh)!;
    expect(result).toBeGreaterThan(5);
    expect(result).toBeLessThan(50);
  });

  it("returns null when last 3 hours mostly missing for PM", () => {
    const v: Array<number | null> = [10, 10, 10, 10, 10, 10, 10, 10, 10, null, null, 10];
    expect(nowcastValue(v, "pm")).toBeCloseTo(10, 6);
    const broken: Array<number | null> = [10, 10, 10, 10, 10, 10, 10, 10, 10, null, null, null];
    expect(nowcastValue(broken, "pm")).toBeNull();
  });

  it("ozone variant uses simple trailing mean over 8 hours", () => {
    const v = [10, 20, 30, 40, 50, 60, 70, 80];
    expect(nowcastValue(v, "ozone")).toBeCloseTo(45, 6);
  });

  it("monitorNowcast aligns length with input", () => {
    const v = Array.from({ length: 30 }, (_, i) => i);
    const series = monitorNowcast(v);
    expect(series).toHaveLength(30);
  });

  it("nowcastToAqi maps PM2.5 to AQI brackets", () => {
    expect(nowcastToAqi(5).label).toBe("Good");
    expect(nowcastToAqi(20).label).toBe("Moderate");
    expect(nowcastToAqi(250).label).toBe("Hazardous");
    expect(nowcastToAqi(null).aqi).toBeNull();
  });
});
