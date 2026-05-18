// ---------------------------------------------------------------------------
// sensortoolkit — TS analogues of the US-EPA `sensortoolkit` reference
// library:
//   - deployment metadata schemas (sensor, reference monitor, deploy_dict)
//   - intra-sensor CV for collocated identical units (precision)
//   - climate-stratified metric evaluation (temp / RH bins)
//   - SDFS standardized parameter dictionary with AQS unit codes
//   - target-diagram statistics (normalized bias + normalized centered RMSE)
//
// Pure functions; algorithms re-derived from EPA's published Performance
// Targets Reports (PM2.5 2021, O3 2021).
// ---------------------------------------------------------------------------

import { z } from "zod";

import { linearFit, type MeasurementPair } from "./measurementError";
import { modStats } from "./openairStats";

// ---------------------------------------------------------------------------
// Deployment metadata
// ---------------------------------------------------------------------------

export const AirSensorMetadataSchema = z.object({
  id: z.string().min(1),
  make: z.string().optional(),
  model: z.string().optional(),
  firmwareVersion: z.string().optional(),
  parameter: z.string().min(1),         // e.g. "PM2.5"
  parameterUnits: z.string().min(1),    // e.g. "ug/m3"
  serialNumber: z.string().optional(),
  notes: z.string().optional(),
});

export const ReferenceMonitorMetadataSchema = z.object({
  id: z.string().min(1),
  agency: z.string().optional(),
  siteName: z.string().optional(),
  aqsSiteId: z.string().optional(),
  parameter: z.string().min(1),
  parameterUnits: z.string().min(1),
  method: z.string().optional(),        // e.g. "FRM/FEM"
  notes: z.string().optional(),
});

export const DeploymentRecordSchema = z.object({
  deploymentId: z.string().min(1),
  siteName: z.string().min(1),
  siteAqsId: z.string().optional(),
  contact: z.object({
    name: z.string().optional(),
    email: z.string().email().optional(),
    organization: z.string().optional(),
  }).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  elevationMeters: z.number().optional(),
  periodStart: z.string().min(1),       // ISO date-time
  periodEnd: z.string().min(1),
  temperatureRangeF: z.tuple([z.number(), z.number()]).optional(),
  humidityRangePercent: z.tuple([z.number(), z.number()]).optional(),
  sensors: z.array(AirSensorMetadataSchema).min(1),
  references: z.array(ReferenceMonitorMetadataSchema).default([]),
  notes: z.string().optional(),
});

export type AirSensorMetadata = z.infer<typeof AirSensorMetadataSchema>;
export type ReferenceMonitorMetadata = z.infer<typeof ReferenceMonitorMetadataSchema>;
export type DeploymentRecord = z.infer<typeof DeploymentRecordSchema>;

export function validateDeployment(input: unknown): DeploymentRecord {
  return DeploymentRecordSchema.parse(input);
}

// ---------------------------------------------------------------------------
// Intra-sensor coefficient of variation (CV) — EPA "precision" metric for
// collocated identical units. Computed at each timestamp across the cohort
// then summarised.
// ---------------------------------------------------------------------------

export type CollocatedReading = {
  timestamp: string;
  sensorId: string;
  value: number;
};

export type IntraSensorCvPoint = {
  timestamp: string;
  n: number;
  mean: number;
  stdev: number;
  cvPercent: number;
};

export type IntraSensorCvSummary = {
  cohort: string[];
  pointCount: number;
  meanCvPercent: number;
  medianCvPercent: number;
  points: IntraSensorCvPoint[];
};

