import { describe, expect, it } from "vitest";

import {
  calculateDailySoh,
  calculateSohIndex,
  pasAddUniqueIds,
  pasEnhanceData,
  pasFilter,
  pasFilterArea,
  pasFilterNear,
  pasGetIDs,
  pasPalette,
  patAggregate,
  patExternalFit,
  patFilterDate,
  patRollingMean,
  patScatterMatrix,
  runHourlyAbQc,
  patDistinct,
  patOutliers,
  patRichAggregate,
  runAdvancedHourlyAbQc,
  patInternalFit,
  patCreateAirSensor,
  calculateEnhancedDailySoh,
  calculateEnhancedSohIndex,
  idwInterpolate,
  ordinaryKrigingInterpolate,
  aqiToColor,
  pm25ToAqi,
  gridToImageData,
  type InterpolationPoint,
  type InterpolationGrid,
} from "./domain";
import { samplePasCollection, samplePatSeries, samplePatFailureA } from "./fixtures";
import {
  correctPurpleAirPm25,
  normalizePurpleAirLocalRecord,
  normalizePurpleAirLocalSeries,
  purpleAirLocalPm25,
} from "./purpleairLocal";
import {
  computePolarPlot,
  computeWindRose,
  generateSyntheticWindData,
} from "./wind";

describe("pas utilities", () => {
  it("filters by state and outside status", () => {
    const result = pasFilter(samplePasCollection, { stateCode: "SD", isOutside: true });
    expect(result.records.length).toBeGreaterThan(0);
    expect(result.records.every((record) => record.stateCode === "SD" && record.locationType === "outside")).toBe(true);
    expect(pasGetIDs(result)).toContain("26059");
  });

  it("adds stable unique ids and spatial filters", () => {
    const withIds = pasAddUniqueIds(samplePasCollection);
    expect(withIds.records.every((record) => typeof record.uniqueId === "string")).toBe(true);
    expect(pasFilterNear(withIds, { latitude: 44.08, longitude: -103.22 }, 10).records.map((record) => record.id)).toEqual([
      "26059",
      "26060",
      "5656",
      "5657"
    ]);
    expect(
      pasFilterArea(withIds, { north: 45, south: 44, east: -103.15, west: -103.3 }).records.map((record) => record.id)
    ).toEqual(["26059", "26060", "2506", "2507", "5656", "5657"]);
  });
});

describe("PurpleAir local JSON helpers", () => {
  const localPayload = {
    SensorId: 12345,
    Geo: "Garage",
    DateTime: 1_700_000_000,
    lat: 47.61,
    lon: -122.33,
    pm2_5_atm: 9.5,
    pm2_5_atm_b: 10.2,
    current_humidity: 42,
    current_temp_f: 68.4,
    pressure: 1012.3,
  };

  it("normalizes local /json sensor data into PAS and PAT shapes", () => {
    const record = normalizePurpleAirLocalRecord(localPayload, { id: "garage", timezone: "America/Los_Angeles" });
    expect(record.id).toBe("garage");
    expect(record.label).toBe("Garage");
    expect(record.pm25Current).toBe(9.5);
    expect(record.humidity).toBe(42);

    const series = normalizePurpleAirLocalSeries(localPayload, { id: "garage", timezone: "America/Los_Angeles" });
    expect(series.meta.sensorId).toBe("garage");
    expect(series.meta.label).toBe("Garage");
    expect(series.points).toHaveLength(1);
    expect(series.points[0].pm25A).toBe(9.5);
    expect(series.points[0].pm25B).toBe(10.2);
    expect(series.points[0].timestamp).toBe("2023-11-14T22:13:20.000Z");
  });

  it("computes the US EPA PurpleAir PM2.5 correction when humidity is available", () => {
    expect(correctPurpleAirPm25(30, 60)).toBe(16.298);
    expect(correctPurpleAirPm25(8, null)).toBe(8);
    expect(purpleAirLocalPm25(localPayload, true)).toBe(7.108);
  });
});

