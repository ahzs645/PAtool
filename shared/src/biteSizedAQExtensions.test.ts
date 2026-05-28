import { describe, expect, it } from "vitest";

import { aggregateToAdminUnits, type RasterCell } from "./netcdfAdminAggregation";
import { humanCentricMetrics } from "./humanCentricMetrics";
import { paleoFoldAboveBaseline, paleoTimeline } from "./paleoClimatology";
import { coExposureScore } from "./pollenCoExposure";

describe("biteSizedAQ extensions", () => {
  it("human-centric metrics rise monotonically with PM2.5", () => {
    const low = humanCentricMetrics({ pm25Annual: 8 });
    const high = humanCentricMetrics({ pm25Annual: 40 });
    expect(high.fev1PercentLoss).toBeGreaterThan(low.fev1PercentLoss);
    expect(high.childhoodIqPointLoss).toBeGreaterThan(0);
  });

  it("paleo fold puts modern WHO target at ~5/3 of holocene", () => {
    expect(paleoFoldAboveBaseline(5)).toBeCloseTo(5 / 3, 6);
    expect(paleoTimeline().length).toBeGreaterThanOrEqual(4);
  });

  it("co-exposure score escalates with pollen and PM", () => {
    const score = coExposureScore(40, [
      { category: "tree", index: 1200 },
      { category: "grass", index: 800 },
    ]);
    expect(score.coExposureScore).toBeGreaterThan(0);
    expect(score.warningLevel).not.toBe("low");
  });

  it("netcdf-style admin aggregation captures cells in polygon", () => {
    const cells: RasterCell[] = [
      { lat: 0.5, lon: 0.5, value: 10, populationWeight: 1 },
      { lat: 0.5, lon: 1.5, value: 20, populationWeight: 1 },
      { lat: 5.0, lon: 5.0, value: 999 },
    ];
    const units = [{
      uid: "U1",
      polygon: [
        { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 0, y: 1 },
      ],
    }];
    const res = aggregateToAdminUnits(cells, units);
    expect(res.rows[0].cellsCaptured).toBe(2);
    expect(res.rows[0].populationWeightedValue).toBeCloseTo(15, 6);
  });
});
