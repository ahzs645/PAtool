import { describe, expect, it } from "vitest";

import {
  importTraj,
  trajCluster,
  trajLevel,
  trajPlot,
  type Trajectory,
} from "./openairTrajectories";

function fixture(): Trajectory[] {
  const rows: Array<Record<string, unknown>> = [];
  for (let arr = 0; arr < 6; arr += 1) {
    for (let h = 0; h < 6; h += 1) {
      rows.push({
        receptor: "ABC",
        date: `2024-06-${String(arr + 1).padStart(2, "0")}T00:00:00Z`,
        hour_inc: -h,
        lat: 49 + h * 0.1 + (arr < 3 ? 0 : 1),
        lon: -123 - h * 0.2,
      });
    }
  }
  return importTraj(rows);
}

describe("openair trajectories", () => {
  it("importTraj groups by receptor and arrival", () => {
    const trajs = fixture();
    expect(trajs).toHaveLength(6);
    expect(trajs[0].points).toHaveLength(6);
  });

  it("trajCluster partitions the two limbs", () => {
    const trajs = fixture();
    const result = trajCluster(trajs, 2);
    expect(result.clusters).toHaveLength(2);
    expect(result.clusters[0].size + result.clusters[1].size).toBe(6);
  });

  it("trajLevel sums into cells with associated values", () => {
    const trajs = fixture();
    const values: Record<string, number> = {};
    trajs.forEach((t) => { values[t.id] = 12; });
    const cells = trajLevel(trajs, values, 1);
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.every((c) => c.meanValue === 12)).toBe(true);
  });

  it("trajPlot yields polylines", () => {
    const lines = trajPlot(fixture());
    expect(lines).toHaveLength(6);
    expect(lines[0].coords[0]).toHaveLength(2);
  });
});
