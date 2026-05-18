import { describe, expect, it } from "vitest";

import {
  climateStratifiedEvaluation,
  intraSensorCv,
  lookupSdfsParameter,
  SDFS_PARAMETERS,
  targetDiagram,
  validateDeployment,
} from "./sensortoolkit";

describe("DeploymentRecord schema", () => {
  it("validates a well-formed deployment record", () => {
    const record = validateDeployment({
      deploymentId: "DEP-001",
      siteName: "Vancouver-Burrard",
      periodStart: "2025-04-01T00:00:00Z",
      periodEnd: "2025-05-01T00:00:00Z",
      sensors: [{ id: "PA-1234", parameter: "PM2.5", parameterUnits: "ug/m3" }],
    });
    expect(record.sensors).toHaveLength(1);
    expect(record.references).toEqual([]);
  });

  it("rejects deployments missing a sensor", () => {
    expect(() => validateDeployment({
      deploymentId: "DEP-002",
      siteName: "Empty",
      periodStart: "2025-04-01",
      periodEnd: "2025-05-01",
      sensors: [],
    })).toThrow();
  });
});

describe("intraSensorCv", () => {
  it("computes a 0% CV for a perfectly collocated cohort", () => {
    const readings = [
      { timestamp: "2025-04-01T00:00:00Z", sensorId: "A", value: 10 },
      { timestamp: "2025-04-01T00:00:00Z", sensorId: "B", value: 10 },
      { timestamp: "2025-04-01T01:00:00Z", sensorId: "A", value: 12 },
      { timestamp: "2025-04-01T01:00:00Z", sensorId: "B", value: 12 },
    ];
    const summary = intraSensorCv(readings);
    expect(summary.pointCount).toBe(2);
    expect(summary.meanCvPercent).toBeCloseTo(0, 6);
    expect(summary.cohort).toEqual(["A", "B"]);
  });

  it("rises with cohort disagreement", () => {
    const readings = [
      { timestamp: "2025-04-01T00:00:00Z", sensorId: "A", value: 10 },
      { timestamp: "2025-04-01T00:00:00Z", sensorId: "B", value: 20 },
    ];
    const summary = intraSensorCv(readings);
    expect(summary.meanCvPercent).toBeGreaterThan(40);
  });
});

describe("climateStratifiedEvaluation", () => {
  it("computes a fit per temperature and RH band", () => {
    const records = Array.from({ length: 200 }, (_, i) => ({
      observed: i,
      predicted: i + 1,
      temperatureF: 30 + (i % 60),
      humidityPercent: 20 + (i % 80),
    }));
    const bins = climateStratifiedEvaluation(records);
    expect(bins.length).toBe(5 + 4); // default 5 temp + 4 RH bands
    const temperatureBin = bins.find((bin) => bin.variable === "temperatureF" && bin.low === 70);
    expect(temperatureBin?.n).toBeGreaterThan(0);
    expect(temperatureBin?.r2).toBeCloseTo(1, 6);
    expect(temperatureBin?.bias).toBeCloseTo(1, 6);
  });
});

describe("SDFS parameter dictionary", () => {
  it("includes PM2.5 with the AQS 88101 code", () => {
    const pm25 = lookupSdfsParameter("PM25");
    expect(pm25?.aqsParameterCode).toBe("88101");
    expect(pm25?.unit).toBe("ug/m3");
  });

  it("is case-insensitive for lookups and contains the canonical AQ parameters", () => {
    expect(lookupSdfsParameter("o3")?.aqsParameterCode).toBe("44201");
    expect(lookupSdfsParameter("temp")?.unit).toBe("F");
    expect(SDFS_PARAMETERS.length).toBeGreaterThanOrEqual(14);
  });
});

describe("targetDiagram", () => {
  it("places a perfect model at the origin", () => {
    const observed = [1, 2, 3, 4, 5];
    const result = targetDiagram(observed, [{ label: "ideal", predicted: observed }]);
    expect(result[0].normalizedBias).toBeCloseTo(0, 6);
    expect(result[0].signedNormalizedCenteredRmse).toBeCloseTo(0, 6);
    expect(result[0].totalRmseNormalized).toBeCloseTo(0, 6);
  });

  it("captures a constant positive bias on the Y-axis only", () => {
    const observed = [1, 2, 3, 4, 5];
    const result = targetDiagram(observed, [{ label: "biased", predicted: observed.map((v) => v + 2) }]);
    expect(result[0].normalizedBias).toBeGreaterThan(0);
    expect(Math.abs(result[0].signedNormalizedCenteredRmse)).toBeLessThan(1e-6);
  });
});
