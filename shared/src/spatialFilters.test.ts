import { describe, expect, it } from "vitest";

import {
  filterSensorsByBoundingBox,
  filterSensorsByPolygon,
  filterSensorsWithinRadius,
  haversineKm,
  nearestSensor,
} from "./spatialFilters";

const sensors = [
  { id: "a", latitude: 47.6, longitude: -122.3 }, // Seattle
  { id: "b", latitude: 33.8, longitude: -117.9 }, // SoCal
  { id: "c", latitude: 40.7, longitude: -74.0 },  // NY
];

describe("spatial filters", () => {
  it("bounding-box restricts to west coast", () => {
    const r = filterSensorsByBoundingBox(sensors, { minX: -125, minY: 30, maxX: -115, maxY: 50 });
    expect(r.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("polygon catches Seattle", () => {
    const polygon = [
      { x: -123, y: 47 }, { x: -122, y: 47 }, { x: -122, y: 48 }, { x: -123, y: 48 },
    ];
    const r = filterSensorsByPolygon(sensors, polygon);
    expect(r.map((s) => s.id)).toEqual(["a"]);
  });

  it("filterSensorsWithinRadius returns within km", () => {
    const r = filterSensorsWithinRadius(sensors, 47.6, -122.3, 200);
    expect(r[0].sensor.id).toBe("a");
  });

  it("nearestSensor picks the closest", () => {
    const r = nearestSensor(sensors, 40, -74);
    expect(r?.sensor.id).toBe("c");
  });

  it("haversine is symmetric", () => {
    const ab = haversineKm(47.6, -122.3, 33.8, -117.9);
    const ba = haversineKm(33.8, -117.9, 47.6, -122.3);
    expect(ab).toBeCloseTo(ba, 6);
  });
});
