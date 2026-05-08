import { describe, expect, it } from "vitest";

import {
  diurnalClimatologyForecast,
  exponentialSmoothingForecast,
  FORECAST_METHOD_NOTES,
  persistenceForecast,
  type ForecastSamplePoint,
} from "./forecast";

function makeHistory(hours: number): ForecastSamplePoint[] {
  const out: ForecastSamplePoint[] = [];
  const base = Date.UTC(2024, 0, 1, 0, 0, 0);
  for (let i = 0; i < hours; i += 1) {
    const t = base + i * 3600 * 1000;
    const hour = new Date(t).getUTCHours();
    out.push({
      timestamp: new Date(t).toISOString(),
      pm25: 8 + 4 * Math.sin((hour / 24) * Math.PI * 2),
    });
  }
  return out;
}

describe("forecast baselines", () => {
  it("persistence forecast returns the right number of points and finite intervals", () => {
    const history = makeHistory(72);
    const forecast = persistenceForecast({ history, horizonHours: 24 });
    expect(forecast).toHaveLength(24);
    expect(forecast.every((point) => Number.isFinite(point.pm25))).toBe(true);
    expect(forecast.every((point) => point.pi95Half >= 0)).toBe(true);
  });

  it("diurnal-climatology forecast captures the synthetic diurnal cycle", () => {
    const history = makeHistory(7 * 24);
    const forecast = diurnalClimatologyForecast({ history, horizonHours: 24 });
    const max = Math.max(...forecast.map((p) => p.pm25));
    const min = Math.min(...forecast.map((p) => p.pm25));
    expect(max - min).toBeGreaterThan(2); // captures the +-4 amplitude
  });

  it("exponential smoothing falls back to persistence for short histories", () => {
    const history = makeHistory(12);
    const forecast = exponentialSmoothingForecast({ history, horizonHours: 6 });
    expect(forecast).toHaveLength(6);
    expect(forecast[0].source).toBe("persistence");
  });

  it("exposes notes for the planned ST-GNN approach", () => {
    expect(FORECAST_METHOD_NOTES["ml-stgnn"].summary).toMatch(/AirPhyNet|GNN/i);
  });
});
