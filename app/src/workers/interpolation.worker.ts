/// <reference lib="webworker" />

import {
  createOrdinaryKrigingModel,
  idwInterpolate,
  interpolateOrdinaryKrigingModel,
  type InterpolationGrid,
  type OrdinaryKrigingModel,
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

type CachedKrigingModel = {
  key: string;
  model: OrdinaryKrigingModel;
};

let cachedKrigingModel: CachedKrigingModel | null = null;

function getKrigingModelKey(points: InterpolationWorkerRequest["points"]): string {
  return points
    .map((point) => (
      `${point.id ?? ""}:${point.x.toFixed(6)},${point.y.toFixed(6)},${point.value.toFixed(4)}`
    ))
    .join("|");
}

function getKrigingModel(points: InterpolationWorkerRequest["points"]): OrdinaryKrigingModel {
  const key = getKrigingModelKey(points);
  if (cachedKrigingModel?.key === key) {
    return cachedKrigingModel.model;
  }

  const model = createOrdinaryKrigingModel(points);
  cachedKrigingModel = { key, model };
  return model;
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
      : interpolateOrdinaryKrigingModel(
        getKrigingModel(points),
        gridWidth,
        gridHeight,
        bounds,
        krigingMaxNeighbors,
        krigingTileSize,
      );

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
