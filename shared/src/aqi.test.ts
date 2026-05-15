import { describe, expect, it } from "vitest";

import { EPA_PM25_AQI_PROFILE } from "./domain";
import {
  AQI_PALETTES,
  aqiThresholds,
  invalidateConsecutiveSuspectValues,
  pm25ToAqiBandWithPalette,
  pm25ToAqiRegulatory,
  truncatePm25ForAqi,
} from "./index";

describe("AQI utilities", () => {
  it("truncates PM2.5 to 0.1 ug/m3 before AQI conversion", () => {
    expect(truncatePm25ForAqi(9.09)).toBe(9);
    expect(pm25ToAqiRegulatory(9.09, EPA_PM25_AQI_PROFILE)).toBe(50);
    expect(pm25ToAqiRegulatory(9.1, EPA_PM25_AQI_PROFILE)).toBe(51);
  });

  it("extrapolates hazardous AQI above the top concentration breakpoint", () => {
    expect(pm25ToAqiRegulatory(500.5, EPA_PM25_AQI_PROFILE)).toBeGreaterThan(500);
  });

  it("can render categories with an alternate palette", () => {
    const band = pm25ToAqiBandWithPalette(12, EPA_PM25_AQI_PROFILE, "deuteranopia");
    expect(band.label).toBe("Moderate");
    expect(band.color).toBe(AQI_PALETTES.deuteranopia.colors.Moderate);
  });

  it("returns threshold concentrations for chart overlays", () => {
    expect(aqiThresholds(EPA_PM25_AQI_PROFILE)).toEqual([9.1, 35.5, 55.5, 125.5, 225.5, 325.5]);
  });
});

describe("time-series quality helpers", () => {
  it("invalidates sticky suspect runs without removing isolated values", () => {
    expect(invalidateConsecutiveSuspectValues([1, 1000, 2, 0, 0, 3, null, null, 4])).toEqual([
      1,
      1000,
      2,
      null,
      null,
      3,
      null,
      null,
      4,
    ]);
  });
});