describe("pat and analytics utilities", () => {
  it("filters a series by local day semantics", () => {
    const filtered = patFilterDate(samplePatSeries, "2018-08-01", "2018-08-01");
    expect(filtered.points).toHaveLength(1440);
    expect(filtered.points[0]?.timestamp).toBe("2018-08-01T07:00:00Z");
    expect(filtered.points.at(-1)?.timestamp).toBe("2018-08-02T06:59:00Z");
  });

  it("aggregates hourly data without losing sort order", () => {
    const aggregate = patAggregate(samplePatSeries, 120);
    expect(aggregate.points.length).toBeLessThan(samplePatSeries.points.length);
    expect(aggregate.points[0]?.timestamp <= aggregate.points.at(-1)!.timestamp).toBe(true);
  });

  it("runs QC and SoH computations", () => {
    const qc = runHourlyAbQc(samplePatSeries, { removeOutOfSpec: true });
    const daily = calculateDailySoh(qc.cleanedSeries);
    const index = calculateSohIndex(qc.cleanedSeries);

    expect(qc.flaggedPoints).toBeGreaterThan(0);
    expect(qc.removedPoints).toBeGreaterThan(0);
    expect(daily[0]?.pctReporting).toBeGreaterThan(0);
    expect(index.index).toBeGreaterThan(0);
  });
});

describe("new analytics functions", () => {
  it("removes duplicate timestamps", () => {
    const base = patDistinct(samplePatSeries);
    const duped = { ...base, points: [...base.points, base.points[0]] };
    const distinct = patDistinct(duped);
    expect(distinct.points.length).toBe(base.points.length);
  });

  it("detects outliers using Hampel filter", () => {
    const result = patOutliers(samplePatSeries, { windowSize: 7, thresholdMin: 3 });
    expect(result.totalPoints).toBe(samplePatSeries.points.length);
    expect(result.outlierCount).toBeGreaterThanOrEqual(0);
    expect(result.cleanedSeries.points.length).toBe(samplePatSeries.points.length);
  });

  it("detects more outliers in failure dataset", () => {
    const result = patOutliers(samplePatFailureA, { windowSize: 7, thresholdMin: 3 });
    expect(result.outlierCount).toBeGreaterThan(0);
  });

  it("produces rich aggregation with stats and t-test", () => {
    const rich = patRichAggregate(samplePatSeries, 60);
    expect(rich.points.length).toBeGreaterThan(0);
    const first = rich.points[0];
    expect(first.pm25A.count).toBeGreaterThan(0);
    expect(first.pm25A.mean).not.toBeNull();
    expect(first.pm25A.sd).not.toBeNull();
    expect(first.pm25A.median).not.toBeNull();
    expect(first.pm25A.min).not.toBeNull();
    expect(first.pm25A.max).not.toBeNull();
  });

  it("runs advanced QC with p-value thresholds", () => {
    const result = runAdvancedHourlyAbQc(samplePatSeries, { removeOutOfSpec: true });
    expect(result.totalPoints).toBe(samplePatSeries.points.length);
    expect(result.status).toBeDefined();
  });

  it("computes internal A/B channel fit", () => {
    const fit = patInternalFit(samplePatSeries);
    expect(fit).not.toBeNull();
    expect(fit!.rSquared).toBeGreaterThan(0);
    expect(fit!.slope).toBeGreaterThan(0);
  });

  it("creates AirSensor hourly series from PAT", () => {
    const sensor = patCreateAirSensor(samplePatSeries);
    expect(sensor.points.length).toBeGreaterThan(0);
    expect(sensor.points[0].pm25).not.toBeNull();
  });

  it("computes enhanced daily SoH with DC detection and t-test", () => {
    const metrics = calculateEnhancedDailySoh(samplePatSeries);
    expect(metrics.length).toBeGreaterThan(0);
    expect(metrics[0].pctDC).toBeDefined();
    expect(typeof metrics[0].pctDC).toBe("number");
  });

  it("computes enhanced SoH index", () => {
    const result = calculateEnhancedSohIndex(samplePatSeries);
    expect(result.index).toBeGreaterThan(0);
    expect(result.index).toBeLessThanOrEqual(100);
    expect(result.metrics.length).toBeGreaterThan(0);
    expect(result.metrics[0].abFit).toBeDefined();
  });
});

