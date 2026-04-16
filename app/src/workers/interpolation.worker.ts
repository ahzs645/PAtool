/// <reference lib="webworker" />

import {
  idwInterpolate,
  ordinaryKrigingInterpolate,
  type InterpolationGrid,
} from "@patool/shared";

import type {
  InterpolationWorkerRequest,
  InterpolationWorkerResponse,
  SerializedInterpolationGrid,
} from "../lib/interpolationProtocol";

function serializeGrid(grid: InterpolationGrid): SerializedInterpolationGrid {
  return {
    ...grid,
    values: grid.values.buffer,
  };
}

self.onmessage = (event: MessageEvent<InterpolationWorkerRequest>) => {
  const startedAt = performance.now();
  const {
    jobId,
    method,
    points,
    bounds,
    gridWidth,
    gridHeight,
    idwPower,
    krigingMaxNeighbors,
    krigingTileSize,
  } = event.data;

  try {
    const result = method === "idw"
      ? idwInterpolate(points, gridWidth, gridHeight, bounds, idwPower)
      : ordinaryKrigingInterpolate(points, gridWidth, gridHeight, bounds, krigingMaxNeighbors, krigingTileSize);

    const serialized = serializeGrid(result);
    const response: InterpolationWorkerResponse = {
      jobId,
      ok: true,
      durationMs: performance.now() - startedAt,
      result: serialized,
    };

    self.postMessage(response, [serialized.values]);
  } catch (error) {
    const response: InterpolationWorkerResponse = {
      jobId,
      ok: false,
      durationMs: performance.now() - startedAt,
      error: error instanceof Error ? error.message : "Interpolation failed",
    };

    self.postMessage(response);
  }
};

export {};
