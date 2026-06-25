import { describe, expect, it } from "vitest";

import { colorForValue, colormapLegend, NO_DATA_COLOR } from "./colormaps";

describe("colormaps", () => {
  it("returns the no-data color for null/non-finite values", () => {
    expect(colorForValue(null, { colormap: "viridis", min: 0, max: 100 })).toBe(NO_DATA_COLOR);
    expect(colorForValue(NaN, { colormap: "aqi", min: 0, max: 100 })).toBe(NO_DATA_COLOR);
  });

  it("uses AQI band colors for the aqi colormap", () => {
    // Good (< 9) is green, hazardous (very high) is dark red.
    expect(colorForValue(5, { colormap: "aqi", min: 0, max: 300 })).toBe("#2e9d5b");
    expect(colorForValue(300, { colormap: "aqi", min: 0, max: 300 })).not.toBe("#2e9d5b");
  });

  it("interpolates continuous ramps between min and max", () => {
    const lo = colorForValue(0, { colormap: "viridis", min: 0, max: 100 });
    const hi = colorForValue(100, { colormap: "viridis", min: 0, max: 100 });
    const mid = colorForValue(50, { colormap: "viridis", min: 0, max: 100 });
    expect(lo).toBe("#440154"); // first viridis stop
    expect(hi).toBe("#fde725"); // last viridis stop
    expect(mid).not.toBe(lo);
    expect(mid).not.toBe(hi);
    expect(/^#[0-9a-f]{6}$/.test(mid)).toBe(true);
  });

  it("maps SCAQMD breaks", () => {
    expect(colorForValue(5, { colormap: "scaqmd", min: 0, max: 100 })).toBe("#abebff");
    expect(colorForValue(200, { colormap: "scaqmd", min: 0, max: 100 })).toBe("#6b0096");
  });

  it("builds a legend for each colormap", () => {
    expect(colormapLegend("aqi", 0, 300).length).toBe(6);
    expect(colormapLegend("scaqmd", 0, 100).length).toBe(5);
    expect(colormapLegend("viridis", 0, 100).length).toBeGreaterThan(2);
  });
});
