import { afterEach, describe, expect, it, vi } from "vitest";

import type { InterpolationGrid } from "@patool/shared";

import { deriveHeatmapRenderDimensions, paintInterpolationCanvas } from "./interpolation";

describe("map interpolation rendering", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("supersamples modest heatmap grids for smoother high-zoom rendering", () => {
    expect(deriveHeatmapRenderDimensions({ width: 100, height: 50 })).toEqual({
      width: 300,
      height: 150,
      scale: 3,
    });
  });

  it("caps supersampled heatmap dimensions for large grids", () => {
    expect(deriveHeatmapRenderDimensions({ width: 384, height: 312 })).toEqual({
      width: 768,
      height: 624,
      scale: 2,
    });
  });

  it("paints the supersampled canvas instead of the source grid dimensions", () => {
    const createImageData = vi.fn((width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
    }));
    const putImageData = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ({
      createImageData,
      putImageData,
    }) as unknown as CanvasRenderingContext2D);

    const canvas = document.createElement("canvas");
    const grid: InterpolationGrid = {
      width: 4,
      height: 4,
      bounds: { west: 0, east: 1, south: 0, north: 1 },
      values: new Float64Array([
        1, 1, 1, 1,
        1, 80, 80, 1,
        1, 80, 80, 1,
        1, 1, 1, 1,
      ]),
      min: 1,
      max: 80,
    };

    const durationMs = paintInterpolationCanvas(grid, canvas);

    expect(durationMs).toBeGreaterThanOrEqual(0);
    expect(canvas.width).toBe(12);
    expect(canvas.height).toBe(12);
    expect(createImageData).toHaveBeenCalledWith(12, 12);
    expect(putImageData).toHaveBeenCalledOnce();
  });
});
