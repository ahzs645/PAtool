import { describe, expect, it } from "vitest";

import {
  fitBayesianLinearModel,
  compareBayesianModels,
  type BayesianLinearObservation,
} from "./bayesianOutcomeModel";
import {
  applyPurpleAirCorrection,
  calculateDailySoh,
  calculateSohIndex,
  evaluateChannelAgreement,
  pasAddUniqueIds,
  pasEnhanceData,
  pasFilter,
  pasFilterArea,
  pasFilterNear,
  pasGetIDs,
  PAS_MODELING_FIELD_MANIFEST,
  pasPalette,
  patAggregate,
  buildPatModelingMatrix,
  patExternalFit,
  patFilterDate,
  patRollingMean,
  patScatterMatrix,
  summarizePasDatasetHealth,
  runHourlyAbQc,
  patDistinct,
  patOutliers,
  patRichAggregate,
  runAdvancedHourlyAbQc,
  runPaper3Qc,
  reducedMajorAxisRegression,
  idwSpatioTemporalEstimate,
  idwSpatioTemporalInterpolateGrid,
  computeSpatioTemporalIdwWeight,
  stIdwLeaveOneOut,
  stIdwGridSearchTimeWeight,
  type SpatioTemporalPoint,
  type PatSeries,
  patInternalFit,
  patCreateAirSensor,
  calculateEnhancedDailySoh,
  calculateEnhancedSohIndex,
  summarizeSensorHealth,
  idwInterpolate,
  ordinaryKrigingInterpolate,
  idwEstimateAtPoints,
  krigingEstimateAtPoints,
  createOrdinaryKrigingModel,
  aqiToColor,
  buildReferenceComparison,
  calculateNowCast,
  EPA_PM25_AQI_PROFILE,
  pm25ToAqi,
  pm25ToAqiBand,
  gridToImageData,
  type InterpolationPoint,
  type InterpolationGrid,
} from "./domain";
import { samplePasCollection, samplePatSeries, samplePatFailureA } from "./fixtures";
import {
  correctPurpleAirPm25,
  correctionProfile,
  normalizePurpleAirLocalRecord,
  normalizePurpleAirLocalSeries,
  purpleAirLocalPm25,
} from "./purpleairLocal";
import { attributePm25Event, parseFirmsCsv, parseHmsSmokeGeoJson } from "./hazards";
import {
  classifyWindDirection,
  classifyWindIntensity,
  computePolarPlot,
  computeWindRose,
  flagWindPoint,
  generateSyntheticWindData,
  summarizeWindQc,
} from "./wind";
import { computeDailySummaries, type DailySummary } from "./summaries";
import {
  RUCC_CODE_INFO,
  isRuccCode,
  lookupRucc,
  parseRuccCsv,
  rollupByRucc,
  ruccCategoryForFips,
  ruccTierForFips,
} from "./rucc";
import {
  createSpaceTimeKrigingModel,
  fitSumMetricSpaceTimeVariogram,
  haversineKm,
  spaceTimeKrigingEstimate,
  sumMetricVariogramValue,
  type SpaceTimeObservation,
} from "./spaceTimeKriging";
import {
  classifyDayType,
  filterSpatioTemporalByDayType,
  isSchoolDayDate,
  isSummerDate,
  isTestingDate,
  isWeekendDate,
  matchesDayType,
  rollupDailySummariesByDayType,
  rollupPatSeriesByDayType,
  type SchoolCalendar,
  DEFAULT_DAY_TYPES,
} from "./dayTypes";
import {
  applyElevationTrend,
  compareInterpolationMethods,
  detrendByElevation,
  fitElevationTrend,
  leaveOneOutCrossValidate,
} from "./interpolationCv";
import {
  aggregateModelRuns,
  assessPearsonCalibrationGate,
  buildPasSnapshotFeatureTable,
  evaluateRegressionPredictions,
} from "./modeling";
import {
  buildStudyGrid,
  combineWeightedStudyGrids,
  computeObservedStudyGrid,
  createStudyAreaFromSensors,
  deriveStudyBoundsFromSources,
  rankSensorSitingCandidates,
  rasterizeSourceLayer,
  validateStudyGrid,
  type SourceLayerConfig,
  type StudySourceFeatureCollection,
} from "./studyArea";

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

  it("summarizes snapshot dataset readiness for modeling", () => {
    const summary = summarizePasDatasetHealth(samplePasCollection);
    expect(summary.totalRecords).toBe(samplePasCollection.records.length);
    expect(summary.validCoordinateRecords).toBeGreaterThan(0);
    expect(summary.recordsWithPm25).toBeGreaterThan(0);
    expect(summary.fieldCompleteness).toHaveLength(PAS_MODELING_FIELD_MANIFEST.length);
    expect(summary.fieldCompleteness.find((field) => field.key === "latitude")?.completeness).toBe(1);
    expect(summary.bounds).not.toBeNull();
  });

  it("flags duplicate snapshot IDs in dataset readiness", () => {
    const duplicated = {
      ...samplePasCollection,
      records: [...samplePasCollection.records, samplePasCollection.records[0]],
    };
    const summary = summarizePasDatasetHealth(duplicated);
    expect(summary.duplicateIds).toContain(samplePasCollection.records[0].id);
    expect(summary.warnings.some((warning) => warning.code === "duplicate-ids")).toBe(true);
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
    expect(correctionProfile.id).toBe("epa-barkjohn-2021");
    expect(correctionProfile.label).toContain("PurpleAir");
    expect(correctPurpleAirPm25(30, 60)).toBe(16.298);
    expect(correctPurpleAirPm25(8, null)).toBe(8);
    expect(purpleAirLocalPm25(localPayload, true)).toBe(7.108);
  });
});

