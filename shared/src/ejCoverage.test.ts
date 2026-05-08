import { describe, expect, it } from "vitest";

import {
  computeCoverageGapReport,
  parseEjAreaCsv,
  type EjAreaUnit,
  type EjSensor,
} from "./ejCoverage";

const seed: EjAreaUnit[] = [
  // Tract A: faraway, no sensors, very high EJ → biggest gap.
  { id: "A", label: "A", longitude: -122.00, latitude: 47.40, population: 10000, ejIndex: 95 },
  // Tract B: collocated with sensors, low EJ → smallest gap.
  { id: "B", label: "B", longitude: -122.32, latitude: 47.62, population: 5000, ejIndex: 30 },
  // Tract C: faraway, no sensors, moderate EJ → middle gap.
  { id: "C", label: "C", longitude: -121.80, latitude: 47.20, population: 8000, ejIndex: 60 },
];

const sensors: EjSensor[] = [
  { id: "s1", longitude: -122.32, latitude: 47.62 },
  { id: "s2", longitude: -122.33, latitude: 47.61 },
];

describe("EJ coverage gap analysis", () => {
  it("ranks low-coverage / high-EJ tracts at the top of the report", () => {
    const report = computeCoverageGapReport(seed, sensors, { radiusKm: 3 });
    expect(report.rows[0].unit.id).toBe("A");
    expect(report.rows.find((row) => row.unit.id === "B")?.sensorCount).toBeGreaterThanOrEqual(1);
    expect(report.totalPopulation).toBe(23000);
    expect(report.coveredPopulation).toBe(5000); // only B is within radius
    expect(report.uncoveredPopulation).toBe(18000);
  });

  it("respects the population threshold", () => {
    const report = computeCoverageGapReport(seed, sensors, { radiusKm: 3, minPopulation: 6000 });
    expect(report.rows.find((row) => row.unit.id === "B")).toBeUndefined();
  });

  it("parses an EJ tract CSV", () => {
    const text = [
      "id,label,latitude,longitude,population,ejIndex,lowIncomeFraction",
      "T1,Downtown,47.6,-122.3,12000,80,0.4",
      "T2,Beacon,47.58,-122.32,8000,55,0.3",
    ].join("\n");
    const rows = parseEjAreaCsv(text);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: "T1", population: 12000, ejIndex: 80 });
  });
});