describe("pasPalette", () => {
  it("returns PM2.5 palette by default", () => {
    const palette = pasPalette();
    expect(palette.breaks).toEqual([0, 12, 35.4, 55.4, 150.4, 250.4, 500]);
    expect(palette.colors).toHaveLength(6);
    expect(palette.labels[0]).toBe("Good");
    expect(palette.labels[5]).toBe("Hazardous");
  });

  it("returns temperature palette", () => {
    const palette = pasPalette("temperature");
    expect(palette.breaks).toEqual([-40, 32, 50, 68, 86, 104, 185]);
    expect(palette.labels[0]).toBe("Freezing");
  });

  it("returns humidity palette", () => {
    const palette = pasPalette("humidity");
    expect(palette.breaks).toEqual([0, 20, 40, 60, 80, 100]);
    expect(palette.labels).toHaveLength(5);
  });
});

describe("pasEnhanceData", () => {
  it("adds timezone and uniqueId to records", () => {
    const enhanced = pasEnhanceData(samplePasCollection);
    expect(enhanced.records.length).toBe(samplePasCollection.records.length);
    for (const record of enhanced.records) {
      expect(record.timezone).toBeDefined();
      expect(typeof record.timezone).toBe("string");
      expect(record.uniqueId).toBeDefined();
    }
  });
});

describe("patExternalFit", () => {
  it("computes external fit when timestamps overlap", () => {
    // Use the same series as both sensor and reference (should produce near-perfect fit)
    const result = patExternalFit(samplePatSeries, samplePatSeries);
    expect(result).not.toBeNull();
    expect(result!.fit.rSquared).toBeGreaterThan(0.9);
    expect(result!.pairs.length).toBeGreaterThan(0);
  });

  it("returns null when no overlapping timestamps", () => {
    const emptySeries = { ...samplePatSeries, points: [] };
    const result = patExternalFit(samplePatSeries, emptySeries);
    expect(result).toBeNull();
  });
});

describe("patRollingMean", () => {
  it("smooths a series with a rolling window", () => {
    const smoothed = patRollingMean(samplePatSeries, 5);
    expect(smoothed.points.length).toBe(samplePatSeries.points.length);
    // The smoothed values should exist
    const hasValues = smoothed.points.some((p) => p.pm25A !== null);
    expect(hasValues).toBe(true);
  });

  it("preserves metadata", () => {
    const smoothed = patRollingMean(samplePatSeries, 3);
    expect(smoothed.meta).toEqual(samplePatSeries.meta);
  });
});

describe("patScatterMatrix", () => {
  it("returns variable pairs with correlation values", () => {
    const matrix = patScatterMatrix(samplePatSeries, 100);
    expect(matrix.variables).toEqual(["pm25A", "pm25B", "humidity", "temperature", "pressure"]);
    // C(5,2) = 10 pairs
    expect(matrix.pairs).toHaveLength(10);
    for (const pair of matrix.pairs) {
      expect(pair.xVar).toBeDefined();
      expect(pair.yVar).toBeDefined();
      expect(pair.correlation).toBeDefined();
      expect(typeof pair.correlation).toBe("number");
    }
  });

  it("pm25A vs pm25B should have high correlation", () => {
    const matrix = patScatterMatrix(samplePatSeries, 200);
    const abPair = matrix.pairs.find((p) => p.xVar === "pm25A" && p.yVar === "pm25B");
    expect(abPair).toBeDefined();
    expect(abPair!.correlation).toBeGreaterThan(0.5);
  });
});