describe("PurpleAir correction profiles and health checks", () => {
  it("applies correction profiles and rejects mismatched input bases", () => {
    const barkjohn = applyPurpleAirCorrection({
      pm25: 30,
      humidity: 60,
      inputBasis: "cf_1",
      profileId: "epa-barkjohn-2021-cf1",
    });
    expect(barkjohn?.pm25Corrected).toBe(16.298);
    expect(barkjohn?.provenance).toBe("epa-corrected-purpleair");

    const smoke = applyPurpleAirCorrection({
      pm25: 700,
      humidity: 60,
      inputBasis: "cf_1",
      profileId: "epa-barkjohn-2022-smoke-cf1",
    });
    expect(smoke?.pm25Corrected).toBeCloseTo(484.13, 2);

    const nilson = applyPurpleAirCorrection({
      pm25: 20,
      humidity: 50,
      inputBasis: "atm",
      profileId: "nilson-2022-rh-growth-atm",
    });
    expect(nilson?.pm25Corrected).toBeCloseTo(16.129, 3);

    expect(() => applyPurpleAirCorrection({
      pm25: 20,
      humidity: 50,
      inputBasis: "atm",
      profileId: "epa-barkjohn-2021-cf1",
    })).toThrow(/requires cf_1 input/);
  });

  it("evaluates A/B channel agreement at EPA-style threshold boundaries", () => {
    expect(evaluateChannelAgreement(10, 15, "qapp-hourly").valid).toBe(true);
    const questionable = evaluateChannelAgreement(100, 147, "qapp-hourly");
    expect(questionable.valid).toBe(false);
    expect(questionable.level).toBe("questionable");
    expect(evaluateChannelAgreement(10, 1000, "qapp-hourly").level).toBe("severe");
    expect(evaluateChannelAgreement(null, 10, "qapp-hourly").level).toBe("unavailable");
  });

  it("summarizes visible sensor health from channel disagreement and humidity", () => {
    const health = summarizeSensorHealth({
      ...samplePatSeries,
      points: [
        { ...samplePatSeries.points[0], pm25A: 10, pm25B: 11, humidity: 40 },
        { ...samplePatSeries.points[1], pm25A: 100, pm25B: 170, humidity: 97 },
        { ...samplePatSeries.points[2], pm25A: null, pm25B: 12, humidity: 50 },
      ],
    });

    expect(health.level).toBe("severe");
    expect(health.channelDisagreementCount).toBe(1);
    expect(health.highHumidityCount).toBe(1);
    expect(health.missingChannelCount).toBe(1);
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

  it("aligns PAT series into a sensor-time-field modeling matrix", () => {
    const first = {
      ...samplePatSeries,
      meta: { ...samplePatSeries.meta, sensorId: "first" },
      points: samplePatSeries.points.slice(0, 3),
    };
    const second = {
      ...samplePatSeries,
      meta: { ...samplePatSeries.meta, sensorId: "second" },
      points: samplePatSeries.points.slice(1, 4),
    };

    const union = buildPatModelingMatrix([first, second], { fields: ["pm25A", "humidity"] });
    expect(union.sensorIds).toEqual(["first", "second"]);
    expect(union.timestamps).toHaveLength(4);
    expect(union.fields).toEqual(["pm25A", "humidity"]);
    expect(union.values).toHaveLength(2);
    expect(union.values[0]).toHaveLength(4);
    expect(union.fieldCompleteness[0].field).toBe("pm25A");

    const intersection = buildPatModelingMatrix([first, second], {
      fields: ["pm25A"],
      timeIndex: "intersection",
    });
    expect(intersection.timestamps).toEqual([
      samplePatSeries.points[1].timestamp,
      samplePatSeries.points[2].timestamp,
    ]);
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

describe("Paper 3 QC pipeline (Carroll et al. 2025)", () => {
  it("keeps a healthy series and reports a keep verdict", () => {
    const result = runPaper3Qc(samplePatSeries);
    expect(result.monitorVerdict).toBe("keep");
    expect(result.totalPoints).toBe(samplePatSeries.points.length);
    expect(result.tempRangeF).not.toBeNull();
    expect(result.missingFraction).toBeGreaterThanOrEqual(0);
    expect(result.removedPoints).toBe(0);
  });

  it("short-circuits on indoor metadata flag", () => {
    const result = runPaper3Qc(samplePatSeries, { locationIsIndoor: true, removeOutOfSpec: true });
    expect(result.monitorVerdict).toBe("drop-indoor");
    expect(result.removedPoints).toBe(samplePatSeries.points.length);
  });

  it("drops monitor when the T range is below the threshold", () => {
    const result = runPaper3Qc(samplePatSeries, { minTempRangeF: 1_000_000 });
    expect(result.monitorVerdict).toBe("drop-temp-range-too-small");
  });

  it("flags out-of-range RH and temperature observations", () => {
    const polluted = {
      ...samplePatSeries,
      points: samplePatSeries.points.map((p, i) =>
        i === 0 ? { ...p, humidity: 150 } : i === 1 ? { ...p, temperature: 2000 } : p,
      ),
    };
    const result = runPaper3Qc(polluted);
    const rh = result.issues.find((x) => x.code === "rh-out-of-range");
    const temp = result.issues.find((x) => x.code === "temp-out-of-range");
    expect(rh?.count ?? 0).toBeGreaterThanOrEqual(1);
    expect(temp?.count ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("flags the A/B low-absolute rule (|A-B|>10 when avg<=100)", () => {
    const polluted = {
      ...samplePatSeries,
      points: samplePatSeries.points.map((p, i) =>
        i === 0 ? { ...p, pm25A: 5, pm25B: 40 } : p,
      ),
    };
    const result = runPaper3Qc(polluted);
    const ab = result.issues.find((x) => x.code === "ab-drift-low");
    expect(ab?.count ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("flags the A/B high-percent rule (|A-B|/avg>10% when avg>100)", () => {
    const polluted = {
      ...samplePatSeries,
      points: samplePatSeries.points.map((p, i) =>
        i === 0 ? { ...p, pm25A: 100, pm25B: 200 } : p,
      ),
    };
    const result = runPaper3Qc(polluted);
    const ab = result.issues.find((x) => x.code === "ab-drift-high");
    expect(ab?.count ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("removes out-of-spec observations when removeOutOfSpec is true", () => {
    const polluted = {
      ...samplePatSeries,
      points: samplePatSeries.points.map((p, i) =>
        i === 0 ? { ...p, humidity: 150 } : p,
      ),
    };
    const dryRun = runPaper3Qc(polluted, { removeOutOfSpec: false });
    const live = runPaper3Qc(polluted, { removeOutOfSpec: true });
    expect(dryRun.removedPoints).toBe(0);
    expect(live.removedPoints).toBeGreaterThanOrEqual(1);
    expect(live.cleanedSeries.points[0].humidity).toBeNull();
  });
});

describe("reduced major axis regression", () => {
  it("recovers a known slope of 1 on identical inputs", () => {
    const xs = [1, 2, 3, 4, 5, 6];
    const ys = [1, 2, 3, 4, 5, 6];
    const fit = reducedMajorAxisRegression(xs, ys);
    expect(fit).not.toBeNull();
    expect(fit!.slope).toBeCloseTo(1, 6);
    expect(fit!.intercept).toBeCloseTo(0, 6);
    expect(fit!.pearsonR).toBeCloseTo(1, 6);
    expect(fit!.n).toBe(6);
  });

  it("produces a negative slope for anti-correlated inputs", () => {
    const xs = [1, 2, 3, 4, 5];
    const ys = [5, 4, 3, 2, 1];
    const fit = reducedMajorAxisRegression(xs, ys);
    expect(fit).not.toBeNull();
    expect(fit!.slope).toBeCloseTo(-1, 6);
    expect(fit!.pearsonR).toBeCloseTo(-1, 6);
  });

  it("returns null for insufficient points", () => {
    expect(reducedMajorAxisRegression([1], [1])).toBeNull();
  });
});

describe("spatio-temporal IDW", () => {
  const baseTime = Date.UTC(2024, 5, 15, 12, 0, 0);
  const dayMs = 86_400_000;

  it("computes a known weight for the 1/(d^2 + C|dt|) kernel", () => {
    // d^2 = 4 km^2, dt = 2 days, C = 1  =>  w = 1 / (4 + 1*2) = 1/6
    const w = computeSpatioTemporalIdwWeight(4, 2, 1);
    expect(w).toBeCloseTo(1 / 6, 8);
  });

  it("returns value of a coincident space-time neighbor as an exact match", () => {
    const points: SpatioTemporalPoint[] = [
      { x: -122.5, y: 45.5, t: baseTime, value: 12 },
      { x: -122.0, y: 45.7, t: baseTime - dayMs, value: 18 },
    ];
    const [estimate] = idwSpatioTemporalEstimate(points, [
      { x: -122.5, y: 45.5, t: baseTime },
    ]);
    expect(estimate.value).toBeCloseTo(12, 6);
    expect(estimate.neighborCount).toBe(1);
  });

  it("weights closer-in-time observations more heavily", () => {
    // Two sensors, equal distance from the query; one is 1 day old, the other 30 days old.
    const points: SpatioTemporalPoint[] = [
      { id: "fresh", x: -122.4, y: 45.5, t: baseTime - 1 * dayMs, value: 10 },
      { id: "stale", x: -122.6, y: 45.5, t: baseTime - 30 * dayMs, value: 40 },
    ];
    const [estimate] = idwSpatioTemporalEstimate(
      points,
      [{ x: -122.5, y: 45.5, t: baseTime }],
      { timeWeightC: 5 },
    );
    expect(estimate.value).not.toBeNull();
    // Result should be pulled toward the fresh sensor's value.
    expect(estimate.value!).toBeLessThan(25);
    expect(estimate.value!).toBeGreaterThan(10);
  });

  it("excludes neighbors beyond maxDistanceKm and maxDaysBack", () => {
    const points: SpatioTemporalPoint[] = [
      { id: "near", x: -122.45, y: 45.5, t: baseTime, value: 8 },
      { id: "too-far-spatial", x: -110.0, y: 45.5, t: baseTime, value: 80 },
      { id: "too-far-temporal", x: -122.45, y: 45.5, t: baseTime - 365 * dayMs, value: 80 },
    ];
    const [estimate] = idwSpatioTemporalEstimate(
      points,
      [{ x: -122.5, y: 45.5, t: baseTime }],
      { maxDistanceKm: 500, maxDaysBack: 90, maxDaysForward: 90, timeWeightC: 1 },
    );
    expect(estimate.value).not.toBeNull();
    expect(estimate.neighborCount).toBe(1);
    expect(estimate.value!).toBeCloseTo(8, 6);
  });

  it("returns null value when no neighbors remain after filtering", () => {
    const points: SpatioTemporalPoint[] = [
      { id: "far", x: -100.0, y: 40.0, t: baseTime, value: 50 },
    ];
    const [estimate] = idwSpatioTemporalEstimate(
      points,
      [{ x: -122.5, y: 45.5, t: baseTime }],
      { maxDistanceKm: 200 },
    );
    expect(estimate.value).toBeNull();
    expect(estimate.neighborCount).toBe(0);
  });

  it("builds a gridded interpolation of the correct shape", () => {
    const points: SpatioTemporalPoint[] = [
      { id: "a", x: -122.5, y: 45.4, t: baseTime, value: 6 },
      { id: "b", x: -122.3, y: 45.6, t: baseTime, value: 30 },
    ];
    const grid = idwSpatioTemporalInterpolateGrid(
      points,
      10,
      10,
      { west: -122.7, east: -122.1, south: 45.3, north: 45.7 },
      baseTime,
      { timeWeightC: 1 },
    );
    expect(grid.width).toBe(10);
    expect(grid.height).toBe(10);
    expect(grid.values.length).toBe(100);
    expect(grid.min).toBeGreaterThanOrEqual(6 - 1e-6);
    expect(grid.max).toBeLessThanOrEqual(30 + 1e-6);
  });

  it("grid-search picks the lowest-RMSE timeWeightC from candidates", () => {
    // Construct a strongly time-varying field where small C should outperform huge C.
    const points: SpatioTemporalPoint[] = [];
    for (let i = 0; i < 6; i++) {
      points.push({
        id: `s${i}`,
        x: -122.5 + i * 0.05,
        y: 45.5,
        t: baseTime + i * dayMs,
        value: 10 + i * 5,
      });
    }
    const { best, all } = stIdwGridSearchTimeWeight(points, [0.1, 1, 10, 1000], {
      maxDistanceKm: 500,
      maxDaysBack: 90,
      maxDaysForward: 90,
    });
    expect(all.length).toBe(4);
    expect(Number.isFinite(best.rmse)).toBe(true);
    // rmse of best candidate must not exceed the worst candidate.
    const worst = all.reduce((a, b) => (a.rmse >= b.rmse ? a : b));
    expect(best.rmse).toBeLessThanOrEqual(worst.rmse + 1e-9);
  });

  it("leave-one-out returns NaN RMSE when no usable folds", () => {
    const points: SpatioTemporalPoint[] = [
      { id: "solo", x: -122.5, y: 45.5, t: baseTime, value: 10 },
    ];
    const r = stIdwLeaveOneOut(points, 1);
    expect(r.sampleCount).toBe(0);
    expect(Number.isNaN(r.rmse)).toBe(true);
  });
});

describe("USDA RUCC locale tagging", () => {
  const sampleCsv = [
    `FIPS,State,County_Name,RUCC_2023,Population_2020`,
    `"37067","NC","Forsyth County",2,382295`,
    `37001,NC,Alamance County,3,171415`,
    `"37011","NC","Avery County",8,17557`,
    // Duplicate or bad rows should be ignored
    `99999,ZZ,Not a real place,,`,
    `37017,NC,Bladen County,9,29606`,
  ].join("\n");

  const table = parseRuccCsv(sampleCsv);

  it("loads known rows by normalized FIPS", () => {
    expect(table.rows.length).toBe(4);
    expect(table.byFips.get("37067")?.code).toBe(2);
    // Allow lookup with or without leading zeros / extra chars.
    expect(lookupRucc("37067", table)?.countyName).toBe("Forsyth County");
    expect(lookupRucc("37-067", table)?.countyName).toBe("Forsyth County");
  });

  it("maps FIPS to category and tier", () => {
    expect(ruccCategoryForFips("37067", table)).toBe("metro");
    expect(ruccCategoryForFips("37011", table)).toBe("nonmetro");
    expect(ruccTierForFips("37011", table)).toBe("nonmetro-rural");
    expect(ruccTierForFips("37001", table)).toBe("metro-small");
    expect(ruccCategoryForFips("99999", table)).toBeNull();
  });

  it("exposes full code metadata for all 9 codes", () => {
    for (let code = 1; code <= 9; code++) {
      expect(isRuccCode(code)).toBe(true);
      const info = RUCC_CODE_INFO[code as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9];
      expect(info.label.length).toBeGreaterThan(0);
    }
    expect(isRuccCode(0)).toBe(false);
    expect(isRuccCode(10)).toBe(false);
  });

  it("rolls up PM2.5 values by RUCC category", () => {
    const receptors = [
      { fips: "37067", pm25: 12 }, // metro
      { fips: "37001", pm25: 14 }, // metro
      { fips: "37011", pm25: 22 }, // nonmetro
      { fips: "37017", pm25: null }, // nonmetro no value
      { fips: "99999", pm25: 30 }, // unclassified
    ];
    const rollups = rollupByRucc(receptors, table, "category");
    const byKey = new Map(rollups.map((r) => [r.group, r]));
    expect(byKey.get("metro")!.receptorCount).toBe(2);
    expect(byKey.get("metro")!.withValueCount).toBe(2);
    expect(byKey.get("metro")!.meanPm25).toBeCloseTo(13, 6);
    expect(byKey.get("nonmetro")!.receptorCount).toBe(2);
    expect(byKey.get("nonmetro")!.withValueCount).toBe(1);
    expect(byKey.get("__unclassified__")!.receptorCount).toBe(1);
  });

  it("sorts code-grouped rollups numerically by RUCC code", () => {
    const receptors = [
      { fips: "37011", pm25: 22 },
      { fips: "37067", pm25: 12 },
      { fips: "37001", pm25: 14 },
    ];
    const rollups = rollupByRucc(receptors, table, "code");
    expect(rollups.map((r) => r.group)).toEqual(["2", "3", "8"]);
  });

  it("errors on a CSV without required columns", () => {
    expect(() => parseRuccCsv("state,county\nNC,Wake")).toThrow(/FIPS/);
  });
});

describe("day-type classification", () => {
  const ncCalendar: SchoolCalendar = {
    schoolYear: [
      { start: "2022-08-29", end: "2023-06-09" },
    ],
    holidays: ["2022-11-24", "2022-12-25"],
    testingWindows: [
      { start: "2023-05-22", end: "2023-06-02" },
    ],
    // default summer (Jun/Jul/Aug) used since summerWindows omitted
  };

  it("flags weekends by calendar date (no DST drift)", () => {
    expect(isWeekendDate("2024-03-08")).toBe(false); // Friday before US DST
    expect(isWeekendDate("2024-03-09")).toBe(true);  // Saturday before US DST
    expect(isWeekendDate("2024-03-10")).toBe(true);  // Sunday (US DST starts)
    expect(isWeekendDate("2024-11-03")).toBe(true);  // Sunday (DST ends)
    expect(isWeekendDate("2024-07-08")).toBe(false); // Monday
  });

  it("identifies summer dates using the default Jun/Jul/Aug rule", () => {
    expect(isSummerDate("2023-06-15")).toBe(true);
    expect(isSummerDate("2023-08-31")).toBe(true);
    expect(isSummerDate("2023-05-31")).toBe(false);
    expect(isSummerDate("2023-09-01")).toBe(false);
  });

  it("overrides summer with explicit summerWindows when provided", () => {
    const cal: SchoolCalendar = {
      summerWindows: [{ start: "2023-06-10", end: "2023-08-24" }],
    };
    expect(isSummerDate("2023-06-15", cal)).toBe(true);
    expect(isSummerDate("2023-06-05", cal)).toBe(false);
    expect(isSummerDate("2023-08-30", cal)).toBe(false);
  });

  it("flags testing windows and school days correctly within a NC calendar", () => {
    expect(isTestingDate("2023-05-25", ncCalendar)).toBe(true);
    expect(isTestingDate("2023-04-01", ncCalendar)).toBe(false);

    // Weekday in school year, not holiday, not summer → school day
    expect(isSchoolDayDate("2022-10-03", ncCalendar)).toBe(true);
    // Thanksgiving listed holiday in school year → not a school day
    expect(isSchoolDayDate("2022-11-24", ncCalendar)).toBe(false);
    // Saturday → not a school day
    expect(isSchoolDayDate("2022-10-08", ncCalendar)).toBe(false);
    // Summer-defaulted day (July) → not a school day
    expect(isSchoolDayDate("2022-07-15", ncCalendar)).toBe(false);
    // Outside configured school year range → not a school day
    expect(isSchoolDayDate("2023-07-05", ncCalendar)).toBe(false);
  });

  it("classifyDayType returns all applicable tags for a given date", () => {
    const tags = classifyDayType("2023-05-25", ncCalendar); // Thursday, testing window
    expect(tags).toContain("all");
    expect(tags).toContain("weekday");
    expect(tags).toContain("testing-day");
    expect(tags).toContain("school-day");
    expect(tags).not.toContain("weekend");
    expect(tags).not.toContain("summer");
    expect(tags).not.toContain("holiday");
  });

  it("matchesDayType covers each DayType branch", () => {
    expect(matchesDayType("2023-05-25", "all", ncCalendar)).toBe(true);
    expect(matchesDayType("2023-05-25", "school-day", ncCalendar)).toBe(true);
    expect(matchesDayType("2023-05-25", "testing-day", ncCalendar)).toBe(true);
    expect(matchesDayType("2023-07-04", "summer", ncCalendar)).toBe(true);
    expect(matchesDayType("2023-07-04", "school-day", ncCalendar)).toBe(false);
    expect(matchesDayType("2022-11-24", "holiday", ncCalendar)).toBe(true);
    expect(matchesDayType("2023-07-08", "weekend", ncCalendar)).toBe(true);
  });

  it("rejects malformed dates", () => {
    expect(() => isWeekendDate("2024/03/09")).toThrow(/YYYY-MM-DD/);
    expect(() => isWeekendDate("2024-13-01")).toThrow(/YYYY-MM-DD/);
  });
});

describe("estimateAtPoints (IDW + kriging)", () => {
  const knownPoints: InterpolationPoint[] = [
    { id: "n", x: -78.0, y: 35.5, value: 10 },
    { id: "ne", x: -77.5, y: 35.5, value: 20 },
    { id: "s", x: -78.0, y: 35.0, value: 30 },
    { id: "se", x: -77.5, y: 35.0, value: 40 },
  ];

  it("idwEstimateAtPoints returns the exact value for a coincident receptor", () => {
    const [estimate] = idwEstimateAtPoints(knownPoints, [
      { id: "school-A", x: -78.0, y: 35.5 },
    ]);
    expect(estimate.source).toBe("exact");
    expect(estimate.value).toBeCloseTo(10, 6);
  });

  it("idwEstimateAtPoints interpolates a centroid receptor", () => {
    const [estimate] = idwEstimateAtPoints(knownPoints, [
      { id: "centroid", x: -77.75, y: 35.25 },
    ]);
    expect(estimate.source).toBe("idw-fallback");
    expect(estimate.value).not.toBeNull();
    // Symmetric centroid should pull strongly toward the four-point mean (25),
    // with small deviation because km-distance per longitude is shorter than per
    // latitude at 35 degrees.
    expect(estimate.value!).toBeGreaterThan(24);
    expect(estimate.value!).toBeLessThan(26);
  });

  it("idwEstimateAtPoints honors maxDistanceKm", () => {
    const [near, far] = idwEstimateAtPoints(
      knownPoints,
      [
        { id: "in-bounds", x: -77.75, y: 35.25 },
        { id: "out-of-bounds", x: -100.0, y: 30.0 },
      ],
      { maxDistanceKm: 100 },
    );
    expect(near.value).not.toBeNull();
    expect(far.value).toBeNull();
    expect(far.source).toBe("none");
  });

  it("krigingEstimateAtPoints returns finite values for school-like receptors", () => {
    const model = createOrdinaryKrigingModel(knownPoints);
    const estimates = krigingEstimateAtPoints(model, [
      { id: "school-A", x: -78.0, y: 35.5 },
      { id: "school-B", x: -77.75, y: 35.25 },
    ]);
    expect(estimates).toHaveLength(2);
    expect(estimates[0].source).toBe("exact");
    expect(estimates[0].value).toBeCloseTo(10, 6);
    expect(estimates[1].value).not.toBeNull();
    expect(estimates[1].source === "kriging" || estimates[1].source === "idw-fallback").toBe(true);
    expect(Number.isFinite(estimates[1].value!)).toBe(true);
  });

  it("krigingEstimateAtPoints returns 'none' when the model has no points", () => {
    const model = createOrdinaryKrigingModel([]);
    const [estimate] = krigingEstimateAtPoints(model, [
      { id: "anywhere", x: -100, y: 40 },
    ]);
    expect(estimate.value).toBeNull();
    expect(estimate.source).toBe("none");
  });
});

describe("sum-metric space-time kriging", () => {
  const dayMs = 86_400_000;
  const baseTime = Date.UTC(2024, 5, 15, 12, 0, 0);

  function syntheticObservations(count = 20, seed = 42): SpaceTimeObservation[] {
    const obs: SpaceTimeObservation[] = [];
    let s = seed;
    function rand() {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    }
    for (let i = 0; i < count; i++) {
      const lon = -78.5 + rand() * 1.0; // ~80 km wide
      const lat = 35.2 + rand() * 0.6;
      const dayOffset = Math.floor(rand() * 14);
      // A deterministic space-time field: trend + weak noise.
      const trend = 10 + (lat - 35.2) * 20 + dayOffset * 0.5;
      const noise = (rand() - 0.5) * 2;
      obs.push({
        id: `obs-${i}`,
        x: lon,
        y: lat,
        t: baseTime + dayOffset * dayMs,
        value: trend + noise,
      });
    }
    return obs;
  }

  it("haversineKm matches known pair-distance", () => {
    // Between (lat 0, lon 0) and (lat 0, lon 1) should be ~111 km.
    const d = haversineKm(0, 0, 1, 0);
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(120);
  });

  it("fits a sum-metric variogram with finite parameters", () => {
    const vg = fitSumMetricSpaceTimeVariogram(syntheticObservations());
    expect(Number.isFinite(vg.spatial.sill)).toBe(true);
    expect(Number.isFinite(vg.temporal.sill)).toBe(true);
    expect(Number.isFinite(vg.joint.sill)).toBe(true);
    expect(vg.spatial.range).toBeGreaterThan(0);
    expect(vg.temporal.range).toBeGreaterThan(0);
    expect(vg.kappa).toBeGreaterThan(0);
  });

  it("sum-metric variogram is monotone-ish in h at fixed u", () => {
    const vg = fitSumMetricSpaceTimeVariogram(syntheticObservations());
    const g1 = sumMetricVariogramValue(5, 0, vg);
    const g2 = sumMetricVariogramValue(50, 0, vg);
    expect(g2).toBeGreaterThanOrEqual(g1);
  });

  it("creates a kriging model and estimates finite values at in-support queries", () => {
    const obs = syntheticObservations(25);
    const model = createSpaceTimeKrigingModel(obs);
    const estimates = spaceTimeKrigingEstimate(
      model,
      [
        { id: "q-inside", x: -78.0, y: 35.5, t: baseTime + 3 * dayMs },
        { id: "q-coincident", x: obs[0].x, y: obs[0].y, t: obs[0].t },
      ],
      { maxNeighbors: 8, maxDistanceKm: 200, maxDaysBack: 21, maxDaysForward: 21 },
    );
    expect(estimates).toHaveLength(2);
    const inside = estimates[0];
    expect(inside.source === "kriging" || inside.source === "nearest").toBe(true);
    expect(inside.value).not.toBeNull();
    expect(Number.isFinite(inside.value!)).toBe(true);
    const exact = estimates[1];
    expect(exact.source).toBe("exact");
    expect(exact.value).toBeCloseTo(obs[0].value, 6);
  });

  it("returns none when no observations fall within the requested window", () => {
    const obs = syntheticObservations(10);
    const model = createSpaceTimeKrigingModel(obs);
    const [estimate] = spaceTimeKrigingEstimate(
      model,
      [{ id: "way-out", x: -100.0, y: 40.0, t: baseTime + 365 * dayMs }],
      { maxNeighbors: 8, maxDistanceKm: 50, maxDaysBack: 30, maxDaysForward: 30 },
    );
    expect(estimate.value).toBeNull();
    expect(estimate.source).toBe("none");
  });

  it("returns 'none' for every query when the model has no observations", () => {
    const model = createSpaceTimeKrigingModel([]);
    const [estimate] = spaceTimeKrigingEstimate(model, [
      { id: "q", x: 0, y: 0, t: baseTime },
    ]);
    expect(estimate.value).toBeNull();
    expect(estimate.variance).toBeNull();
    expect(estimate.source).toBe("none");
  });
});

describe("day-type rollups", () => {
  function syntheticSummaries(): DailySummary[] {
    // Build 21 days: Jan 2..Jan 22 2023 with mean = day-of-month (so weekdays vs weekends differ)
    const days: DailySummary[] = [];
    for (let day = 2; day <= 22; day++) {
      const dateStr = `2023-01-${String(day).padStart(2, "0")}`;
      const value = day;
      days.push({
        date: dateStr,
        nObservations: 24,
        humidityMean: null,
        temperatureMean: null,
        pressureMean: null,
        minutesAboveEpaThreshold: value > 12 ? 60 : 0,
        fullDay: {
          count: 24,
          mean: value,
          min: value - 2,
          minTime: "00:00:00",
          max: value + 2,
          maxTime: "12:00:00",
          std: 0.5,
        },
        morningRush: { count: 0, mean: null, min: null, minTime: null, max: null, maxTime: null, std: null },
        eveningRush: { count: 0, mean: null, min: null, minTime: null, max: null, maxTime: null, std: null },
        daytimeAmbient: { count: 0, mean: null, min: null, minTime: null, max: null, maxTime: null, std: null },
        nighttimeAmbient: { count: 0, mean: null, min: null, minTime: null, max: null, maxTime: null, std: null },
      });
    }
    return days;
  }

  it("splits daily summaries into weekday vs weekend buckets with correct counts", () => {
    const rollups = rollupDailySummariesByDayType(syntheticSummaries(), {
      dayTypes: ["all", "weekday", "weekend"],
    });
    const byType = new Map(rollups.map((r) => [r.dayType, r]));
    // Jan 2..Jan 22 2023: 15 weekdays, 6 weekend days (Jan 7, 8, 14, 15, 21, 22)
    expect(byType.get("all")!.dayCount).toBe(21);
    expect(byType.get("weekday")!.dayCount).toBe(15);
    expect(byType.get("weekend")!.dayCount).toBe(6);
    // Weekday means: days 2..6, 9..13, 16..20  → mean = 11
    expect(byType.get("weekday")!.meanPm25).toBeCloseTo(11, 6);
  });

  it("honors school calendar testing windows", () => {
    const summaries: DailySummary[] = [];
    for (let day = 22; day <= 26; day++) {
      summaries.push({
        date: `2023-05-${String(day).padStart(2, "0")}`,
        nObservations: 24,
        humidityMean: null,
        temperatureMean: null,
        pressureMean: null,
        minutesAboveEpaThreshold: 0,
        fullDay: {
          count: 24,
          mean: day,
          min: day,
          minTime: "00:00:00",
          max: day,
          maxTime: "12:00:00",
          std: 0,
        },
        morningRush: { count: 0, mean: null, min: null, minTime: null, max: null, maxTime: null, std: null },
        eveningRush: { count: 0, mean: null, min: null, minTime: null, max: null, maxTime: null, std: null },
        daytimeAmbient: { count: 0, mean: null, min: null, minTime: null, max: null, maxTime: null, std: null },
        nighttimeAmbient: { count: 0, mean: null, min: null, minTime: null, max: null, maxTime: null, std: null },
      });
    }
    const cal: SchoolCalendar = {
      schoolYear: [{ start: "2022-08-29", end: "2023-06-09" }],
      testingWindows: [{ start: "2023-05-22", end: "2023-05-26" }],
    };
    const rollups = rollupDailySummariesByDayType(summaries, {
      dayTypes: ["testing-day", "school-day"],
      calendar: cal,
    });
    const byType = new Map(rollups.map((r) => [r.dayType, r]));
    expect(byType.get("testing-day")!.dayCount).toBe(5);
    expect(byType.get("school-day")!.dayCount).toBe(5);
    expect(byType.get("testing-day")!.meanPm25).toBeCloseTo(24, 6);
  });

  it("rollupPatSeriesByDayType aggregates across a full series", () => {
    const points = [];
    const start = Date.UTC(2023, 0, 2, 18, 0, 0); // Jan 2 18:00 UTC → 10:00 Pacific
    for (let d = 0; d < 7; d++) {
      points.push({
        timestamp: new Date(start + d * 86_400_000).toISOString(),
        pm25A: 10 + d,
        pm25B: 10 + d,
        humidity: 40,
        temperature: 65,
        pressure: 1012,
      });
    }
    const series: PatSeries = {
      meta: {
        sensorId: "syn-1",
        label: "Synthetic",
        timezone: "America/Los_Angeles",
      },
      points,
    };
    const rollups = rollupPatSeriesByDayType(series, {
      dayTypes: ["all", "weekday", "weekend"],
    });
    const all = rollups.find((r) => r.dayType === "all")!;
    expect(all.dayCount).toBe(7);
    expect(all.meanPm25).toBeCloseTo(13, 6);
  });

  it("filters spatio-temporal points by day type", () => {
    const tz = "America/New_York";
    const points = [
      { t: Date.UTC(2023, 0, 3, 15, 0, 0), value: 1 }, // Tue 10am ET → weekday
      { t: Date.UTC(2023, 0, 7, 15, 0, 0), value: 2 }, // Sat 10am ET → weekend
      { t: Date.UTC(2023, 0, 8, 15, 0, 0), value: 3 }, // Sun 10am ET → weekend
    ];
    const weekdayOnly = filterSpatioTemporalByDayType(points, "weekday", tz);
    const weekendOnly = filterSpatioTemporalByDayType(points, "weekend", tz);
    expect(weekdayOnly.map((p) => p.value)).toEqual([1]);
    expect(weekendOnly.map((p) => p.value)).toEqual([2, 3]);
  });

  it("DEFAULT_DAY_TYPES enumerates the paper's required buckets", () => {
    expect(DEFAULT_DAY_TYPES).toContain("all");
    expect(DEFAULT_DAY_TYPES).toContain("school-day");
    expect(DEFAULT_DAY_TYPES).toContain("weekend");
    expect(DEFAULT_DAY_TYPES).toContain("summer");
    expect(DEFAULT_DAY_TYPES).toContain("testing-day");
  });
});

describe("pasPalette", () => {
  it("returns PM2.5 palette by default", () => {
    const palette = pasPalette();
    expect(palette.breaks).toEqual([0, 9.1, 35.5, 55.5, 125.5, 225.5, 325.5]);
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
    expect(tiled.diagnostics?.kriging?.requestedTileSize).toBe(3);
    expect(tiled.diagnostics?.kriging?.artifacts.negativeRate).toBe(0);
  });

  it("falls back from tiled Kriging when the variogram range is too small for the grid spacing", () => {
    const points: InterpolationPoint[] = [
      { x: -1, y: -1, value: 10 },
      { x: 1, y: -1, value: 20 },
      { x: -1, y: 1, value: 30 },
      { x: 1, y: 1, value: 40 },
      { x: 0, y: 0, value: 25 },
    ];

    const grid = ordinaryKrigingInterpolate(
      points,
      50,
      25,
      { west: -100, east: 100, south: -60, north: 60 },
      4,
      6,
    );

    expect(grid.diagnostics?.kriging?.mode).toBe("exact");
    expect(grid.diagnostics?.kriging?.requestedTileSize).toBe(6);
    expect(grid.diagnostics?.kriging?.effectiveTileSize).toBe(1);
    expect(grid.diagnostics?.kriging?.fallbackReason).toBe("range-to-cell-spacing");
    expect(grid.diagnostics?.kriging?.artifacts.rangeToCellSpacingRatio).toBeLessThan(2);
    expect(grid.diagnostics?.kriging?.artifacts.tileBoundaryOutlierRate).toBeLessThan(0.35);
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
    expect(EPA_PM25_AQI_PROFILE.id).toBe("epa-pm25-2024");
    expect(pm25ToAqi(0)).toBe(0);
    expect(pm25ToAqi(9.0)).toBe(50);
    expect(pm25ToAqi(9.1)).toBe(51);
    expect(pm25ToAqi(35.4)).toBe(100);
    expect(pm25ToAqi(55.4)).toBe(150);
    expect(pm25ToAqi(125.4)).toBe(200);
    expect(pm25ToAqi(225.4)).toBe(300);
    expect(pm25ToAqi(325.4)).toBe(500);
    expect(pm25ToAqi(500.5)).toBeGreaterThan(500);
  });

  it("does not classify missing PM2.5 as good AQI", () => {
    expect(pm25ToAqiBand(null)).toEqual({ label: "Unavailable", color: "#94a3b8", aqi: null });
    expect(pm25ToAqiBand(226).label).toBe("Hazardous");
  });

  it("computes EPA NowCast values from hourly PM2.5 samples", () => {
    const stable = Array.from({ length: 12 }, (_, index) => ({
      timestamp: new Date(Date.UTC(2026, 3, 20, 12 - index)).toISOString(),
      pm25: 10,
    }));
    const stableResult = calculateNowCast(stable);
    expect(stableResult.pm25NowCast).toBe(10);
    expect(stableResult.aqi).toBe(pm25ToAqi(10));
    expect(stableResult.weightFactor).toBe(1);
    expect(stableResult.status).toBe("stable");
    expect(stableResult.hoursRequired).toBe(12);
    expect(stableResult.provenance).toBe("epa-nowcast-aqi");

    const variable = stable.map((sample, index) => ({ ...sample, pm25: index === 0 ? 100 : 1 }));
    expect(calculateNowCast(variable).weightFactor).toBe(0.5);
    const insufficient = calculateNowCast([{ timestamp: stable[0].timestamp, pm25: 10 }]);
    expect(insufficient.pm25NowCast).toBeNull();
    expect(insufficient.status).toBe("insufficient");
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

describe("daily summaries", () => {
  it("groups points by local day and computes window stats", () => {
    const summaries = computeDailySummaries(samplePatSeries);
    expect(summaries.length).toBeGreaterThan(0);

    const first = summaries[0];
    expect(first.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(first.nObservations).toBeGreaterThan(0);
    expect(first.fullDay.count).toBeGreaterThan(0);
    if (first.fullDay.mean !== null && first.fullDay.min !== null && first.fullDay.max !== null) {
      expect(first.fullDay.min).toBeLessThanOrEqual(first.fullDay.mean);
      expect(first.fullDay.mean).toBeLessThanOrEqual(first.fullDay.max);
    }
    expect(first.minutesAboveEpaThreshold).toBeGreaterThanOrEqual(0);
    expect(first.minutesAboveEpaThreshold % 10).toBe(0);
  });

  it("respects a custom EPA threshold", () => {
    const low = computeDailySummaries(samplePatSeries, { epaDailyThreshold: 0 });
    const high = computeDailySummaries(samplePatSeries, { epaDailyThreshold: 1000 });
    const lowTotal = low.reduce((s, d) => s + d.minutesAboveEpaThreshold, 0);
    const highTotal = high.reduce((s, d) => s + d.minutesAboveEpaThreshold, 0);
    expect(lowTotal).toBeGreaterThan(highTotal);
    expect(highTotal).toBe(0);
  });
});

describe("reference comparison and hazard helpers", () => {
  it("builds concentration-only reference comparison pairs without mixing AQI into fit", () => {
    const comparison = buildReferenceComparison(samplePatSeries, {
      source: "airnow",
      kind: "conditions",
      label: "Reference",
      latitude: 47.6,
      longitude: -122.3,
      observations: [
        {
          timestamp: samplePatSeries.points[0].timestamp,
          parameter: "PM2.5",
          pm25: null,
          aqi: 42,
          provenance: "official-reference",
        },
      ],
    });

    expect(comparison.pairs[0].referenceAqi).toBe(42);
    expect(comparison.pairs[0].referencePm25).toBeNull();
    expect(comparison.fit).toBeNull();
    expect(comparison.validation?.status).toBe("insufficient");
  });

  it("computes reference validation metrics for collocated PM2.5 observations", () => {
    const hourly = patAggregate(samplePatSeries, 60);
    const observations = hourly.points.slice(0, 4).map((point) => {
      const sensorPm25 = point.pm25A !== null && point.pm25B !== null ? (point.pm25A + point.pm25B) / 2 : point.pm25A ?? point.pm25B ?? 0;
      return {
        timestamp: point.timestamp,
        parameter: "PM2.5" as const,
        pm25: Number((sensorPm25 * 1.02 + 0.1).toFixed(3)),
        aqi: null,
        provenance: "official-reference" as const,
      };
    });

    const comparison = buildReferenceComparison(hourly, {
      source: "aqs",
      kind: "monitor",
      label: "AQS",
      latitude: hourly.meta.latitude ?? 47.6,
      longitude: hourly.meta.longitude ?? -122.3,
      observations,
    });

    expect(comparison.fit).not.toBeNull();
    expect(comparison.validation?.n).toBeGreaterThanOrEqual(3);
    expect(comparison.validation?.rmse).not.toBeNull();
    expect(comparison.validation?.targets.minRSquared).toBe(0.7);
  });

  it("parses NASA FIRMS CSV fire detections into shared hazard records", () => {
    const detections = parseFirmsCsv(
      "latitude,longitude,acq_date,acq_time,satellite,instrument,confidence,frp,brightness\n"
      + "47.61,-122.33,2026-04-20,0830,N,VIIRS,n,12.5,330.1\n",
    );

    expect(detections).toHaveLength(1);
    expect(detections[0]).toMatchObject({
      source: "firms",
      latitude: 47.61,
      longitude: -122.33,
      acquisitionTime: "2026-04-20T08:30:00.000Z",
      frpMw: 12.5,
    });
  });

  it("parses HMS smoke GeoJSON and builds event attribution labels", () => {
    const smoke = parseHmsSmokeGeoJson({
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: { Density: "Heavy", Start: "2026-04-20T08:00:00Z" },
        geometry: {
          type: "Polygon",
          coordinates: [[
            [-123, 47],
            [-122, 47],
            [-122, 48],
            [-123, 48],
            [-123, 47],
          ]],
        },
      }],
    }, { west: -122.8, south: 47.2, east: -122.1, north: 47.9 });

    expect(smoke).toHaveLength(1);
    expect(smoke[0]).toMatchObject({ source: "hms", density: "heavy", timestamp: "2026-04-20T08:00:00.000Z" });
    expect(attributePm25Event({ nearbySmoke: true, nearbyFire: true }).label).toBe("likely smoke event");
    expect(attributePm25Event({ channelDisagreement: true }).label).toBe("likely sensor fault");
  });
});

describe("wind QC", () => {
  it("flags out-of-range speeds and directions", () => {
    const bad = flagWindPoint({ timestamp: "2024-01-01T00:00:00Z", windSpeed: -5, windDirection: 400, pm25: 10 });
    expect(bad.speedError).toBe(1);
    expect(bad.directionError).toBe(1);
    expect(bad.intensity).toBe(0);
    expect(bad.directionCategory).toBe(0);

    const ok = flagWindPoint({ timestamp: "2024-01-01T00:00:00Z", windSpeed: 5, windDirection: 180, pm25: 10 });
    expect(ok.speedError).toBe(0);
    expect(ok.directionError).toBe(0);
    expect(ok.intensity).toBe(1);
    expect(ok.directionCategory).toBe(4);
  });

  it("classifies intensity and direction buckets at boundaries", () => {
    expect(classifyWindIntensity(0)).toBe(1);
    expect(classifyWindIntensity(10)).toBe(1);
    expect(classifyWindIntensity(10.1)).toBe(2);
    expect(classifyWindIntensity(20)).toBe(2);
    expect(classifyWindIntensity(30.1)).toBe(4);
    expect(classifyWindDirection(0)).toBe(1);
    expect(classifyWindDirection(45)).toBe(1);
    expect(classifyWindDirection(315)).toBe(7);
    expect(classifyWindDirection(316)).toBe(8);
  });

  it("summarizes counts across a series", () => {
    const wind = generateSyntheticWindData(samplePatSeries);
    const summary = summarizeWindQc(wind);
    expect(summary.total).toBe(wind.length);
    const intensitySum = summary.intensityCounts[1] + summary.intensityCounts[2] + summary.intensityCounts[3] + summary.intensityCounts[4];
    const directionSum = (Object.values(summary.directionCounts) as number[]).reduce((s, v) => s + v, 0);
    expect(intensitySum + summary.speedErrorCount).toBe(summary.total);
    expect(directionSum + summary.directionErrorCount).toBe(summary.total);
  });
});

describe("interpolation cross-validation", () => {
  const points: InterpolationPoint[] = [
    { id: "a", x: -103.0, y: 44.0, value: 10 },
    { id: "b", x: -103.1, y: 44.0, value: 12 },
    { id: "c", x: -103.0, y: 44.1, value: 11 },
    { id: "d", x: -103.1, y: 44.1, value: 13 },
    { id: "e", x: -103.05, y: 44.05, value: 11.5 },
  ];

  it("returns one residual per held-out point for IDW", () => {
    const result = leaveOneOutCrossValidate(points, { method: "idw" });
    expect(result.method).toBe("idw");
    expect(result.n).toBe(points.length);
    expect(result.residuals).toHaveLength(points.length);
    expect(result.rmse).toBeGreaterThanOrEqual(0);
    expect(result.mae).toBeGreaterThanOrEqual(0);
  });

  it("compareInterpolationMethods runs both methods", () => {
    const results = compareInterpolationMethods(points);
    expect(results.map((r) => r.method)).toEqual(["idw", "kriging"]);
    for (const r of results) {
      expect(r.n).toBe(points.length);
      expect(Number.isFinite(r.rmse)).toBe(true);
    }
  });

  it("returns zero metrics when fewer than three points are available", () => {
    const result = leaveOneOutCrossValidate(points.slice(0, 2), { method: "idw" });
    expect(result.n).toBe(0);
    expect(result.rmse).toBe(0);
  });
});

describe("elevation trend", () => {
  it("fits a slope/intercept when enough elevation samples exist", () => {
    const withElev: InterpolationPoint[] = [
      { x: 0, y: 0, value: 10, elevationMeters: 0 },
      { x: 1, y: 0, value: 12, elevationMeters: 100 },
      { x: 0, y: 1, value: 14, elevationMeters: 200 },
      { x: 1, y: 1, value: 16, elevationMeters: 300 },
    ];
    const trend = fitElevationTrend(withElev);
    expect(trend).not.toBeNull();
    expect(trend!.slope).toBeCloseTo(0.02, 5);
    expect(trend!.intercept).toBeCloseTo(10, 5);
  });

  it("returns null when fewer than three elevation samples exist", () => {
    const sparse: InterpolationPoint[] = [
      { x: 0, y: 0, value: 10, elevationMeters: 0 },
      { x: 1, y: 0, value: 12, elevationMeters: 100 },
      { x: 0, y: 1, value: 14 },
    ];
    expect(fitElevationTrend(sparse)).toBeNull();
  });

  it("detrend then apply recovers the original values", () => {
    const withElev: InterpolationPoint[] = [
      { x: 0, y: 0, value: 10, elevationMeters: 0 },
      { x: 1, y: 0, value: 12, elevationMeters: 100 },
      { x: 0, y: 1, value: 14, elevationMeters: 200 },
    ];
    const trend = fitElevationTrend(withElev)!;
    const residuals = detrendByElevation(withElev, trend);
    for (let i = 0; i < withElev.length; i += 1) {
      const restored = applyElevationTrend(residuals[i].value, withElev[i].elevationMeters, trend);
      expect(restored).toBeCloseTo(withElev[i].value, 5);
    }
  });
});

describe("config-driven study areas", () => {
  it("derives a reusable study config and observed PM2.5 grid from PurpleAir records", () => {
    const study = createStudyAreaFromSensors(samplePasCollection, {
      resolutionMeters: 500,
      sensorFilters: { isOutside: true },
      sensorValueField: "pm25_1hr",
    });

    expect(study.sensorProvider).toBe("purpleair");
    expect(study.bounds?.west).toBeLessThan(study.bounds!.east);

    const observed = computeObservedStudyGrid(samplePasCollection, study, { maxCells: 2_500 });
    expect(observed.width * observed.height).toBeLessThanOrEqual(2_500);
    expect(observed.values.length).toBe(observed.width * observed.height);
    expect(observed.max).toBeGreaterThanOrEqual(observed.min);
  });

  it("rasterizes generic GeoJSON sources, combines weighted layers, and validates against observations", () => {
    const bounds = { west: -103.32, east: -103.12, south: 44.0, north: 44.16 };
    const grid = buildStudyGrid(bounds, 1_000, 900);

    const trafficLayer: SourceLayerConfig = {
      id: "traffic",
      name: "Traffic",
      kind: "line",
      valueField: "aadt",
      weightDefault: 0.6,
      dispersion: { method: "gaussian", sigmaMeters: 1_500, radiusMeters: 4_000 },
    };
    const facilityLayer: SourceLayerConfig = {
      id: "facilities",
      name: "Facilities",
      kind: "point",
      valueField: "pm25_lbs",
      weightDefault: 0.4,
      dispersion: { method: "gaussian", sigmaMeters: 2_000, radiusMeters: 5_000 },
    };

    const traffic: StudySourceFeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { aadt: 12_000 },
          geometry: {
            type: "LineString",
            coordinates: [
              [-103.3, 44.02],
              [-103.14, 44.14],
            ],
          },
        },
      ],
    };
    const facilities: StudySourceFeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { pm25_lbs: 700 },
          geometry: { type: "Point", coordinates: [-103.2, 44.08] },
        },
      ],
    };

    const sourceBounds = deriveStudyBoundsFromSources([traffic, facilities]);
    expect(sourceBounds?.west).toBeLessThan(-103.2);
    expect(sourceBounds?.east).toBeGreaterThan(-103.2);

    const trafficGrid = rasterizeSourceLayer(traffic, trafficLayer, grid);
    const facilityGrid = rasterizeSourceLayer(facilities, facilityLayer, grid);
    const hazard = combineWeightedStudyGrids([trafficGrid, facilityGrid]);

    expect(trafficGrid.sampleCount).toBeGreaterThan(1);
    expect(facilityGrid.sampleCount).toBe(1);
    expect(hazard).not.toBeNull();
    expect(hazard!.max).toBeGreaterThan(0);

    const validation = validateStudyGrid(hazard!, hazard!);
    expect(validation.n).toBe(hazard!.values.length);
    expect(validation.rmse).toBe(0);
  });

  it("ranks sensor-siting candidates from an existing study grid", () => {
    const study = createStudyAreaFromSensors(samplePasCollection, {
      resolutionMeters: 1_000,
      sensorFilters: { isOutside: true },
      sensorValueField: "pm25_1hr",
    });
    const observed = computeObservedStudyGrid(samplePasCollection, study, { maxCells: 900 });
    const candidates = rankSensorSitingCandidates(observed, samplePasCollection.records, {
      candidateCount: 5,
      minSpacingKm: 0.25,
    });

    expect(candidates).toHaveLength(5);
    expect(candidates[0].rank).toBe(1);
    expect(candidates.every((candidate) => candidate.score >= 0 && candidate.score <= 1)).toBe(true);
    expect(candidates.every((candidate) => candidate.latitude >= observed.bounds.south && candidate.latitude <= observed.bounds.north)).toBe(true);
    expect(candidates.every((candidate) => candidate.longitude >= observed.bounds.west && candidate.longitude <= observed.bounds.east)).toBe(true);
  });
});

describe("modeling feature and benchmark helpers", () => {
  it("builds snapshot feature rows from PAS records", () => {
    const table = buildPasSnapshotFeatureTable(samplePasCollection, { pm25Field: "pm25_1hr" });
    expect(table.rows.length).toBeGreaterThan(0);
    expect(table.featureNames).toContain("hourSin");
    expect(table.rows.every((row) => Number.isFinite(row.latitude) && Number.isFinite(row.longitude))).toBe(true);
    expect(table.rows.every((row) => row.pm25Field === "pm25_1hr")).toBe(true);
  });

  it("evaluates regression predictions and Pearson calibration gates", () => {
    const predictions = [
      { observed: 10, predicted: 11 },
      { observed: 20, predicted: 19 },
      { observed: 30, predicted: 31 },
      { observed: null, predicted: 31 },
    ];
    const metrics = evaluateRegressionPredictions(predictions);
    const gate = assessPearsonCalibrationGate(predictions, 0.7);

    expect(metrics.n).toBe(3);
    expect(metrics.rmse).toBeGreaterThan(0);
    expect(gate.n).toBe(3);
    expect(gate.passes).toBe(true);
  });

  it("aggregates model runs by RMSE for comparison tables", () => {
    const firstMetrics = evaluateRegressionPredictions([
      { observed: 1, predicted: 1.1 },
      { observed: 2, predicted: 2.1 },
      { observed: 3, predicted: 3.1 },
    ]);
    const secondMetrics = evaluateRegressionPredictions([
      { observed: 1, predicted: 1.5 },
      { observed: 2, predicted: 2.5 },
      { observed: 3, predicted: 3.5 },
    ]);
    const aggregate = aggregateModelRuns([
      { modelId: "rf", modelLabel: "Random Forest", splitId: "sensor-holdout-a", metrics: secondMetrics, durationMs: 100 },
      { modelId: "xgb", modelLabel: "XGBoost", splitId: "sensor-holdout-a", metrics: firstMetrics, durationMs: 80 },
      { modelId: "xgb", modelLabel: "XGBoost", splitId: "sensor-holdout-b", metrics: firstMetrics, durationMs: 120 },
    ]);

    expect(aggregate[0].modelId).toBe("xgb");
    expect(aggregate[0].runs).toBe(2);
    expect(aggregate[0].durationMsMean).toBe(100);
    expect(aggregate[0].rmseStdDev).toBe(0);
  });
});

describe("Bayesian outcome-linkage model", () => {
  function makeLinearData(
    n: number,
    intercept: number,
    slope: number,
    noiseSd: number,
    seed: number,
  ): BayesianLinearObservation[] {
    // Deterministic mulberry32 + Box-Muller so tests stay reproducible.
    let a = seed >>> 0;
    const rand = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const noise = () => {
      let u = 0;
      let v = 0;
      while (u === 0) u = rand();
      while (v === 0) v = rand();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    const out: BayesianLinearObservation[] = [];
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 10 - 5;
      const y = intercept + slope * x + noiseSd * noise();
      out.push({ id: `obs-${i}`, y, x: [x] });
    }
    return out;
  }

  it("recovers known coefficients with 95% credible intervals", () => {
    const data = makeLinearData(120, /* intercept */ 2, /* slope */ 1.5, /* noise */ 0.5, 7);
    const fit = fitBayesianLinearModel(data, {
      label: "linear",
      seed: 11,
      posteriorSamples: 600,
      covariateNames: ["x"],
    });

    expect(fit.n).toBe(120);
    expect(fit.k).toBe(2);
    expect(fit.covariateNames).toEqual(["(Intercept)", "x"]);
    const intercept = fit.coefficients[0];
    const slope = fit.coefficients[1];
    expect(Math.abs(intercept.mean - 2)).toBeLessThan(0.2);
    expect(Math.abs(slope.mean - 1.5)).toBeLessThan(0.05);
    expect(intercept.p025).toBeLessThan(intercept.mean);
    expect(intercept.p975).toBeGreaterThan(intercept.mean);
    expect(slope.p025).toBeLessThan(1.5);
    expect(slope.p975).toBeGreaterThan(1.5);
    expect(fit.sigmaMean).toBeGreaterThan(0.3);
    expect(fit.sigmaMean).toBeLessThan(0.8);
    expect(fit.rSquared).not.toBeNull();
    expect(fit.rSquared!).toBeGreaterThan(0.95);
    expect(fit.rmse).toBeGreaterThan(0);
    expect(Number.isFinite(fit.waic)).toBe(true);
    expect(Number.isFinite(fit.lppd)).toBe(true);
    expect(fit.pWaic).toBeGreaterThan(0);
    expect(fit.waicSe).toBeGreaterThanOrEqual(0);
    expect(fit.fitted).toHaveLength(120);
    expect(fit.residuals).toHaveLength(120);
  });

  it("prefers covariate model over intercept-only via lower WAIC", () => {
    const data = makeLinearData(80, /* intercept */ 0, /* slope */ 2, /* noise */ 0.5, 17);
    const interceptOnly = fitBayesianLinearModel(
      data.map((d) => ({ ...d, x: [] })),
      { label: "intercept-only", seed: 3, posteriorSamples: 500 },
    );
    const linear = fitBayesianLinearModel(data, {
      label: "linear",
      seed: 3,
      posteriorSamples: 500,
      covariateNames: ["x"],
    });

    expect(linear.waic).toBeLessThan(interceptOnly.waic);
    const comparison = compareBayesianModels([interceptOnly, linear]);
    expect(comparison[0].label).toBe("linear");
    expect(comparison[0].deltaWaic).toBe(0);
    expect(comparison[1].label).toBe("intercept-only");
    expect(comparison[1].deltaWaic).toBeGreaterThan(0);
    expect(comparison[0].weight).toBeGreaterThan(comparison[1].weight);
    expect(Math.abs(comparison[0].weight + comparison[1].weight - 1)).toBeLessThan(1e-6);
  });

  it("supports county fixed-effect dummies via groupColumns='fixed-effects'", () => {
    // Two counties with different baselines but the same slope.
    const baseA = makeLinearData(40, 0, 1, 0.4, 21).map<BayesianLinearObservation>((d) => ({
      ...d,
      groupId: "county-A",
    }));
    const baseB = makeLinearData(40, 5, 1, 0.4, 23).map<BayesianLinearObservation>((d) => ({
      ...d,
      groupId: "county-B",
    }));
    const data = [...baseA, ...baseB];

    const pooled = fitBayesianLinearModel(data, {
      label: "pooled",
      seed: 5,
      posteriorSamples: 400,
      covariateNames: ["x"],
    });
    const fixedEffects = fitBayesianLinearModel(data, {
      label: "county-fixed",
      seed: 5,
      posteriorSamples: 400,
      groupColumns: "fixed-effects",
      covariateNames: ["x"],
    });

    expect(fixedEffects.k).toBe(pooled.k + 1);
    expect(fixedEffects.covariateNames).toContain("group=county-B");
    // The county dummy should pick up roughly the +5 baseline shift.
    const countyB = fixedEffects.coefficients.find((c) => c.name === "group=county-B");
    expect(countyB).toBeDefined();
    expect(Math.abs(countyB!.mean - 5)).toBeLessThan(0.4);
    expect(fixedEffects.waic).toBeLessThan(pooled.waic);

    const comparison = compareBayesianModels([pooled, fixedEffects]);
    expect(comparison[0].label).toBe("county-fixed");
    expect(comparison[0].weight).toBeGreaterThan(0.95);
  });

  it("throws on empty observation set", () => {
    expect(() => fitBayesianLinearModel([])).toThrow(/no usable observations/i);
  });

  it("returns sorted comparison with single-model edge case", () => {
    const data = makeLinearData(30, 1, 0.5, 0.3, 99);
    const fit = fitBayesianLinearModel(data, { label: "single", seed: 1, posteriorSamples: 200 });
    const cmp = compareBayesianModels([fit]);
    expect(cmp).toHaveLength(1);
    expect(cmp[0].deltaWaic).toBe(0);
    expect(cmp[0].weight).toBeCloseTo(1, 6);
  });
});
