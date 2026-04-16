import type { InterpolationGrid, InterpolationMethod, InterpolationPoint } from "@patool/shared";

export type InterpolationBounds = InterpolationGrid["bounds"];

export type InterpolationWorkerRequest = {
  jobId: number;
  method: InterpolationMethod;
  points: InterpolationPoint[];
  bounds: InterpolationBounds;
  gridWidth: number;
  gridHeight: number;
  idwPower: number;
};

export type SerializedInterpolationGrid = Omit<InterpolationGrid, "values"> & {
  values: ArrayBufferLike;
};

export type InterpolationWorkerSuccess = {
  jobId: number;
  ok: true;
  durationMs: number;
  result: SerializedInterpolationGrid;
};

export type InterpolationWorkerFailure = {
  jobId: number;
  ok: false;
  durationMs: number;
  error: string;
};

export type InterpolationWorkerResponse =
  | InterpolationWorkerSuccess
  | InterpolationWorkerFailure;
