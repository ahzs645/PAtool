import { describe, expect, it } from "vitest";

import {
  clusterTrajectories,
  parseHysplitTdump,
  trajectoryLevel,
  type HysplitTrajectory,
} from "./hysplitTrajectory";

const TDUMP_SAMPLE = `     1     1
     1     gdas1
     2
    25  3  1  0   49.2   -123.0  10.0
    25  3  2  0   49.4   -123.5  10.0
PRESSURE
     1     1    25  3  1  0  0  0    0.0  49.2  -123.0   10.0  1000.0
     1     1    25  3  1  0  0  0   -1.0  49.3  -123.2   12.0   998.0
     1     1    25  3  1  0  0  0   -2.0  49.5  -123.4   15.0   995.0
     2     1    25  3  2  0  0  0    0.0  49.4  -123.5   10.0  1001.0
     2     1    25  3  2  0  0  0   -1.0  49.6  -123.7   12.0   999.0
     2     1    25  3  2  0  0  0   -2.0  49.8  -123.9   15.0   996.0
`;

describe("parseHysplitTdump", () => {
  it("parses two back-trajectories with three points each", () => {
    const parsed = parseHysplitTdump(TDUMP_SAMPLE);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].points).toHaveLength(3);
    expect(parsed[0].points[0].latitude).toBeCloseTo(49.2, 6);
    expect(parsed[0].points[2].pressure).toBeCloseTo(995, 6);
  });
});

describe("clusterTrajectories", () => {
  it("groups trajectories with similar shapes into the same cluster", () => {
    const a: HysplitTrajectory = {
      id: 1,
      startTimestamp: "2025-01-01T00:00:00Z",
      startLatitude: 49,
      startLongitude: -123,
      points: [
        { trajectoryId: 1, ageHours: 0,  timestamp: "2025-01-01T00:00:00Z", latitude: 49,   longitude: -123, height: 100 },
        { trajectoryId: 1, ageHours: -6, timestamp: "2025-01-01T-6:00:00Z", latitude: 50,   longitude: -125, height: 200 },
        { trajectoryId: 1, ageHours: -12,timestamp: "2025-01-01T-12:00:00Z",latitude: 51,   longitude: -127, height: 400 },
      ],
    };
    const b: HysplitTrajectory = { ...a, id: 2 };
    const c: HysplitTrajectory = {
      id: 3,
      startTimestamp: "2025-01-01T00:00:00Z",
      startLatitude: 49,
      startLongitude: -123,
      points: [
        { trajectoryId: 3, ageHours: 0,  timestamp: "2025-01-01T00:00:00Z", latitude: 49, longitude: -123, height: 100 },
        { trajectoryId: 3, ageHours: -6, timestamp: "2025-01-01T-6:00:00Z", latitude: 47, longitude: -120, height: 50 },
        { trajectoryId: 3, ageHours: -12,timestamp: "2025-01-01T-12:00:00Z",latitude: 45, longitude: -117, height: 20 },
      ],
    };
    const clusters = clusterTrajectories([a, b, c], { k: 2, seed: 1, sampleCount: 3 });
    expect(clusters).toHaveLength(2);
    const aAndBCluster = clusters.find((cluster) => cluster.trajectoryIds.includes(1) && cluster.trajectoryIds.includes(2));
    expect(aAndBCluster).toBeDefined();
    expect(aAndBCluster!.trajectoryIds).not.toContain(3);
  });
});

describe("trajectoryLevel", () => {
  it("bins pollutant values into grid cells visited by trajectories", () => {
    const trajectory: HysplitTrajectory = {
      id: 1,
      startTimestamp: "2025-01-01T00:00:00Z",
      startLatitude: 49,
      startLongitude: -123,
      points: [
        { trajectoryId: 1, ageHours: 0,  timestamp: "t", latitude: 49.4, longitude: -123.7, height: 100 },
        { trajectoryId: 1, ageHours: -6, timestamp: "t", latitude: 50.3, longitude: -125.2, height: 200 },
      ],
    };
    const pollutant = new Map<number, number>([[1, 25]]);
    const cells = trajectoryLevel([trajectory], pollutant, { latStep: 1, lonStep: 1 });
    expect(cells.length).toBeGreaterThanOrEqual(2);
    for (const cell of cells) {
      expect(cell.value).toBeCloseTo(25, 6);
      expect(cell.count).toBe(1);
    }
  });
});
