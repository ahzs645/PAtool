import { describe, expect, it } from "vitest";

import {
  aggregatePopulationWeightedPollutant,
  type AdminUnit,
  type GeoGrid,
} from "./popWeightedAggregator";

const pollutant: GeoGrid = {
  values: [10, 20, 30, 40],
  nRows: 2,
  nCols: 2,
  originLatitude: 49,
  originLongitude: -123,
  cellSizeLatitude: 1,
  cellSizeLongitude: 1,
};

const population: GeoGrid = {
  values: [100, 100, 100, 1000],
  nRows: 2,
  nCols: 2,
  originLatitude: 49,
  originLongitude: -123,
  cellSizeLatitude: 1,
  cellSizeLongitude: 1,
};

const unit: AdminUnit = {
  id: "test",
  polygon: [
    { latitude: 49, longitude: -123 },
    { latitude: 49, longitude: -121 },
    { latitude: 51, longitude: -121 },
    { latitude: 51, longitude: -123 },
  ],
};

describe("aggregatePopulationWeightedPollutant", () => {
  it("returns the population-weighted mean when population is supplied", () => {
    const out = aggregatePopulationWeightedPollutant(pollutant, population, [unit]);
    expect(out).toHaveLength(1);
    expect(out[0].cellCount).toBe(4);
    // (10*100 + 20*100 + 30*100 + 40*1000) / 1300 = 35.385
    expect(out[0].populationWeightedMean).toBeCloseTo(35.385, 3);
    expect(out[0].unweightedMean).toBeCloseTo(25, 6);
  });

  it("falls back to an unweighted mean when no population grid is supplied", () => {
    const out = aggregatePopulationWeightedPollutant(pollutant, null, [unit]);
    expect(out[0].populationWeightedMean).toBeCloseTo(25, 6);
    expect(out[0].totalPopulation).toBe(0);
  });
});
