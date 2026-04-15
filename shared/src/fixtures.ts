import type { PasCollection, PatSeries, SensorRecord } from "./domain";

import examplePasCollectionJson from "./generated/example_pas.collection.json";
import examplePasRawJson from "./generated/example_pas_raw.raw.json";
import examplePatJson from "./generated/example_pat.series.json";
import examplePatFailureAJson from "./generated/example_pat_failure_A.series.json";
import examplePatFailureBJson from "./generated/example_pat_failure_B.series.json";
import exampleSensorRawJson from "./generated/example_sensor.raw.json";

export const samplePasCollection = examplePasCollectionJson as PasCollection;
export const samplePasRawRecords = examplePasRawJson as Record<string, unknown>[];
export const samplePatSeries = examplePatJson as PatSeries;
export const samplePatFailureA = examplePatFailureAJson as PatSeries;
export const samplePatFailureB = examplePatFailureBJson as PatSeries;
export const sampleSensorRaw = exampleSensorRawJson as Record<string, unknown>;
export const sampleSensorRecord: SensorRecord = {
  id: samplePatSeries.meta.sensorId,
  meta: samplePatSeries.meta,
  latest: samplePatSeries.points.at(-1) ?? samplePatSeries.points[0]
};