describe("wind rose and polar plot", () => {
  it("generates synthetic wind data from a PAT series", () => {
    const windData = generateSyntheticWindData(samplePatSeries);
    expect(windData.length).toBeGreaterThan(0);
    for (const p of windData.slice(0, 10)) {
      expect(p.windDirection).toBeGreaterThanOrEqual(0);
      expect(p.windDirection).toBeLessThan(360);
      expect(p.windSpeed).toBeGreaterThanOrEqual(0);
      expect(typeof p.pm25).toBe("number");
    }
  });

  it("is deterministic (same input → same output)", () => {
    const a = generateSyntheticWindData(samplePatSeries);
    const b = generateSyntheticWindData(samplePatSeries);
    expect(a[0].windDirection).toBe(b[0].windDirection);
    expect(a[0].windSpeed).toBe(b[0].windSpeed);
  });

  it("computes a wind rose with 16 sectors and speed bins", () => {
    const windData = generateSyntheticWindData(samplePatSeries);
    const rose = computeWindRose(windData);
    expect(rose.sectors).toHaveLength(16);
    expect(rose.speedBinLabels).toHaveLength(5);
    expect(rose.totalPoints).toBe(windData.length);
    const totalInSectors = rose.sectors.reduce((sum, s) => sum + s.totalCount, 0);
    expect(totalInSectors).toBe(windData.length);
  });

  it("computes a polar plot with points", () => {
    const windData = generateSyntheticWindData(samplePatSeries);
    const polar = computePolarPlot(windData);
    expect(polar.points.length).toBe(windData.length);
    expect(polar.maxSpeed).toBeGreaterThan(0);
    expect(polar.maxPm25).toBeGreaterThan(0);
    // Each point is [direction, speed, pm25]
    expect(polar.points[0]).toHaveLength(3);
  });
});

