import { describe, expect, it } from "vitest";

import {
  prepareWeatherNormalizationRows,
  runWeatherNormalization,
  type WeatherNormalizationRow,
} from "./weatherNormalization";
import type { PatSeries } from "./domain";

function series(n = 96): PatSeries {
  const start = Date.UTC(2026, 0, 1);
  return {
    meta: {
      sensorId: "met-1",
      label: "Weather test",
      timezone: "UTC",
    },
    points: Array.from({ length: n }, (_, i) => {
      const hour = i % 24;
      const humidity = 45 + 20 * Math.sin((hour / 24) * Math.PI * 2);
      const temperature = 18 + 7 * Math.cos((hour / 24) * Math.PI * 2);
      const pressure = 1010 + (i % 12);
      const pm25 = 8 + 0.18 * humidity - 0.08 * temperature + 0.03 * i;
      return {
        timestamp: new Date(start + i * 3600_000).toISOString(),
        pm25A: pm25,
        pm25B: pm25 + 0.4,
        humidity: i === 4 ? null : humidity,
        temperature,
        pressure,
      };
    }),
  };
}

describe("weather normalization", () => {
  it("prepares deterministic rows with imputation and held-out samples", () => {
    const prepared = prepareWeatherNormalizationRows(series(), { seed: 4 });
    expect(prepared.rows).toHaveLength(96);
    expect(prepared.rows.some((row) => row.set === "training")).toBe(true);
    expect(prepared.rows.some((row) => row.set === "testing")).toBe(true);
    expect(prepared.rows[4].humidity).toBe(prepared.imputed.humidity);
    expect(prepared.featureNames).toContain("trend");
  });

  it("runs a complete rmweather-style diagnostic package", () => {
    const result = runWeatherNormalization(series(), {
      seed: 7,
      normalizationSamples: 5,
      partialDependenceResolution: 5,
      randomForest: { numTrees: 12, maxDepth: 7 },
    });
    expect(result.diagnostics.normalized).toHaveLength(result.rows.length);
    expect(result.diagnostics.predictions).toHaveLength(result.rows.length);
    expect(result.diagnostics.importance[0].rank).toBe(1);
    expect(result.diagnostics.partialDependence.length).toBeGreaterThan(0);
    expect(result.diagnostics.metrics.n).toBeGreaterThan(0);
  });

  it("keeps the trend term fixed during normalization", () => {
    const result = runWeatherNormalization(series(48), {
      seed: 11,
      normalizationSamples: 3,
      randomForest: { numTrees: 8 },
    });
    const sourceByTimestamp = new Map<string, WeatherNormalizationRow>(
      result.rows.map((row) => [row.timestamp, row]),
    );
    for (const point of result.diagnostics.normalized) {
      expect(sourceByTimestamp.get(point.timestamp)?.trend).toBeTypeOf("number");
      expect(point.normalized).toBeGreaterThanOrEqual(0);
    }
  });

  it("defaults to meteorology-only shuffling but supports broader covariate sets", () => {
    const metOnly = runWeatherNormalization(series(48), {
      seed: 12,
      normalizationSamples: 2,
      randomForest: { numTrees: 6 },
    });
    expect(metOnly.config.shuffledFeatureNames).toEqual(["humidity", "temperature", "pressure"]);

    const broad = runWeatherNormalization(series(48), {
      seed: 12,
      covariateSet: "meteorology-seasonality",
      normalizationSamples: 2,
      randomForest: { numTrees: 6 },
    });
    expect(broad.config.shuffledFeatureNames).toContain("hourSin");
    expect(broad.config.shuffledFeatureNames).not.toContain("trend");
  });
});
