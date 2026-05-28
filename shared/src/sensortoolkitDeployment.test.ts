import { describe, expect, it } from "vitest";

import {
  coefficientOfVariation,
  emptyDeploymentDictionary,
  summarizeCv,
  summarizeDeployment,
  type DeploymentDictionary,
} from "./sensortoolkitDeployment";

describe("sensortoolkit deployment schema", () => {
  it("summarizes a deployment dictionary into report rows", () => {
    const dict: DeploymentDictionary = {
      ...emptyDeploymentDictionary("PM25-Camp1", "pm25"),
      entries: [{
        groupId: "G1",
        sensors: [{ id: "s1", make: "PurpleAir", model: "PA-II" }, { id: "s2", make: "PurpleAir", model: "PA-II" }],
        referenceMonitors: [{ id: "r1", make: "Teledyne", model: "T640", pollutant: "pm25", units: "ug/m3" }],
        deploymentPeriod: { start: "2024-01-01", end: "2024-03-31" },
        siteName: "Burbank",
      }],
    };
    const rows = summarizeDeployment(dict);
    expect(rows).toHaveLength(2);
    expect(rows[0].referenceMakeModel).toBe("Teledyne T640");
  });

  it("computes CV across collocated sensors", () => {
    const datetime = ["t0", "t1", "t2"];
    const series = coefficientOfVariation(datetime, [
      [10, 10, 10],
      [11, 11, 11],
      [9,  9,  9],
    ]);
    expect(series.cv.every((v) => v !== null && v < 15)).toBe(true);
    const s = summarizeCv(series);
    expect(s.n).toBe(3);
    expect(s.max).toBeLessThan(20);
  });

  it("returns null where too few sensors", () => {
    const series = coefficientOfVariation(["t0"], [[10], [null]], { minSensors: 2 });
    expect(series.cv[0]).toBeNull();
  });
});