describe("spatial interpolation", () => {
  it("IDW interpolation produces valid grid", () => {
    const points: InterpolationPoint[] = [
      { x: 0, y: 0, value: 10 },
      { x: 1, y: 0, value: 20 },
      { x: 0, y: 1, value: 30 },
      { x: 1, y: 1, value: 40 },
    ];
    const grid = idwInterpolate(points, 5, 5, { west: 0, east: 1, south: 0, north: 1 });
    expect(grid.width).toBe(5);
    expect(grid.height).toBe(5);
    expect(grid.values.length).toBe(25);
    // Corner values should match known points
    expect(grid.values[0]).toBeCloseTo(10, 0); // (0,0) = 10
    expect(grid.values[4]).toBeCloseTo(20, 0); // (1,0) = 20
    // Center should be interpolated
    expect(grid.values[12]).toBeGreaterThan(10);
    expect(grid.values[12]).toBeLessThan(40);
  });

  it("IDW exact-point interpolation returns the source value", () => {
    const points: InterpolationPoint[] = [
      { x: -122, y: 47, value: 12 },
      { x: -121, y: 47, value: 20 },
      { x: -122, y: 48, value: 28 },
    ];

    const grid = idwInterpolate(points, 1, 1, {
      west: -122,
      east: -122,
      south: 47,
      north: 47,
    });

    expect(grid.values[0]).toBeCloseTo(12, 6);
  });

  it("interpolation handles empty inputs without invalid min/max", () => {
    const idwGrid = idwInterpolate([], 4, 4, { west: 0, east: 1, south: 0, north: 1 });
    const krigingGrid = ordinaryKrigingInterpolate([], 4, 4, { west: 0, east: 1, south: 0, north: 1 });

    expect(idwGrid.min).toBe(0);
    expect(idwGrid.max).toBe(0);
    expect(krigingGrid.min).toBe(0);
    expect(krigingGrid.max).toBe(0);
    expect(Array.from(idwGrid.values).every((value) => value === 0)).toBe(true);
    expect(Array.from(krigingGrid.values).every((value) => value === 0)).toBe(true);
  });

  it("Ordinary Kriging produces valid grid", () => {
    const points: InterpolationPoint[] = [
      { x: 0, y: 0, value: 10 },
      { x: 1, y: 0, value: 20 },
      { x: 0, y: 1, value: 30 },
      { x: 1, y: 1, value: 40 },
      { x: 0.5, y: 0.5, value: 25 },
    ];
    const grid = ordinaryKrigingInterpolate(points, 5, 5, { west: 0, east: 1, south: 0, north: 1 });
    expect(grid.width).toBe(5);
    expect(grid.values.length).toBe(25);
    expect(grid.min).toBeLessThanOrEqual(grid.max);
  });

  it("Ordinary Kriging merges duplicate coordinates instead of producing NaN output", () => {
    const points: InterpolationPoint[] = [
      { x: 0, y: 0, value: 10 },
      { x: 0, y: 0, value: 14 },
      { x: 1, y: 0, value: 20 },
      { x: 0, y: 1, value: 30 },
      { x: 1, y: 1, value: 40 },
    ];

    const grid = ordinaryKrigingInterpolate(points, 5, 5, { west: 0, east: 1, south: 0, north: 1 });
    expect(Array.from(grid.values).every((value) => Number.isFinite(value))).toBe(true);
    expect(grid.values[0]).toBeCloseTo(12, 0);
  });

  it("tiled Ordinary Kriging produces a finite approximate grid", () => {
    const points: InterpolationPoint[] = [
      { x: 0, y: 0, value: 10 },
      { x: 1, y: 0, value: 20 },
      { x: 0, y: 1, value: 30 },
      { x: 1, y: 1, value: 40 },
      { x: 0.5, y: 0.5, value: 25 },
    ];

    const exact = ordinaryKrigingInterpolate(points, 9, 9, { west: 0, east: 1, south: 0, north: 1 }, 4);
    const tiled = ordinaryKrigingInterpolate(points, 9, 9, { west: 0, east: 1, south: 0, north: 1 }, 4, 3);
    const meanAbsoluteDifference = Array.from(tiled.values).reduce(
      (sum, value, index) => sum + Math.abs(value - exact.values[index]),
      0,
    ) / tiled.values.length;

    expect(Array.from(tiled.values).every((value) => Number.isFinite(value))).toBe(true);
    expect(meanAbsoluteDifference).toBeLessThan(5);
  });

  it("aqiToColor returns valid RGBA", () => {
    const good = aqiToColor(25);
    expect(good[0]).toBeLessThanOrEqual(255);
    expect(good[1]).toBeGreaterThan(0); // Green component
    expect(good[3]).toBeGreaterThan(0); // Alpha > 0

    const unhealthy = aqiToColor(175);
    expect(unhealthy[0]).toBe(255); // Red
  });

  it("pm25ToAqi respects EPA breakpoint boundaries", () => {
    expect(pm25ToAqi(0)).toBe(0);
    expect(pm25ToAqi(12.0)).toBe(50);
    expect(pm25ToAqi(12.1)).toBe(51);
    expect(pm25ToAqi(35.4)).toBe(100);
    expect(pm25ToAqi(500.5)).toBe(500);
  });

  it("gridToImageData produces correct size", () => {
    const grid: InterpolationGrid = {
      width: 3, height: 3,
      bounds: { west: 0, east: 1, south: 0, north: 1 },
      values: new Float64Array([10, 20, 30, 40, 50, 60, 70, 80, 90]),
      min: 10, max: 90,
    };
    const data = gridToImageData(grid, false);
    expect(data.length).toBe(3 * 3 * 4); // 36 bytes
  });

  it("gridToImageData flips rows so north is rendered at the top", () => {
    const grid: InterpolationGrid = {
      width: 2,
      height: 2,
      bounds: { west: 0, east: 1, south: 0, north: 1 },
      values: new Float64Array([
        10, 20,
        30, 40,
      ]),
      min: 10,
      max: 40,
    };

    const data = gridToImageData(grid, true);
    const topLeft = Array.from(data.slice(0, 4));
    const bottomLeft = Array.from(data.slice(8, 12));

    expect(topLeft).toEqual(Array.from(aqiToColor(pm25ToAqi(30))));
    expect(bottomLeft).toEqual(Array.from(aqiToColor(pm25ToAqi(10))));
  });
});
