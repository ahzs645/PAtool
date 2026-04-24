import { describe, expect, it } from "vitest";

import {
  MODEL_ZOO_MODEL_IDS,
  buildModelZooReport,
  type ModelZooPoint,
} from "./modelZoo";

const points: ModelZooPoint[] = [
  { id: "a", x: -103.0, y: 44.0, value: 10 },
  { id: "b", x: -103.1, y: 44.0, value: 12 },
  { id: "c", x: -103.0, y: 44.1, value: 11 },
  { id: "d", x: -103.1, y: 44.1, value: 13 },
  { id: "e", x: -103.05, y: 44.05, value: 11.5 },
];

describe("model zoo report", () => {
  it("evaluates every lightweight model with leave-one-out metrics", () => {
    const report = buildModelZooReport(points, { includePredictions: true });

    expect(report.pointsUsed).toBe(points.length);
    expect(report.pointsDropped).toBe(0);
    expect(report.models.map((model) => model.modelId)).toEqual([...MODEL_ZOO_MODEL_IDS]);

    for (const model of report.models) {
      expect(model.metrics.n).toBe(points.length);
      expect(model.predictions).toHaveLength(points.length);
      expect(model.metrics.rmse).toBeGreaterThanOrEqual(0);
      expect(model.metrics.mae).toBeGreaterThanOrEqual(0);
      expect(model.metrics.smape).toBeGreaterThanOrEqual(0);
      expect(model.metrics.rSquared).not.toBeNull();
      expect(model.notes.join(" ")).toMatch(/leave-one-out|deterministic|Approximation|ordinary-kriging|mean/i);
    }
  });

  it("drops invalid points and can limit the requested model list", () => {
    const report = buildModelZooReport(
      [
        ...points,
        { id: "bad", x: Number.NaN, y: 44.2, value: 20 },
      ],
      { modelIds: ["spatial-mean", "IDW"] },
    );

    expect(report.pointsUsed).toBe(points.length);
    expect(report.pointsDropped).toBe(1);
    expect(report.models.map((model) => model.modelId)).toEqual(["spatial-mean", "IDW"]);
    expect(report.models.every((model) => model.predictions.length === 0)).toBe(true);
  });

  it("reports infeasible models honestly for very small datasets", () => {
    const report = buildModelZooReport(points.slice(0, 2), {
      modelIds: ["spatial-mean", "ordinary-kriging", "RFSI-lite"],
    });

    expect(report.models.find((model) => model.modelId === "spatial-mean")?.metrics.n).toBe(2);
    expect(report.models.find((model) => model.modelId === "ordinary-kriging")?.metrics.n).toBe(0);
    expect(report.models.find((model) => model.modelId === "ordinary-kriging")?.metrics.rmse).toBeNull();
    expect(report.models.find((model) => model.modelId === "RFSI-lite")?.notes.join(" ")).toContain("Skipped");
  });
});