export function intraSensorCv(readings: readonly CollocatedReading[]): IntraSensorCvSummary {
  const byTimestamp = new Map<string, Map<string, number>>();
  for (const reading of readings) {
    if (!Number.isFinite(reading.value)) continue;
    const row = byTimestamp.get(reading.timestamp) ?? new Map<string, number>();
    row.set(reading.sensorId, reading.value);
    byTimestamp.set(reading.timestamp, row);
  }
  const cohort = new Set<string>();
  for (const row of byTimestamp.values()) {
    for (const id of row.keys()) cohort.add(id);
  }
  const points: IntraSensorCvPoint[] = [];
  for (const [timestamp, row] of [...byTimestamp.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const values = [...row.values()];
    if (values.length < 2) continue;
    const meanValue = values.reduce((sum, v) => sum + v, 0) / values.length;
    if (meanValue === 0) continue;
    const variance = values.reduce((sum, v) => sum + (v - meanValue) ** 2, 0) / (values.length - 1);
    const stdev = Math.sqrt(variance);
    points.push({
      timestamp,
      n: values.length,
      mean: round(meanValue, 4),
      stdev: round(stdev, 4),
      cvPercent: round((stdev / meanValue) * 100, 4),
    });
  }
  if (points.length === 0) {
    return {
      cohort: [...cohort].sort(),
      pointCount: 0,
      meanCvPercent: 0,
      medianCvPercent: 0,
      points: [],
    };
  }
  const cvs = points.map((point) => point.cvPercent);
  return {
    cohort: [...cohort].sort(),
    pointCount: points.length,
    meanCvPercent: round(cvs.reduce((sum, v) => sum + v, 0) / cvs.length, 4),
    medianCvPercent: round(quantile(cvs, 0.5), 4),
    points,
  };
}

// ---------------------------------------------------------------------------
// Climate-stratified metric evaluation
// ---------------------------------------------------------------------------

export type ClimateStratifiedRecord = {
  observed: number;
  predicted: number;
  temperatureF?: number;
  humidityPercent?: number;
};

export type ClimateBin = {
  variable: "temperatureF" | "humidityPercent";
  low: number;
  high: number;
  label: string;
  n: number;
  r2: number;
  slope: number;
  intercept: number;
  rmse: number;
  bias: number;
};

export const DEFAULT_TEMPERATURE_BINS: Array<[number, number]> = [
  [-Infinity, 32],
  [32, 50],
  [50, 70],
  [70, 90],
  [90, Infinity],
];

export const DEFAULT_HUMIDITY_BINS: Array<[number, number]> = [
  [0, 30],
  [30, 60],
  [60, 80],
  [80, 100],
];

export function climateStratifiedEvaluation(
  records: readonly ClimateStratifiedRecord[],
  options: {
    temperatureBins?: Array<[number, number]>;
    humidityBins?: Array<[number, number]>;
  } = {},
): ClimateBin[] {
  const tBins = options.temperatureBins ?? DEFAULT_TEMPERATURE_BINS;
  const hBins = options.humidityBins ?? DEFAULT_HUMIDITY_BINS;
  const out: ClimateBin[] = [];
  for (const [low, high] of tBins) {
    const subset = records.filter(
      (r) => Number.isFinite(r.temperatureF) && (r.temperatureF as number) >= low && (r.temperatureF as number) < high,
    );
    out.push(binStats("temperatureF", low, high, subset));
  }
  for (const [low, high] of hBins) {
    const subset = records.filter(
      (r) => Number.isFinite(r.humidityPercent) && (r.humidityPercent as number) >= low && (r.humidityPercent as number) < high,
    );
    out.push(binStats("humidityPercent", low, high, subset));
  }
  return out;
}

function binStats(
  variable: "temperatureF" | "humidityPercent",
  low: number,
  high: number,
  subset: readonly ClimateStratifiedRecord[],
): ClimateBin {
  const pairs: MeasurementPair[] = subset.map((row) => ({
    reference: row.observed,
    sensor: row.predicted,
  }));
  const fit = linearFit(pairs);
  return {
    variable,
    low,
    high,
    label: `${variable === "temperatureF" ? "T" : "RH"} ${formatBound(low)}–${formatBound(high)}`,
    n: fit.n,
    r2: round(fit.r2, 4),
    slope: round(fit.slope, 4),
    intercept: round(fit.intercept, 4),
    rmse: round(fit.rmse, 4),
    bias: round(fit.bias, 4),
  };
}

function formatBound(v: number): string {
  if (!Number.isFinite(v)) return v > 0 ? "∞" : "-∞";
  return v.toString();
}

// ---------------------------------------------------------------------------
// SDFS standardized parameter dictionary with AQS unit codes
// (subset of EPA's Sensor Data File Standard — the parameters most commonly
// reported by low-cost sensors and reference monitors)
// ---------------------------------------------------------------------------

export type SdfsParameter = {
  name: string;             // SDFS short name (e.g. "PM25")
  description: string;
  unit: string;             // canonical unit string
  aqsParameterCode: string; // 5-digit AQS parameter code
  aqsUnitCode: string;      // AQS unit code
};

export const SDFS_PARAMETERS: SdfsParameter[] = [
  { name: "PM1",         description: "Particulate matter < 1.0 µm",  unit: "ug/m3", aqsParameterCode: "85101", aqsUnitCode: "105" },
  { name: "PM25",        description: "Particulate matter < 2.5 µm",  unit: "ug/m3", aqsParameterCode: "88101", aqsUnitCode: "105" },
  { name: "PM10",        description: "Particulate matter < 10 µm",   unit: "ug/m3", aqsParameterCode: "81102", aqsUnitCode: "105" },
  { name: "O3",          description: "Ozone",                        unit: "ppb",   aqsParameterCode: "44201", aqsUnitCode: "008" },
  { name: "NO2",         description: "Nitrogen dioxide",             unit: "ppb",   aqsParameterCode: "42602", aqsUnitCode: "008" },
  { name: "NO",          description: "Nitric oxide",                 unit: "ppb",   aqsParameterCode: "42601", aqsUnitCode: "008" },
  { name: "NOx",         description: "Total reactive NOx",           unit: "ppb",   aqsParameterCode: "42603", aqsUnitCode: "008" },
  { name: "CO",          description: "Carbon monoxide",              unit: "ppm",   aqsParameterCode: "42101", aqsUnitCode: "007" },
  { name: "SO2",         description: "Sulfur dioxide",               unit: "ppb",   aqsParameterCode: "42401", aqsUnitCode: "008" },
  { name: "Temp",        description: "Ambient temperature",          unit: "F",     aqsParameterCode: "62101", aqsUnitCode: "017" },
  { name: "RH",          description: "Relative humidity",            unit: "%",     aqsParameterCode: "62201", aqsUnitCode: "019" },
  { name: "Pressure",    description: "Barometric pressure",          unit: "mbar",  aqsParameterCode: "64101", aqsUnitCode: "129" },
  { name: "WindSpeed",   description: "Wind speed",                   unit: "m/s",   aqsParameterCode: "61101", aqsUnitCode: "021" },
  { name: "WindDir",     description: "Wind direction",               unit: "deg",   aqsParameterCode: "61102", aqsUnitCode: "014" },
];

export const SDFS_PARAMETER_INDEX: ReadonlyMap<string, SdfsParameter> = new Map(
  SDFS_PARAMETERS.map((parameter) => [parameter.name.toLowerCase(), parameter]),
);

export function lookupSdfsParameter(name: string): SdfsParameter | undefined {
  return SDFS_PARAMETER_INDEX.get(name.toLowerCase());
}

// ---------------------------------------------------------------------------
// Target diagram statistics (Jolliff et al. 2009; EPA Target plot)
// X axis = sign-of-bias × normalized centered RMSE; Y axis = normalized bias.
// A radius of 1 marks the "unit-target" envelope.
// ---------------------------------------------------------------------------

export type TargetDiagramPoint = {
  label: string;
  n: number;
  normalizedBias: number;
  signedNormalizedCenteredRmse: number;
  totalRmseNormalized: number;
};

export function targetDiagram(
  observed: readonly number[],
  models: ReadonlyArray<{ label: string; predicted: readonly number[] }>,
): TargetDiagramPoint[] {
  return models.map((model) => {
    const pairs = [] as Array<{ observed: number; predicted: number }>;
    const len = Math.min(observed.length, model.predicted.length);
    for (let i = 0; i < len; i += 1) {
      if (Number.isFinite(observed[i]) && Number.isFinite(model.predicted[i])) {
        pairs.push({ observed: observed[i], predicted: model.predicted[i] });
      }
    }
    const stats = modStats(pairs);
    const sdObs = stdev(pairs.map((p) => p.observed));
    if (sdObs === 0 || pairs.length === 0) {
      return {
        label: model.label,
        n: pairs.length,
        normalizedBias: 0,
        signedNormalizedCenteredRmse: 0,
        totalRmseNormalized: 0,
      };
    }
    const sdMod = stdev(pairs.map((p) => p.predicted));
    const sign = sdMod >= sdObs ? 1 : -1;
    const centeredRmse = Math.sqrt(Math.max(0, stats.RMSE * stats.RMSE - stats.MB * stats.MB));
    return {
      label: model.label,
      n: pairs.length,
      normalizedBias: round(stats.MB / sdObs, 4),
      signedNormalizedCenteredRmse: round((sign * centeredRmse) / sdObs, 4),
      totalRmseNormalized: round(stats.RMSE / sdObs, 4),
    };
  });
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  if (lower === upper) return sorted[lower];
  const frac = pos - lower;
  return sorted[lower] * (1 - frac) + sorted[upper] * frac;
}

function stdev(values: readonly number[]): number {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return 0;
  const meanValue = finite.reduce((sum, v) => sum + v, 0) / finite.length;
  return Math.sqrt(finite.reduce((sum, v) => sum + (v - meanValue) ** 2, 0) / finite.length);
}

function round(value: number, digits = 3): number {
  if (!Number.isFinite(value)) return value;
  return Number(value.toFixed(digits));
}
