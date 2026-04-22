import { formatISO } from "date-fns";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { z } from "zod";

export const pasRecordSchema = z.object({
  id: z.string(),
  label: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  stateCode: z.string().optional(),
  countryCode: z.string().optional(),
  timezone: z.string().optional(),
  locationType: z.enum(["inside", "outside", "unknown"]).default("unknown"),
  uniqueId: z.string().optional(),
  pm25Current: z.number().nullable().optional(),
  pm25_10min: z.number().nullable().optional(),
  pm25_30min: z.number().nullable().optional(),
  pm25_1hr: z.number().nullable().optional(),
  pm25_6hr: z.number().nullable().optional(),
  pm25_1day: z.number().nullable().optional(),
  pm25_1week: z.number().nullable().optional(),
  pm25Cf1: z.number().nullable().optional(),
  pm25Cf1A: z.number().nullable().optional(),
  pm25Cf1B: z.number().nullable().optional(),
  pm25Atm: z.number().nullable().optional(),
  pm25AtmA: z.number().nullable().optional(),
  pm25AtmB: z.number().nullable().optional(),
  pm25Alt: z.number().nullable().optional(),
  pm25AltA: z.number().nullable().optional(),
  pm25AltB: z.number().nullable().optional(),
  pm1Atm: z.number().nullable().optional(),
  pm10Atm: z.number().nullable().optional(),
  particleCount03um: z.number().nullable().optional(),
  particleCount05um: z.number().nullable().optional(),
  particleCount10um: z.number().nullable().optional(),
  humidity: z.number().nullable().optional(),
  pressure: z.number().nullable().optional(),
  temperature: z.number().nullable().optional(),
  adjustedHumidity: z.number().nullable().optional(),
  adjustedTemperature: z.number().nullable().optional(),
  dewpoint: z.number().nullable().optional(),
  confidence: z.number().nullable().optional(),
  channelFlags: z.number().nullable().optional(),
  rssi: z.number().nullable().optional(),
  uptimeMinutes: z.number().nullable().optional(),
  paLatencyMs: z.number().nullable().optional(),
  memoryKb: z.number().nullable().optional(),
  firmwareVersion: z.string().optional(),
  hardwareVersion: z.string().optional(),
  lastSeen: z.string().optional(),
  sensorAgeDays: z.number().nullable().optional(),
  distanceToClosestMonitorKm: z.number().nullable().optional(),
  elevationMeters: z.number().nullable().optional()
});

export const pasCollectionSchema = z.object({
  generatedAt: z.string(),
  source: z.enum(["archive", "live", "fixture", "local"]),
  records: z.array(pasRecordSchema)
});

export const patMetaSchema = z.object({
  sensorId: z.string(),
  label: z.string(),
  timezone: z.string(),
  latitude: z.number().optional(),
  longitude: z.number().optional()
});

export const patPointSchema = z.object({
  timestamp: z.string(),
  pm25A: z.number().nullable(),
  pm25B: z.number().nullable(),
  pm25Cf1A: z.number().nullable().optional(),
  pm25Cf1B: z.number().nullable().optional(),
  pm25AtmA: z.number().nullable().optional(),
  pm25AtmB: z.number().nullable().optional(),
  pm25AltA: z.number().nullable().optional(),
  pm25AltB: z.number().nullable().optional(),
  particleCount03umA: z.number().nullable().optional(),
  particleCount03umB: z.number().nullable().optional(),
  confidence: z.number().nullable().optional(),
  channelFlags: z.number().nullable().optional(),
  humidity: z.number().nullable().optional(),
  temperature: z.number().nullable().optional(),
  adjustedHumidity: z.number().nullable().optional(),
  adjustedTemperature: z.number().nullable().optional(),
  dewpoint: z.number().nullable().optional(),
  pressure: z.number().nullable().optional()
});

export const patSeriesSchema = z.object({
  meta: patMetaSchema,
  points: z.array(patPointSchema)
});

export const sensorRecordSchema = z.object({
  id: z.string(),
  meta: patMetaSchema,
  latest: patPointSchema
});

export const qcIssueSchema = z.object({
  code: z.string(),
  message: z.string(),
  count: z.number()
});

export const qcResultSchema = z.object({
  sensorId: z.string(),
  totalPoints: z.number(),
  flaggedPoints: z.number(),
  removedPoints: z.number(),
  status: z.enum(["ok", "warning", "fail"]),
  issues: z.array(qcIssueSchema),
  cleanedSeries: patSeriesSchema
});

export const sohDailyMetricsSchema = z.object({
  date: z.string(),
  pctReporting: z.number(),
  pctValid: z.number(),
  pctDataCompleteness: z.number(),
  meanAbsoluteChannelDelta: z.number(),
  channelAgreementScore: z.number(),
  otherFitScore: z.number()
});

export const sohIndexResultSchema = z.object({
  sensorId: z.string(),
  index: z.number(),
  status: z.enum(["excellent", "good", "watch", "poor"]),
  metrics: z.array(sohDailyMetricsSchema)
});

export type PasRecord = z.infer<typeof pasRecordSchema>;
export type PasCollection = z.infer<typeof pasCollectionSchema>;
export type PatMeta = z.infer<typeof patMetaSchema>;
export type PatPoint = z.infer<typeof patPointSchema>;
export type PatSeries = z.infer<typeof patSeriesSchema>;
export type SensorRecord = z.infer<typeof sensorRecordSchema>;
export type QcResult = z.infer<typeof qcResultSchema>;
export type SohDailyMetrics = z.infer<typeof sohDailyMetricsSchema>;
export type SohIndexResult = z.infer<typeof sohIndexResultSchema>;

export type Citation = {
  title: string;
  url: string;
  year?: number;
};

export type ProvenanceLabel =
  | "raw-purpleair"
  | "epa-corrected-purpleair"
  | "epa-daily-aqi"
  | "epa-nowcast-aqi"
  | "official-reference"
  | "modeled-aqi";

export type DataStatus = {
  mode: "api" | "static";
  collectionSource: PasCollection["source"] | "unknown";
  generatedAt: string;
  liveConfigured: boolean;
  localConfigured: boolean;
  warnings: string[];
};

export type PasFilterOptions = {
  stateCode?: string;
  countryCode?: string;
  labelQuery?: string;
  isOutside?: boolean;
  minPm25?: number;
  maxPm25?: number;
};

export type AreaBounds = {
  north: number;
  south: number;
  east: number;
  west: number;
};

export type PasModelingUse =
  | "snapshot"
  | "calibration"
  | "virtual-sensing"
  | "sensor-siting";

export type PasModelingFieldRole =
  | "identity"
  | "location"
  | "pm"
  | "meteorology"
  | "quality"
  | "hardware"
  | "reference"
  | "metadata";

export type PasModelingField = {
  key: keyof PasRecord;
  label: string;
  role: PasModelingFieldRole;
  unit?: string;
  requiredFor: readonly PasModelingUse[];
};

export const PAS_MODELING_FIELD_MANIFEST = [
  { key: "id", label: "Sensor ID", role: "identity", requiredFor: ["snapshot", "calibration", "virtual-sensing", "sensor-siting"] },
  { key: "label", label: "Label", role: "identity", requiredFor: ["snapshot"] },
  { key: "latitude", label: "Latitude", role: "location", unit: "degrees", requiredFor: ["snapshot", "calibration", "virtual-sensing", "sensor-siting"] },
  { key: "longitude", label: "Longitude", role: "location", unit: "degrees", requiredFor: ["snapshot", "calibration", "virtual-sensing", "sensor-siting"] },
  { key: "locationType", label: "Location type", role: "metadata", requiredFor: ["snapshot", "virtual-sensing", "sensor-siting"] },
  { key: "pm25Current", label: "PM2.5 current", role: "pm", unit: "ug/m3", requiredFor: ["snapshot", "sensor-siting"] },
  { key: "pm25_1hr", label: "PM2.5 1h", role: "pm", unit: "ug/m3", requiredFor: ["snapshot", "calibration", "virtual-sensing", "sensor-siting"] },
  { key: "pm25Cf1", label: "PM2.5 CF=1", role: "pm", unit: "ug/m3", requiredFor: ["calibration", "virtual-sensing"] },
  { key: "pm25Atm", label: "PM2.5 ATM", role: "pm", unit: "ug/m3", requiredFor: ["calibration", "virtual-sensing"] },
  { key: "pm25Alt", label: "PM2.5 ALT", role: "pm", unit: "ug/m3", requiredFor: ["calibration", "virtual-sensing"] },
  { key: "particleCount03um", label: "0.3um count", role: "pm", requiredFor: ["calibration", "virtual-sensing"] },
  { key: "humidity", label: "Humidity", role: "meteorology", unit: "%", requiredFor: ["calibration", "virtual-sensing"] },
  { key: "temperature", label: "Temperature", role: "meteorology", unit: "F", requiredFor: ["calibration", "virtual-sensing"] },
  { key: "pressure", label: "Pressure", role: "meteorology", unit: "hPa", requiredFor: ["virtual-sensing"] },
  { key: "confidence", label: "Confidence", role: "quality", requiredFor: ["calibration", "virtual-sensing"] },
  { key: "channelFlags", label: "Channel flags", role: "quality", requiredFor: ["calibration", "virtual-sensing"] },
  { key: "elevationMeters", label: "Elevation", role: "location", unit: "m", requiredFor: ["virtual-sensing", "sensor-siting"] },
  { key: "distanceToClosestMonitorKm", label: "Nearest reference distance", role: "reference", unit: "km", requiredFor: ["calibration", "virtual-sensing"] },
  { key: "hardwareVersion", label: "Hardware", role: "hardware", requiredFor: ["calibration"] },
  { key: "firmwareVersion", label: "Firmware", role: "hardware", requiredFor: ["calibration"] },
] as const satisfies readonly PasModelingField[];

export type PasFieldCompleteness = {
  key: keyof PasRecord;
  label: string;
  role: PasModelingFieldRole;
  present: number;
  missing: number;
  completeness: number;
  requiredFor: readonly PasModelingUse[];
};

export type PasDatasetHealthWarning = {
  code: string;
  message: string;
  severity: "info" | "warning" | "critical";
};

export type PasDatasetHealthSummary = {
  generatedAt: string;
  source: PasCollection["source"];
  totalRecords: number;
  outsideRecords: number;
  insideRecords: number;
  unknownLocationRecords: number;
  validCoordinateRecords: number;
  missingCoordinateRecords: number;
  recordsWithPm25: number;
  modelReadyRecords: number;
  modelReadyFraction: number;
  duplicateIds: string[];
  bounds: AreaBounds | null;
  fieldCompleteness: PasFieldCompleteness[];
  warnings: PasDatasetHealthWarning[];
};

export type PatModelingFieldKey =
  | "pm25A"
  | "pm25B"
  | "pm25Cf1A"
  | "pm25Cf1B"
  | "pm25AtmA"
  | "pm25AtmB"
  | "pm25AltA"
  | "pm25AltB"
  | "particleCount03umA"
  | "particleCount03umB"
  | "confidence"
  | "channelFlags"
  | "humidity"
  | "temperature"
  | "adjustedHumidity"
  | "adjustedTemperature"
  | "dewpoint"
  | "pressure";

export type PatModelingField = {
  key: PatModelingFieldKey;
  label: string;
  role: "pm" | "particle-count" | "meteorology" | "quality";
  unit?: string;
};

export const PAT_MODELING_FIELD_MANIFEST = [
  { key: "pm25A", label: "PM2.5 A", role: "pm", unit: "ug/m3" },
  { key: "pm25B", label: "PM2.5 B", role: "pm", unit: "ug/m3" },
  { key: "pm25Cf1A", label: "PM2.5 CF=1 A", role: "pm", unit: "ug/m3" },
  { key: "pm25Cf1B", label: "PM2.5 CF=1 B", role: "pm", unit: "ug/m3" },
  { key: "pm25AtmA", label: "PM2.5 ATM A", role: "pm", unit: "ug/m3" },
  { key: "pm25AtmB", label: "PM2.5 ATM B", role: "pm", unit: "ug/m3" },
  { key: "pm25AltA", label: "PM2.5 ALT A", role: "pm", unit: "ug/m3" },
  { key: "pm25AltB", label: "PM2.5 ALT B", role: "pm", unit: "ug/m3" },
  { key: "particleCount03umA", label: "0.3um A", role: "particle-count" },
  { key: "particleCount03umB", label: "0.3um B", role: "particle-count" },
  { key: "humidity", label: "Humidity", role: "meteorology", unit: "%" },
  { key: "temperature", label: "Temperature", role: "meteorology", unit: "F" },
  { key: "adjustedHumidity", label: "Adjusted humidity", role: "meteorology", unit: "%" },
  { key: "adjustedTemperature", label: "Adjusted temperature", role: "meteorology", unit: "F" },
  { key: "dewpoint", label: "Dewpoint", role: "meteorology", unit: "F" },
  { key: "pressure", label: "Pressure", role: "meteorology", unit: "hPa" },
  { key: "confidence", label: "Confidence", role: "quality" },
  { key: "channelFlags", label: "Channel flags", role: "quality" },
] as const satisfies readonly PatModelingField[];

export type PatModelingMatrixOptions = {
  fields?: readonly PatModelingFieldKey[];
  timeIndex?: "union" | "intersection";
};

export type PatModelingMatrix = {
  sensorIds: string[];
  timestamps: string[];
  fields: PatModelingFieldKey[];
  values: Array<Array<Array<number | null>>>;
  sensorCompleteness: Array<{ sensorId: string; present: number; missing: number; completeness: number }>;
  fieldCompleteness: Array<{ field: PatModelingFieldKey; present: number; missing: number; completeness: number }>;
};

// Rich aggregation bucket
export type AggregationStats = {
  mean: number | null;
  median: number | null;
  sd: number | null;
  min: number | null;
  max: number | null;
  count: number;
};

export type RichAggregatePoint = {
  timestamp: string;
  pm25A: AggregationStats;
  pm25B: AggregationStats;
  humidity: AggregationStats;
  temperature: AggregationStats;
  pressure: AggregationStats;
  /** t-test comparing pm25A and pm25B within this bucket */
  abTTest: { t: number; p: number; df: number } | null;
};

export type RichAggregateSeries = {
  meta: PatMeta;
  points: RichAggregatePoint[];
};

// Linear regression result
export type LinearFitResult = {
  slope: number;
  intercept: number;
  rSquared: number;
  n: number;
};

// Enhanced SoH with new R-package metrics
export type EnhancedSohDailyMetrics = SohDailyMetrics & {
  pctDC: number;           // DC signal detection (zero std dev)
  abFit: LinearFitResult | null; // daily A/B linear fit
  abTTest: { t: number; p: number; df: number } | null; // daily t-test
};

export type EnhancedSohIndexResult = {
  sensorId: string;
  index: number;
  status: "excellent" | "good" | "watch" | "poor";
  metrics: EnhancedSohDailyMetrics[];
};

// External fit result
export type ExternalFitResult = {
  fit: LinearFitResult;
  referenceSensorId: string;
  referenceLabel: string;
  pairs: Array<{ timestamp: string; sensor: number; reference: number }>;
};

// Scatter matrix data
export type ScatterMatrixData = {
  variables: string[];
  pairs: Array<{
    xVar: string;
    yVar: string;
    points: Array<[number, number]>;
    correlation: number;
  }>;
};

export type ReferenceObservationPoint = {
  timestamp: string;
  parameter: "PM2.5";
  pm25: number | null;
  aqi: number | null;
  provenance?: ProvenanceLabel;
  category?: string;
  reportingArea?: string;
};

export type ReferenceSource = "airnow" | "aqs" | "openaq" | "static";
export type ReferenceObservationKind = "conditions" | "monitor" | "forecast" | "synthetic";

export type ReferenceObservationSeries = {
  source: ReferenceSource;
  kind?: ReferenceObservationKind;
  label: string;
  latitude: number;
  longitude: number;
  siteId?: string;
  sourceUrl?: string;
  attribution?: string;
  observations: ReferenceObservationPoint[];
};

export type ComparisonPair = {
  timestamp: string;
  sensorPm25A: number | null;
  sensorPm25B: number | null;
  sensorPm25Mean: number | null;
  referencePm25: number | null;
  referenceAqi: number | null;
};

export type ComparisonResult = {
  sensor: PatMeta;
  reference: ReferenceObservationSeries | null;
  pairs: ComparisonPair[];
  fit: LinearFitResult | null;
  validation: ReferenceValidationResult | null;
};

export type ReferenceValidationTargets = {
  minRSquared: number;
  maxRmse: number;
  maxNrmsePct: number;
  slopeLow: number;
  slopeHigh: number;
  interceptLow: number;
  interceptHigh: number;
};

export type ReferenceValidationResult = {
  source: ReferenceSource;
  n: number;
  timeOverlapHours: number;
  distanceKm: number | null;
  slope: number | null;
  intercept: number | null;
  rSquared: number | null;
  rmse: number | null;
  nrmsePct: number | null;
  mae: number | null;
  bias: number | null;
  status: "pass" | "watch" | "fail" | "insufficient";
  targets: ReferenceValidationTargets;
};

export type AqiCategory =
  | "Good"
  | "Moderate"
  | "USG"
  | "Unhealthy"
  | "Very Unhealthy"
  | "Hazardous";

export type AqiBreakpoint = {
  category: AqiCategory;
  concLow: number;
  concHigh: number;
  aqiLow: number;
  aqiHigh: number;
  color: string;
};

export type AqiBandResult = {
  label: AqiCategory | "Unavailable";
  color: string;
  aqi: number | null;
};

export type AqiProfile = {
  id: "epa-pm25-2024";
  pollutant: "pm25";
  basis: "daily-average" | "nowcast";
  citation: Citation;
  breakpoints: AqiBreakpoint[];
};

export type NowCastSample = {
  timestamp: string;
  pm25: number | null | undefined;
};

export type NowCastResult = {
  pm25NowCast: number | null;
  aqi: number | null;
  weightFactor: number | null;
  hoursUsed: number;
  hoursRequired: number;
  status: "stable" | "calculating" | "insufficient";
  provenance: ProvenanceLabel;
};

export type PurpleAirInputBasis = "cf_1" | "atm" | "alt";

export type PurpleAirCorrectionProfileId =
  | "epa-barkjohn-2021-cf1"
  | "epa-barkjohn-2022-smoke-cf1"
  | "nilson-2022-rh-growth-atm"
  | "nilson-2022-polynomial-atm";

export type PurpleAirCorrectionProfile = {
  id: PurpleAirCorrectionProfileId;
  label: string;
  inputBasis: PurpleAirInputBasis;
  scope: "default-outdoor" | "extreme-smoke" | "advanced";
  citation: Citation;
  requiresHumidity: boolean;
  correct: (pm25: number, humidity: number | null) => number;
};

export type PurpleAirCorrectionInput = {
  pm25: number | null | undefined;
  humidity?: number | null;
  inputBasis: PurpleAirInputBasis;
  profileId: PurpleAirCorrectionProfileId;
};

export type PurpleAirCorrectionResult = {
  profileId: PurpleAirCorrectionProfileId;
  label: string;
  inputBasis: PurpleAirInputBasis;
  pm25Raw: number;
  humidity: number | null;
  pm25Corrected: number;
  provenance: "epa-corrected-purpleair";
  citation: Citation;
};

export type ChannelQcProfileId = "barkjohn-daily" | "fire-smoke-10min" | "qapp-hourly" | "humid-research";

export type ChannelQcProfile = {
  id: ChannelQcProfileId;
  label: string;
  absoluteThreshold: number;
  relativePercentThreshold: number;
  averagingBasis: "10-minute" | "hourly" | "daily";
  citation: Citation;
};

export type ChannelAgreementResult = {
  profileId: ChannelQcProfileId;
  valid: boolean;
  level: SensorConfidenceLevel;
  absoluteDifference: number | null;
  relativePercentDifference: number | null;
  message: string;
};

export type SensorConfidenceLevel = "good" | "questionable" | "severe" | "unavailable";

export type SensorHealthIssue = {
  code: string;
  message: string;
  severity: Exclude<SensorConfidenceLevel, "good">;
};

export type SensorHealthResult = {
  sensorId: string;
  level: SensorConfidenceLevel;
  profileId: ChannelQcProfileId;
  totalPoints: number;
  channelDisagreementCount: number;
  highHumidityCount: number;
  missingChannelCount: number;
  confidenceField: number | null;
  issues: SensorHealthIssue[];
};

// Advanced QC options
export type AdvancedQcOptions = {
  removeOutOfSpec?: boolean;
  minCount?: number;       // minimum points per hour (default 20)
  maxPValue?: number;      // p-value threshold for A/B t-test (default 1e-4)
  maxMeanDiff?: number;    // max allowed mean difference A-B (default 10)
  maxHumidity?: number;    // humidity saturation threshold (default 95)
};

// Outlier detection result
export type OutlierResult = {
  sensorId: string;
  totalPoints: number;
  outlierCount: number;
  outlierIndices: number[];
  cleanedSeries: PatSeries;
};

// PAT to AirSensor hourly conversion result
export type AirSensorSeries = {
  meta: PatMeta;
  points: Array<{
    timestamp: string;
    pm25: number | null;  // average of A and B after QC
    humidity: number | null;
    temperature: number | null;
    pressure: number | null;
  }>;
};

const BARKJOHN_2021_CITATION: Citation = {
  title: "Development and application of a United States-wide correction for PM2.5 data collected with the PurpleAir sensor",
  url: "https://amt.copernicus.org/articles/14/4617/2021/",
  year: 2021,
};

const BARKJOHN_2022_SMOKE_CITATION: Citation = {
  title: "Correction and Accuracy of PurpleAir PM2.5 Measurements for Extreme Wildfire Smoke",
  url: "https://doi.org/10.3390/s22249669",
  year: 2022,
};

const NILSON_2022_CITATION: Citation = {
  title: "Intra-comparison of calibration curves for PurpleAir PM2.5 sensors",
  url: "https://doi.org/10.5194/amt-15-3315-2022",
  year: 2022,
};

function roundNonNegative(value: number, digits = 3): number {
  if (!Number.isFinite(value)) return 0;
  return Number(Math.max(0, value).toFixed(digits));
}

function barkjohn2021(pm25Cf1: number, humidity: number | null): number {
  if (humidity === null) {
    throw new Error("Barkjohn 2021 correction requires PurpleAir relative humidity.");
  }
  return roundNonNegative(0.524 * pm25Cf1 - 0.0862 * humidity + 5.75);
}

function barkjohn2022Smoke(pm25Cf1: number, humidity: number | null): number {
  const quadratic = 4.21e-4 * pm25Cf1 ** 2 + 0.392 * pm25Cf1 + 3.44;
  if (pm25Cf1 >= 611) return roundNonNegative(quadratic);

  const linear = barkjohn2021(pm25Cf1, humidity);
  if (pm25Cf1 < 570) return linear;

  const transition = (pm25Cf1 - 570) / (611 - 570);
  return roundNonNegative(linear * (1 - transition) + quadratic * transition);
}

function nilsonRhGrowth(pm25Atm: number, humidity: number | null): number {
  if (humidity === null || humidity <= 0 || humidity >= 100) {
    throw new Error("Nilson RH-growth correction requires relative humidity between 0 and 100.");
  }
  return roundNonNegative(pm25Atm / (1 + 0.24 / (100 / humidity - 1)));
}

function nilsonPolynomial(pm25Atm: number, humidity: number | null): number {
  if (humidity === null) {
    throw new Error("Nilson polynomial correction requires relative humidity.");
  }
  return roundNonNegative(0.53 * pm25Atm + 0.000952 * pm25Atm ** 2 - 0.0914 * humidity + 6.3);
}

export const PURPLEAIR_CORRECTION_PROFILES: Record<PurpleAirCorrectionProfileId, PurpleAirCorrectionProfile> = {
  "epa-barkjohn-2021-cf1": {
    id: "epa-barkjohn-2021-cf1",
    label: "US EPA/Barkjohn 2021 CF=1 + RH correction",
    inputBasis: "cf_1",
    scope: "default-outdoor",
    citation: BARKJOHN_2021_CITATION,
    requiresHumidity: true,
    correct: barkjohn2021,
  },
  "epa-barkjohn-2022-smoke-cf1": {
    id: "epa-barkjohn-2022-smoke-cf1",
    label: "Barkjohn 2022 extreme-smoke CF=1 extension",
    inputBasis: "cf_1",
    scope: "extreme-smoke",
    citation: BARKJOHN_2022_SMOKE_CITATION,
    requiresHumidity: true,
    correct: barkjohn2022Smoke,
  },
  "nilson-2022-rh-growth-atm": {
    id: "nilson-2022-rh-growth-atm",
    label: "Nilson 2022 RH-growth ATM correction",
    inputBasis: "atm",
    scope: "advanced",
    citation: NILSON_2022_CITATION,
    requiresHumidity: true,
    correct: nilsonRhGrowth,
  },
  "nilson-2022-polynomial-atm": {
    id: "nilson-2022-polynomial-atm",
    label: "Nilson 2022 polynomial ATM + RH correction",
    inputBasis: "atm",
    scope: "advanced",
    citation: NILSON_2022_CITATION,
    requiresHumidity: true,
    correct: nilsonPolynomial,
  },
};

export function applyPurpleAirCorrection(input: PurpleAirCorrectionInput): PurpleAirCorrectionResult | null {
  if (typeof input.pm25 !== "number" || !Number.isFinite(input.pm25)) return null;

  const profile = PURPLEAIR_CORRECTION_PROFILES[input.profileId];
  if (!profile) {
    throw new Error(`Unknown PurpleAir correction profile: ${input.profileId}`);
  }
  if (profile.inputBasis !== input.inputBasis) {
    throw new Error(`${profile.label} requires ${profile.inputBasis} input, not ${input.inputBasis}.`);
  }

  const humidity = typeof input.humidity === "number" && Number.isFinite(input.humidity) ? input.humidity : null;
  const pm25Corrected = profile.correct(input.pm25, humidity);
  return {
    profileId: profile.id,
    label: profile.label,
    inputBasis: profile.inputBasis,
    pm25Raw: input.pm25,
    humidity,
    pm25Corrected,
    provenance: "epa-corrected-purpleair",
    citation: profile.citation,
  };
}

export const CHANNEL_QC_PROFILES: Record<ChannelQcProfileId, ChannelQcProfile> = {
  "barkjohn-daily": {
    id: "barkjohn-daily",
    label: "Barkjohn 2021 daily A/B agreement",
    absoluteThreshold: 5,
    relativePercentThreshold: 61,
    averagingBasis: "daily",
    citation: BARKJOHN_2021_CITATION,
  },
  "fire-smoke-10min": {
    id: "fire-smoke-10min",
    label: "AirNow Fire and Smoke Map 10-minute A/B agreement",
    absoluteThreshold: 5,
    relativePercentThreshold: 70,
    averagingBasis: "10-minute",
    citation: {
      title: "AirNow Fire and Smoke Map Questions and Answers",
      url: "https://document.airnow.gov/airnow-fire-and-smoke-map-questions-and-answers.pdf",
      year: 2026,
    },
  },
  "qapp-hourly": {
    id: "qapp-hourly",
    label: "EPA PM2.5 Sensor Loan Program QAPP hourly A/B agreement",
    absoluteThreshold: 5,
    relativePercentThreshold: 35,
    averagingBasis: "hourly",
    citation: {
      title: "Particulate Matter (PM2.5) Sensor Loan Program QAPP",
      url: "https://www.epa.gov/system/files/documents/2024-06/particulate-matter-pm2.5-sensor-loan-program-qapp-aasb-qapp-004-r1.1.pdf",
      year: 2024,
    },
  },
  "humid-research": {
    id: "humid-research",
    label: "High-humidity research A/B agreement",
    absoluteThreshold: 5,
    relativePercentThreshold: 20,
    averagingBasis: "hourly",
    citation: {
      title: "Calibration of PurpleAir low-cost particulate matter sensors under high relative humidity conditions",
      url: "https://amt.copernicus.org/articles/17/6735/2024/",
      year: 2024,
    },
  },
};

function safeNumber(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function timestampString(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value > 10_000_000_000 ? value : value * 1000).toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000).toISOString();
    }
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  return undefined;
}

function ageDaysFromTimestamp(value: unknown): number | null {
  const timestamp = timestampString(value);
  if (!timestamp) return null;
  const ageMs = Date.now() - new Date(timestamp).getTime();
  return Number.isFinite(ageMs) && ageMs >= 0 ? Number((ageMs / 86_400_000).toFixed(2)) : null;
}

function locationTypeFromRaw(value: unknown): "inside" | "outside" | "unknown" {
  if (value === 0 || value === "0" || value === "outside") {
    return "outside";
  }
  if (value === 1 || value === "1" || value === "inside") {
    return "inside";
  }
  return "unknown";
}

function normalizeRecord(raw: Record<string, unknown>): PasRecord {
  return pasRecordSchema.parse({
    id: String(raw.id ?? raw.ID ?? raw.sensor_index ?? raw.sensorId),
    label: String(raw.label ?? raw.name ?? raw.Label ?? raw.id ?? "Unknown"),
    latitude: Number(raw.latitude ?? raw.Latitude ?? 0),
    longitude: Number(raw.longitude ?? raw.Longitude ?? 0),
    stateCode: raw.stateCode ?? raw.StateCode ?? raw.state,
    countryCode: raw.countryCode ?? raw.country_code ?? raw.country,
    timezone: raw.timezone,
    locationType: locationTypeFromRaw(raw.locationType ?? raw.location_type ?? raw.DEVICE_LOCATIONTYPE),
    uniqueId: typeof raw.uniqueId === "string" ? raw.uniqueId : undefined,
    pm25Current: safeNumber(raw.pm25Current ?? raw.pm2_5 ?? raw["pm2.5"] ?? raw.pm25_current),
    pm25_10min: safeNumber(raw.pm25_10min ?? raw["pm2.5_10minute"]),
    pm25_30min: safeNumber(raw.pm25_30min ?? raw["pm2.5_30minute"]),
    pm25_1hr: safeNumber(raw.pm25_1hr ?? raw["pm2.5_1hour"]),
    pm25_6hr: safeNumber(raw.pm25_6hr ?? raw["pm2.5_6hour"]),
    pm25_1day: safeNumber(raw.pm25_1day ?? raw["pm2.5_24hour"]),
    pm25_1week: safeNumber(raw.pm25_1week ?? raw["pm2.5_1week"]),
    pm25Cf1: safeNumber(raw.pm25Cf1 ?? raw["pm2.5_cf_1"]),
    pm25Cf1A: safeNumber(raw.pm25Cf1A ?? raw["pm2.5_cf_1_a"]),
    pm25Cf1B: safeNumber(raw.pm25Cf1B ?? raw["pm2.5_cf_1_b"]),
    pm25Atm: safeNumber(raw.pm25Atm ?? raw["pm2.5_atm"]),
    pm25AtmA: safeNumber(raw.pm25AtmA ?? raw["pm2.5_atm_a"]),
    pm25AtmB: safeNumber(raw.pm25AtmB ?? raw["pm2.5_atm_b"]),
    pm25Alt: safeNumber(raw.pm25Alt ?? raw["pm2.5_alt"]),
    pm25AltA: safeNumber(raw.pm25AltA ?? raw["pm2.5_alt_a"]),
    pm25AltB: safeNumber(raw.pm25AltB ?? raw["pm2.5_alt_b"]),
    pm1Atm: safeNumber(raw.pm1Atm ?? raw["pm1.0_atm"]),
    pm10Atm: safeNumber(raw.pm10Atm ?? raw["pm10.0_atm"]),
    particleCount03um: safeNumber(raw.particleCount03um ?? raw["0.3_um_count"]),
    particleCount05um: safeNumber(raw.particleCount05um ?? raw["0.5_um_count"]),
    particleCount10um: safeNumber(raw.particleCount10um ?? raw["10.0_um_count"]),
    humidity: safeNumber(raw.humidity),
    pressure: safeNumber(raw.pressure),
    temperature: safeNumber(raw.temperature),
    adjustedHumidity: safeNumber(raw.adjustedHumidity),
    adjustedTemperature: safeNumber(raw.adjustedTemperature),
    dewpoint: safeNumber(raw.dewpoint),
    confidence: safeNumber(raw.confidence),
    channelFlags: safeNumber(raw.channelFlags ?? raw.channel_flags),
    rssi: safeNumber(raw.rssi),
    uptimeMinutes: safeNumber(raw.uptimeMinutes ?? raw.uptime),
    paLatencyMs: safeNumber(raw.paLatencyMs ?? raw.pa_latency),
    memoryKb: safeNumber(raw.memoryKb ?? raw.memory),
    firmwareVersion: typeof raw.firmwareVersion === "string" ? raw.firmwareVersion : typeof raw.firmware_version === "string" ? raw.firmware_version : undefined,
    hardwareVersion: typeof raw.hardwareVersion === "string" ? raw.hardwareVersion : typeof raw.hardware === "string" ? raw.hardware : undefined,
    lastSeen: timestampString(raw.lastSeen ?? raw.last_seen),
    sensorAgeDays: safeNumber(raw.sensorAgeDays) ?? ageDaysFromTimestamp(raw.date_created),
    distanceToClosestMonitorKm: safeNumber(raw.distanceToClosestMonitorKm ?? raw.pwfsl_closestDistance)
  });
}

export function normalizePasCollection(input: unknown, source: PasCollection["source"] = "live"): PasCollection {
  if (pasCollectionSchema.safeParse(input).success) {
    return pasCollectionSchema.parse(input);
  }

  if (Array.isArray(input)) {
    return pasCollectionSchema.parse({
      generatedAt: new Date().toISOString(),
      source,
      records: input.map((item) => normalizeRecord(item as Record<string, unknown>))
    });
  }

  const payload = input as { fields?: string[]; data?: unknown[][]; records?: unknown[] } | null;
  if (payload?.records && Array.isArray(payload.records)) {
    return normalizePasCollection(payload.records, source);
  }

  if (payload?.fields && payload?.data) {
    const rows = payload.data.map((row) => {
      const record: Record<string, unknown> = {};
      payload.fields?.forEach((field, index) => {
        record[field] = row[index];
      });
      return record;
    });
    return normalizePasCollection(rows, source);
  }

  throw new Error("Unable to normalize PAS payload.");
}

export function pasAddUniqueIds(collection: PasCollection): PasCollection {
  return {
    ...collection,
    records: collection.records.map((record) => ({
      ...record,
      uniqueId: record.uniqueId ?? `${record.id}-${record.locationType}-${record.latitude.toFixed(4)}-${record.longitude.toFixed(4)}`
    }))
  };
}

export function pasFilter(collection: PasCollection, filters: PasFilterOptions = {}): PasCollection {
  const query = filters.labelQuery?.trim().toLowerCase();
  return {
    ...collection,
    records: collection.records.filter((record) => {
      const pm25 = record.pm25_1hr ?? record.pm25Current ?? 0;

      if (filters.stateCode && record.stateCode !== filters.stateCode) return false;
      if (filters.countryCode && record.countryCode !== filters.countryCode) return false;
      if (typeof filters.isOutside === "boolean") {
        if (filters.isOutside && record.locationType !== "outside") return false;
        if (!filters.isOutside && record.locationType !== "inside") return false;
      }
      if (query && !record.label.toLowerCase().includes(query)) return false;
      if (filters.minPm25 !== undefined && pm25 < filters.minPm25) return false;
      if (filters.maxPm25 !== undefined && pm25 > filters.maxPm25) return false;

      return true;
    })
  };
}

export function pasGetColumn<K extends keyof PasRecord>(
  collection: PasCollection,
  column: K,
  options: Pick<PasFilterOptions, "isOutside"> = {}
): Array<PasRecord[K]> {
  return pasFilter(collection, options).records
    .map((record) => record[column])
    .filter((value): value is PasRecord[K] => value !== undefined);
}

export function pasGetIDs(collection: PasCollection, options?: Pick<PasFilterOptions, "isOutside">): string[] {
  return pasGetColumn(collection, "id", options) as string[];
}

export function pasGetLabels(collection: PasCollection, options?: Pick<PasFilterOptions, "isOutside">): string[] {
  return pasGetColumn(collection, "label", options) as string[];
}

function haversineKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const radiusKm = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;

  const value =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * radiusKm * Math.asin(Math.sqrt(value));
}

export function pasFilterNear(
  collection: PasCollection,
  center: { latitude: number; longitude: number },
  radiusKm: number
): PasCollection {
  return {
    ...collection,
    records: collection.records.filter((record) => haversineKm(center, record) <= radiusKm)
  };
}

export function pasFilterArea(collection: PasCollection, bounds: AreaBounds): PasCollection {
  return {
    ...collection,
    records: collection.records.filter(
      (record) =>
        record.latitude <= bounds.north &&
        record.latitude >= bounds.south &&
        record.longitude <= bounds.east &&
        record.longitude >= bounds.west
    )
  };
}

function isPresentValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

function hasValidCoordinates(record: PasRecord): boolean {
  return Number.isFinite(record.latitude) &&
    Number.isFinite(record.longitude) &&
    record.latitude >= -90 &&
    record.latitude <= 90 &&
    record.longitude >= -180 &&
    record.longitude <= 180;
}

function hasUsablePm25(record: PasRecord): boolean {
  return [
    record.pm25_1hr,
    record.pm25Current,
    record.pm25Cf1,
    record.pm25Atm,
    record.pm25Alt,
  ].some(isPresentValue);
}

export function summarizePasDatasetHealth(collection: PasCollection): PasDatasetHealthSummary {
  const idCounts = new Map<string, number>();
  for (const record of collection.records) {
    idCounts.set(record.id, (idCounts.get(record.id) ?? 0) + 1);
  }

  const coordinateRecords = collection.records.filter(hasValidCoordinates);
  const outsideRecords = collection.records.filter((record) => record.locationType === "outside").length;
  const insideRecords = collection.records.filter((record) => record.locationType === "inside").length;
  const unknownLocationRecords = collection.records.filter((record) => record.locationType === "unknown").length;
  const recordsWithPm25 = collection.records.filter(hasUsablePm25).length;
  const modelReadyRecords = collection.records.filter(
    (record) => record.locationType === "outside" && hasValidCoordinates(record) && hasUsablePm25(record),
  ).length;

  const bounds = coordinateRecords.length
    ? coordinateRecords.reduce<AreaBounds>((acc, record) => ({
        north: Math.max(acc.north, record.latitude),
        south: Math.min(acc.south, record.latitude),
        east: Math.max(acc.east, record.longitude),
        west: Math.min(acc.west, record.longitude),
      }), {
        north: coordinateRecords[0].latitude,
        south: coordinateRecords[0].latitude,
        east: coordinateRecords[0].longitude,
        west: coordinateRecords[0].longitude,
      })
    : null;

  const fieldCompleteness = PAS_MODELING_FIELD_MANIFEST.map((field) => {
    const present = collection.records.filter((record) => isPresentValue(record[field.key])).length;
    const missing = collection.records.length - present;
    return {
      key: field.key,
      label: field.label,
      role: field.role,
      present,
      missing,
      completeness: collection.records.length ? present / collection.records.length : 0,
      requiredFor: field.requiredFor,
    };
  });

  const duplicateIds = [...idCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id)
    .sort();

  const warnings: PasDatasetHealthWarning[] = [];
  if (collection.records.length === 0) {
    warnings.push({ code: "empty-dataset", severity: "critical", message: "No sensor records are available." });
  }
  if (duplicateIds.length > 0) {
    warnings.push({
      code: "duplicate-ids",
      severity: "warning",
      message: `${duplicateIds.length} sensor IDs appear more than once.`,
    });
  }
  if (coordinateRecords.length < collection.records.length) {
    warnings.push({
      code: "missing-coordinates",
      severity: "warning",
      message: `${collection.records.length - coordinateRecords.length} records have invalid coordinates.`,
    });
  }
  if (recordsWithPm25 < collection.records.length) {
    warnings.push({
      code: "missing-pm25",
      severity: "warning",
      message: `${collection.records.length - recordsWithPm25} records do not expose a usable PM2.5 field.`,
    });
  }
  if (unknownLocationRecords > 0) {
    warnings.push({
      code: "unknown-location-type",
      severity: "info",
      message: `${unknownLocationRecords} records have unknown indoor/outdoor metadata.`,
    });
  }
  if (outsideRecords === 0 && collection.records.length > 0) {
    warnings.push({
      code: "no-outdoor-sensors",
      severity: "critical",
      message: "No outdoor sensors are available for surface modeling.",
    });
  }

  const modelReadyFraction = collection.records.length ? modelReadyRecords / collection.records.length : 0;
  if (collection.records.length > 0 && modelReadyFraction < 0.5) {
    warnings.push({
      code: "low-model-readiness",
      severity: "warning",
      message: `Only ${(modelReadyFraction * 100).toFixed(1)}% of records are outdoor, geolocated, and PM-ready.`,
    });
  }

  return {
    generatedAt: collection.generatedAt,
    source: collection.source,
    totalRecords: collection.records.length,
    outsideRecords,
    insideRecords,
    unknownLocationRecords,
    validCoordinateRecords: coordinateRecords.length,
    missingCoordinateRecords: collection.records.length - coordinateRecords.length,
    recordsWithPm25,
    modelReadyRecords,
    modelReadyFraction,
    duplicateIds,
    bounds,
    fieldCompleteness,
    warnings,
  };
}

function patNumericValue(point: PatPoint | undefined, field: PatModelingFieldKey): number | null {
  if (!point) return null;
  const value = point[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function buildPatModelingMatrix(
  seriesList: readonly PatSeries[],
  options: PatModelingMatrixOptions = {},
): PatModelingMatrix {
  const fields = [...(options.fields ?? ["pm25A", "pm25B", "humidity", "temperature", "pressure"])] as PatModelingFieldKey[];
  const timeIndex = options.timeIndex ?? "union";
  const sensorIds = seriesList.map((series) => series.meta.sensorId);
  const pointMaps = seriesList.map((series) => new Map(series.points.map((point) => [point.timestamp, point])));

  let timestamps: string[];
  if (timeIndex === "intersection" && pointMaps.length > 0) {
    timestamps = [...pointMaps[0].keys()].filter((timestamp) =>
      pointMaps.every((pointMap) => pointMap.has(timestamp)),
    );
  } else {
    timestamps = [...new Set(pointMaps.flatMap((pointMap) => [...pointMap.keys()]))];
  }
  timestamps.sort();

  const values = pointMaps.map((pointMap) =>
    timestamps.map((timestamp) => {
      const point = pointMap.get(timestamp);
      return fields.map((field) => patNumericValue(point, field));
    }),
  );

  const sensorCompleteness = values.map((sensorValues, index) => {
    const flat = sensorValues.flat();
    const present = flat.filter((value) => value !== null).length;
    const missing = flat.length - present;
    return {
      sensorId: sensorIds[index],
      present,
      missing,
      completeness: flat.length ? present / flat.length : 0,
    };
  });

  const fieldCompleteness = fields.map((field, fieldIndex) => {
    const fieldValues = values.flatMap((sensorValues) => sensorValues.map((timestampValues) => timestampValues[fieldIndex]));
    const present = fieldValues.filter((value) => value !== null).length;
    const missing = fieldValues.length - present;
    return {
      field,
      present,
      missing,
      completeness: fieldValues.length ? present / fieldValues.length : 0,
    };
  });

  return {
    sensorIds,
    timestamps,
    fields,
    values,
    sensorCompleteness,
    fieldCompleteness,
  };
}

function parseDateInput(input: string | number | Date, timezone: string, end = false): Date {
  if (input instanceof Date) {
    return input;
  }

  const raw = String(input).trim();

  if (/^\d{8}$/.test(raw)) {
    const stamped = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    return fromZonedTime(`${stamped}T${end ? "23:59:59.999" : "00:00:00.000"}`, timezone);
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return fromZonedTime(`${raw}T${end ? "23:59:59.999" : "00:00:00.000"}`, timezone);
  }

  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}(:\d{2})?(:\d{2})?$/.test(raw)) {
    return fromZonedTime(raw.replace(" ", "T"), timezone);
  }

  return new Date(raw);
}

export function patFilterDate(
  series: PatSeries,
  start: string | number | Date,
  end: string | number | Date,
  timezone = series.meta.timezone
): PatSeries {
  const startDate = parseDateInput(start, timezone, false);
  const endDate = parseDateInput(end, timezone, true);
  return {
    ...series,
    points: series.points.filter((point) => {
      const timestamp = new Date(point.timestamp);
      return timestamp >= startDate && timestamp <= endDate;
    })
  };
}

export function patAggregate(series: PatSeries, intervalMinutes = 60): PatSeries {
  const buckets = new Map<string, PatPoint[]>();

  for (const point of series.points) {
    const stamp = new Date(point.timestamp);
    const day = formatInTimeZone(stamp, series.meta.timezone, "yyyy-MM-dd");
    const hours = Number(formatInTimeZone(stamp, series.meta.timezone, "HH"));
    const minutes = Number(formatInTimeZone(stamp, series.meta.timezone, "mm"));
    const totalMinutes = hours * 60 + minutes;
    const bucketStart = Math.floor(totalMinutes / intervalMinutes) * intervalMinutes;
    const bucketHour = Math.floor(bucketStart / 60);
    const bucketMinute = bucketStart % 60;
    const key = `${day}T${String(bucketHour).padStart(2, "0")}:${String(bucketMinute).padStart(2, "0")}`;
    const current = buckets.get(key) ?? [];
    current.push(point);
    buckets.set(key, current);
  }

  const points = [...buckets.entries()].map(([key, bucket]) => {
    const avg = (selector: (point: PatPoint) => number | null | undefined) => {
      const values = bucket.map(selector).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
      if (!values.length) return null;
      return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3));
    };

    const zonedDate = fromZonedTime(`${key}:00`, series.meta.timezone);

    return {
      timestamp: formatISO(zonedDate),
      pm25A: avg((point) => point.pm25A),
      pm25B: avg((point) => point.pm25B),
      humidity: avg((point) => point.humidity),
      temperature: avg((point) => point.temperature),
      pressure: avg((point) => point.pressure)
    };
  });

  return {
    ...series,
    points: points.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  };
}

export function patSample(series: PatSeries, sampleSize: number): PatSeries {
  if (sampleSize <= 0 || sampleSize >= series.points.length) {
    return series;
  }

  const step = Math.max(1, Math.floor(series.points.length / sampleSize));
  return {
    ...series,
    points: series.points.filter((_, index) => index % step === 0).slice(0, sampleSize)
  };
}

export function patJoin(left: PatSeries, right: PatSeries): PatSeries {
  return {
    meta: left.meta,
    points: [...left.points, ...right.points].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  };
}

export function findOutlierIndices(series: PatSeries): number[] {
  return series.points.flatMap((point, index) => {
    const agreement = evaluateChannelAgreement(point.pm25A, point.pm25B, "qapp-hourly");
    return !agreement.valid && agreement.level !== "unavailable" ? [index] : [];
  });
}

export function runHourlyAbQc(series: PatSeries, options: { removeOutOfSpec?: boolean } = {}): QcResult {
  const outlierIndices = new Set(findOutlierIndices(series));
  const highHumidityIndices = new Set(
    series.points.flatMap((point, index) => ((point.humidity ?? 0) > 95 ? [index] : []))
  );

  let removedPoints = 0;
  const cleanedSeries: PatSeries = {
    ...series,
    points: series.points.map((point, index) => {
      const shouldClean = options.removeOutOfSpec && (outlierIndices.has(index) || highHumidityIndices.has(index));
      if (!shouldClean) return point;
      removedPoints += 1;
      return { ...point, pm25A: null, pm25B: null };
    })
  };

  const flaggedPoints = new Set([...outlierIndices, ...highHumidityIndices]).size;
  const status = flaggedPoints === 0 ? "ok" : flaggedPoints / Math.max(series.points.length, 1) > 0.2 ? "fail" : "warning";

  return qcResultSchema.parse({
    sensorId: series.meta.sensorId,
    totalPoints: series.points.length,
    flaggedPoints,
    removedPoints,
    status,
    issues: [
      { code: "channel-drift", message: "Large PM2.5 disagreement between channels A and B.", count: outlierIndices.size },
      { code: "humidity-saturation", message: "Humidity exceeds the comfort range for PurpleAir interpretation.", count: highHumidityIndices.size }
    ].filter((issue) => issue.count > 0),
    cleanedSeries
  });
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function channelRelativePercentDifference(a: number, b: number): number | null {
  const denominator = a + b;
  if (!Number.isFinite(a) || !Number.isFinite(b) || denominator <= 0) return null;
  return Math.abs(a - b) * 2 / denominator * 100;
}

export function evaluateChannelAgreement(
  a: number | null | undefined,
  b: number | null | undefined,
  profileId: ChannelQcProfileId = "qapp-hourly",
): ChannelAgreementResult {
  const profile = CHANNEL_QC_PROFILES[profileId];
  if (typeof a !== "number" || !Number.isFinite(a) || typeof b !== "number" || !Number.isFinite(b)) {
    return {
      profileId,
      valid: false,
      level: "unavailable",
      absoluteDifference: null,
      relativePercentDifference: null,
      message: "One or both PurpleAir channels are missing.",
    };
  }

  const absoluteDifference = Math.abs(a - b);
  const relativePercentDifference = channelRelativePercentDifference(a, b);
  const validByAbsolute = absoluteDifference <= profile.absoluteThreshold;
  const validByRelative = relativePercentDifference !== null && relativePercentDifference <= profile.relativePercentThreshold;
  const valid = validByAbsolute || validByRelative;
  const level: SensorConfidenceLevel = valid
    ? "good"
    : absoluteDifference > 300 || (relativePercentDifference !== null && relativePercentDifference > profile.relativePercentThreshold * 2)
      ? "severe"
      : "questionable";

  return {
    profileId,
    valid,
    level,
    absoluteDifference: Number(absoluteDifference.toFixed(3)),
    relativePercentDifference: relativePercentDifference === null ? null : Number(relativePercentDifference.toFixed(3)),
    message: valid
      ? `A/B channels meet ${profile.label}.`
      : `A/B channels exceed ${profile.absoluteThreshold} ug/m3 and ${profile.relativePercentThreshold}% agreement thresholds.`,
  };
}

export function summarizeSensorHealth(
  series: PatSeries,
  options: { profileId?: ChannelQcProfileId; maxHumidity?: number } = {},
): SensorHealthResult {
  const profileId = options.profileId ?? "qapp-hourly";
  const maxHumidity = options.maxHumidity ?? 95;
  let channelDisagreementCount = 0;
  let highHumidityCount = 0;
  let missingChannelCount = 0;
  let severeCount = 0;
  let confidenceField: number | null = null;

  for (const point of series.points) {
    if (typeof point.confidence === "number" && Number.isFinite(point.confidence)) {
      confidenceField = point.confidence;
    }
    const agreement = evaluateChannelAgreement(point.pm25A, point.pm25B, profileId);
    if (agreement.level === "unavailable") missingChannelCount += 1;
    else if (!agreement.valid) channelDisagreementCount += 1;
    if (agreement.level === "severe") severeCount += 1;
    if ((point.humidity ?? 0) > maxHumidity) highHumidityCount += 1;
  }

  const totalPoints = series.points.length;
  const disagreementRate = channelDisagreementCount / Math.max(totalPoints, 1);
  const missingRate = missingChannelCount / Math.max(totalPoints, 1);
  const highHumidityRate = highHumidityCount / Math.max(totalPoints, 1);
  const issues: SensorHealthIssue[] = [];

  if (missingChannelCount > 0) {
    issues.push({
      code: "missing-channel",
      message: `${missingChannelCount} points are missing one or both PM2.5 channels.`,
      severity: missingRate > 0.2 ? "severe" : "questionable",
    });
  }
  if (channelDisagreementCount > 0) {
    issues.push({
      code: "channel-disagreement",
      message: `${channelDisagreementCount} points exceed the selected A/B agreement profile.`,
      severity: severeCount > 0 || disagreementRate > 0.2 ? "severe" : "questionable",
    });
  }
  if (highHumidityCount > 0) {
    issues.push({
      code: "high-humidity",
      message: `${highHumidityCount} points exceed ${maxHumidity}% RH, where optical PM readings can be less reliable.`,
      severity: highHumidityRate > 0.2 ? "severe" : "questionable",
    });
  }

  const level: SensorConfidenceLevel = totalPoints === 0
    ? "unavailable"
    : issues.some((issue) => issue.severity === "severe")
      ? "severe"
      : issues.length
        ? "questionable"
        : "good";

  return {
    sensorId: series.meta.sensorId,
    level,
    profileId,
    totalPoints,
    channelDisagreementCount,
    highHumidityCount,
    missingChannelCount,
    confidenceField,
    issues,
  };
}

function pearsonCorrelation(left: number[], right: number[]): number {
  if (!left.length || left.length !== right.length) return 0;
  const leftAvg = average(left);
  const rightAvg = average(right);
  const numerator = left.reduce((sum, value, index) => sum + (value - leftAvg) * (right[index] - rightAvg), 0);
  const leftVariance = Math.sqrt(left.reduce((sum, value) => sum + (value - leftAvg) ** 2, 0));
  const rightVariance = Math.sqrt(right.reduce((sum, value) => sum + (value - rightAvg) ** 2, 0));
  if (!leftVariance || !rightVariance) return 0;
  return numerator / (leftVariance * rightVariance);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1));
}

function computeAggregationStats(values: (number | null | undefined)[]): AggregationStats {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!nums.length) return { mean: null, median: null, sd: null, min: null, max: null, count: 0 };
  return {
    mean: Number(average(nums).toFixed(3)),
    median: Number(median(nums).toFixed(3)),
    sd: Number(standardDeviation(nums).toFixed(3)),
    min: Number(Math.min(...nums).toFixed(3)),
    max: Number(Math.max(...nums).toFixed(3)),
    count: nums.length
  };
}

/** Two-sample Welch's t-test. Returns {t, p, df}. */
function welchTTest(a: number[], b: number[]): { t: number; p: number; df: number } | null {
  if (a.length < 2 || b.length < 2) return null;
  const meanA = average(a), meanB = average(b);
  const varA = a.reduce((s, v) => s + (v - meanA) ** 2, 0) / (a.length - 1);
  const varB = b.reduce((s, v) => s + (v - meanB) ** 2, 0) / (b.length - 1);
  const seA = varA / a.length, seB = varB / b.length;
  const seDiff = Math.sqrt(seA + seB);
  if (seDiff === 0) return null;
  const t = (meanA - meanB) / seDiff;
  const df = (seA + seB) ** 2 / (seA ** 2 / (a.length - 1) + seB ** 2 / (b.length - 1));
  // Approximate p-value using normal CDF for |t| (adequate for df > 30)
  const absT = Math.abs(t);
  const p = df > 30
    ? 2 * (1 - normalCDF(absT))
    : 2 * (1 - tDistCDF(absT, Math.round(df)));
  return { t: Number(t.toFixed(4)), p: Number(Math.max(0, Math.min(1, p)).toFixed(6)), df: Number(df.toFixed(2)) };
}

/** Standard normal CDF approximation (Abramowitz & Stegun 26.2.17) */
function normalCDF(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX / 2);
  return 0.5 * (1.0 + sign * y);
}

/** Incomplete regularized beta function approximation for t-distribution CDF */
function tDistCDF(x: number, df: number): number {
  // Use normal approximation for large df
  if (df > 100) return normalCDF(x);
  // Numerical approximation using continued fraction for the regularized incomplete beta
  const t2 = x * x;
  const p = df / (df + t2);
  // Simple series approximation
  let sum = 0, term = 1;
  const halfDf = df / 2;
  for (let i = 0; i < 200; i++) {
    sum += term;
    term *= (halfDf + i) * p / (i + 1.5);
    if (Math.abs(term) < 1e-12) break;
  }
  const beta = Math.sqrt(p) * sum * Math.exp(
    lgamma(halfDf + 0.5) - lgamma(halfDf) - lgamma(0.5)
  );
  return 0.5 + (x >= 0 ? 0.5 : -0.5) * (1 - beta);
}

/** Log-gamma function (Lanczos approximation) */
function lgamma(z: number): number {
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/** Ordinary least squares linear regression */
function linearRegression(x: number[], y: number[]): LinearFitResult | null {
  const n = x.length;
  if (n < 3 || x.length !== y.length) return null;
  const xMean = average(x), yMean = average(y);
  let ssXX = 0, ssXY = 0, ssYY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - xMean, dy = y[i] - yMean;
    ssXX += dx * dx;
    ssXY += dx * dy;
    ssYY += dy * dy;
  }
  if (ssXX === 0) return null;
  const slope = ssXY / ssXX;
  const intercept = yMean - slope * xMean;
  const rSquared = ssYY === 0 ? 0 : (ssXY * ssXY) / (ssXX * ssYY);
  return {
    slope: Number(slope.toFixed(6)),
    intercept: Number(intercept.toFixed(6)),
    rSquared: Number(rSquared.toFixed(6)),
    n
  };
}

function detectExpectedPointsPerDay(points: PatPoint[]): number {
  if (points.length < 2) return 24;
  const deltas = points
    .slice(1)
    .map((point, index) => new Date(point.timestamp).getTime() - new Date(points[index].timestamp).getTime())
    .filter((value) => value > 0);
  const medianDeltaMs = deltas.sort((a, b) => a - b)[Math.floor(deltas.length / 2)] ?? 60 * 60 * 1000;
  return Math.max(1, Math.round((24 * 60 * 60 * 1000) / medianDeltaMs));
}

export function calculateDailySoh(series: PatSeries): SohDailyMetrics[] {
  const expectedPoints = detectExpectedPointsPerDay(series.points);
  const buckets = new Map<string, PatPoint[]>();

  for (const point of series.points) {
    const dayKey = formatInTimeZone(new Date(point.timestamp), series.meta.timezone, "yyyy-MM-dd");
    const bucket = buckets.get(dayKey) ?? [];
    bucket.push(point);
    buckets.set(dayKey, bucket);
  }

  return [...buckets.entries()].map(([date, points]) => {
    const validPairs = points.filter((point) => point.pm25A !== null && point.pm25B !== null);
    const deltas = validPairs.map((point) => Math.abs((point.pm25A ?? 0) - (point.pm25B ?? 0)));
    const correlation = pearsonCorrelation(
      validPairs.map((point) => point.pm25A ?? 0),
      validPairs.map((point) => point.pm25B ?? 0)
    );

    return sohDailyMetricsSchema.parse({
      date,
      pctReporting: Number(((points.length / expectedPoints) * 100).toFixed(2)),
      pctValid: Number(((validPairs.length / Math.max(points.length, 1)) * 100).toFixed(2)),
      pctDataCompleteness: Number(((validPairs.length / expectedPoints) * 100).toFixed(2)),
      meanAbsoluteChannelDelta: Number(average(deltas).toFixed(3)),
      channelAgreementScore: Number(Math.max(0, 100 - average(deltas) * 8).toFixed(2)),
      otherFitScore: Number((((correlation + 1) / 2) * 100).toFixed(2))
    });
  });
}

export function calculateSohIndex(series: PatSeries): SohIndexResult {
  const metrics = calculateDailySoh(series);
  const index =
    metrics.reduce((sum, metric) => {
      const daily =
        metric.pctReporting * 0.25 +
        metric.pctValid * 0.25 +
        metric.pctDataCompleteness * 0.2 +
        metric.channelAgreementScore * 0.2 +
        metric.otherFitScore * 0.1;
      return sum + daily;
    }, 0) / Math.max(metrics.length, 1);

  const normalizedIndex = Number(index.toFixed(2));
  const status =
    normalizedIndex >= 85 ? "excellent" : normalizedIndex >= 70 ? "good" : normalizedIndex >= 50 ? "watch" : "poor";

  return sohIndexResultSchema.parse({
    sensorId: series.meta.sensorId,
    index: normalizedIndex,
    status,
    metrics
  });
}

export const EPA_PM25_AQI_PROFILE: AqiProfile = {
  id: "epa-pm25-2024",
  pollutant: "pm25",
  basis: "daily-average",
  citation: {
    title: "US EPA AQS AQI Breakpoints",
    url: "https://aqs.epa.gov/aqsweb/documents/codetables/aqi_breakpoints.html",
    year: 2026,
  },
  breakpoints: [
    { category: "Good", concLow: 0.0, concHigh: 9.0, aqiLow: 0, aqiHigh: 50, color: "#2e9d5b" },
    { category: "Moderate", concLow: 9.1, concHigh: 35.4, aqiLow: 51, aqiHigh: 100, color: "#f0c419" },
    { category: "USG", concLow: 35.5, concHigh: 55.4, aqiLow: 101, aqiHigh: 150, color: "#f2994a" },
    { category: "Unhealthy", concLow: 55.5, concHigh: 125.4, aqiLow: 151, aqiHigh: 200, color: "#d64545" },
    { category: "Very Unhealthy", concLow: 125.5, concHigh: 225.4, aqiLow: 201, aqiHigh: 300, color: "#7d3c98" },
    { category: "Hazardous", concLow: 225.5, concHigh: 325.4, aqiLow: 301, aqiHigh: 500, color: "#8b0000" },
    { category: "Hazardous", concLow: 325.5, concHigh: 99_999.9, aqiLow: 501, aqiHigh: 999, color: "#8b0000" },
  ],
};

export const AQI_UNAVAILABLE_BAND: AqiBandResult = {
  label: "Unavailable",
  color: "#94a3b8",
  aqi: null,
};

export function pm25ToAqiBand(value: number | null | undefined, profile: AqiProfile = EPA_PM25_AQI_PROFILE): AqiBandResult {
  if (typeof value !== "number" || !Number.isFinite(value)) return AQI_UNAVAILABLE_BAND;
  const aqi = pm25ToAqi(value, profile);
  const breakpoint = profile.breakpoints.find((bp) => aqi >= bp.aqiLow && aqi <= bp.aqiHigh)
    ?? profile.breakpoints.at(-1);
  if (!breakpoint) return AQI_UNAVAILABLE_BAND;
  return { label: breakpoint.category, color: breakpoint.color, aqi };
}

export function patDistinct(series: PatSeries): PatSeries {
  const seen = new Set<string>();
  return {
    ...series,
    points: series.points.filter((point) => {
      if (seen.has(point.timestamp)) return false;
      seen.add(point.timestamp);
      return true;
    })
  };
}

export function patOutliers(
  series: PatSeries,
  options: { windowSize?: number; thresholdMin?: number; replace?: boolean } = {}
): OutlierResult {
  const { windowSize = 7, thresholdMin = 3, replace = false } = options;
  const values = series.points.map((p) => {
    if (p.pm25A === null || p.pm25B === null) return null;
    return (p.pm25A + p.pm25B) / 2;
  });

  const outlierIndices: number[] = [];

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null) continue;
    const lo = Math.max(0, i - windowSize);
    const hi = Math.min(values.length - 1, i + windowSize);
    const window: number[] = [];
    for (let j = lo; j <= hi; j++) {
      if (values[j] !== null) window.push(values[j]!);
    }
    const med = median(window);
    const mad = median(window.map((w) => Math.abs(w - med))) * 1.4826; // MAD scale factor
    if (mad === 0) continue;
    if (Math.abs(v - med) / mad > thresholdMin) {
      outlierIndices.push(i);
    }
  }

  const outlierSet = new Set(outlierIndices);
  const cleanedPoints = series.points.map((point, i) => {
    if (!outlierSet.has(i) || !replace) return point;
    // Replace with local median
    const lo = Math.max(0, i - windowSize);
    const hi = Math.min(series.points.length - 1, i + windowSize);
    const windowA: number[] = [], windowB: number[] = [];
    for (let j = lo; j <= hi; j++) {
      if (!outlierSet.has(j) && series.points[j].pm25A !== null) windowA.push(series.points[j].pm25A!);
      if (!outlierSet.has(j) && series.points[j].pm25B !== null) windowB.push(series.points[j].pm25B!);
    }
    return {
      ...point,
      pm25A: windowA.length ? Number(median(windowA).toFixed(3)) : point.pm25A,
      pm25B: windowB.length ? Number(median(windowB).toFixed(3)) : point.pm25B
    };
  });

  return {
    sensorId: series.meta.sensorId,
    totalPoints: series.points.length,
    outlierCount: outlierIndices.length,
    outlierIndices,
    cleanedSeries: { ...series, points: cleanedPoints }
  };
}

export function patRichAggregate(series: PatSeries, intervalMinutes = 60): RichAggregateSeries {
  const buckets = new Map<string, PatPoint[]>();
  for (const point of series.points) {
    const stamp = new Date(point.timestamp);
    const day = formatInTimeZone(stamp, series.meta.timezone, "yyyy-MM-dd");
    const hours = Number(formatInTimeZone(stamp, series.meta.timezone, "HH"));
    const minutes = Number(formatInTimeZone(stamp, series.meta.timezone, "mm"));
    const totalMinutes = hours * 60 + minutes;
    const bucketStart = Math.floor(totalMinutes / intervalMinutes) * intervalMinutes;
    const bucketHour = Math.floor(bucketStart / 60);
    const bucketMinute = bucketStart % 60;
    const key = `${day}T${String(bucketHour).padStart(2, "0")}:${String(bucketMinute).padStart(2, "0")}`;
    const current = buckets.get(key) ?? [];
    current.push(point);
    buckets.set(key, current);
  }

  const points = [...buckets.entries()].map(([key, bucket]) => {
    const zonedDate = fromZonedTime(`${key}:00`, series.meta.timezone);
    const aVals = bucket.map((p) => p.pm25A).filter((v): v is number => v !== null);
    const bVals = bucket.map((p) => p.pm25B).filter((v): v is number => v !== null);
    return {
      timestamp: formatISO(zonedDate),
      pm25A: computeAggregationStats(bucket.map((p) => p.pm25A)),
      pm25B: computeAggregationStats(bucket.map((p) => p.pm25B)),
      humidity: computeAggregationStats(bucket.map((p) => p.humidity)),
      temperature: computeAggregationStats(bucket.map((p) => p.temperature)),
      pressure: computeAggregationStats(bucket.map((p) => p.pressure)),
      abTTest: welchTTest(aVals, bVals)
    };
  });

  return {
    meta: series.meta,
    points: points.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  };
}

export function runAdvancedHourlyAbQc(series: PatSeries, options: AdvancedQcOptions = {}): QcResult {
  const { removeOutOfSpec = false, minCount = 20, maxPValue = 1e-4, maxMeanDiff = 10, maxHumidity = 95 } = options;

  // First aggregate hourly for per-hour stats
  const hourly = patRichAggregate(series, 60);

  // Build set of hours that fail the advanced checks
  const failedHours = new Set<string>();
  for (const pt of hourly.points) {
    if (pt.pm25A.count < minCount || pt.pm25B.count < minCount) {
      failedHours.add(pt.timestamp);
      continue;
    }
    if (pt.abTTest && pt.abTTest.p < maxPValue) {
      const meanDiff = Math.abs((pt.pm25A.mean ?? 0) - (pt.pm25B.mean ?? 0));
      if (meanDiff > maxMeanDiff) {
        failedHours.add(pt.timestamp);
      }
    }
  }

  // Now flag individual points
  const channelDriftIndices = new Set<number>();
  const humidityIndices = new Set<number>();
  const pValueIndices = new Set<number>();

  series.points.forEach((point, index) => {
    // Basic drift check
    const agreement = evaluateChannelAgreement(point.pm25A, point.pm25B, "qapp-hourly");
    if (!agreement.valid && agreement.level !== "unavailable") {
      channelDriftIndices.add(index);
    }
    // Humidity check
    if ((point.humidity ?? 0) > maxHumidity) {
      humidityIndices.add(index);
    }
    // Check if this point's hour failed advanced checks
    const stamp = new Date(point.timestamp);
    const hourKey = formatInTimeZone(stamp, series.meta.timezone, "yyyy-MM-dd") + "T" +
      formatInTimeZone(stamp, series.meta.timezone, "HH") + ":00";
    const zonedDate = fromZonedTime(`${hourKey}:00`, series.meta.timezone);
    const hourTimestamp = formatISO(zonedDate);
    if (failedHours.has(hourTimestamp)) {
      pValueIndices.add(index);
    }
  });

  const allFlagged = new Set([...channelDriftIndices, ...humidityIndices, ...pValueIndices]);
  let removedPoints = 0;

  const cleanedSeries: PatSeries = {
    ...series,
    points: series.points.map((point, index) => {
      if (!removeOutOfSpec || !allFlagged.has(index)) return point;
      removedPoints++;
      return { ...point, pm25A: null, pm25B: null };
    })
  };

  const flaggedPoints = allFlagged.size;
  const status = flaggedPoints === 0 ? "ok" : flaggedPoints / Math.max(series.points.length, 1) > 0.2 ? "fail" : "warning";

  return qcResultSchema.parse({
    sensorId: series.meta.sensorId,
    totalPoints: series.points.length,
    flaggedPoints,
    removedPoints,
    status,
    issues: [
      { code: "channel-drift", message: "Large PM2.5 disagreement between channels A and B.", count: channelDriftIndices.size },
      { code: "humidity-saturation", message: `Humidity exceeds ${maxHumidity}%.`, count: humidityIndices.size },
      { code: "hourly-pvalue-fail", message: `Hourly A/B t-test p < ${maxPValue} with mean diff > ${maxMeanDiff}.`, count: pValueIndices.size }
    ].filter((issue) => issue.count > 0),
    cleanedSeries
  });
}

// --- Paper 3 (Carroll et al. 2025, Sci. Reports) QC pipeline ------------------------------------
// Implements the nine-rule PurpleAir cleaning recipe described in the Methods / Data sources
// section. The rules are split into monitor-level short-circuits (drop the whole sensor) and
// observation-level gates (null out specific PM2.5 / T / RH points).
// Reference: "Estimating PM2.5 concentrations at public schools in North Carolina using multiple
// data sources and interpolation methods", Sci. Reports 15:42600 (2025).

export type Paper3QcOptions = {
  /** Relative % disagreement between A/B channels considered a drop when avg > abHighCutoff. */
  abHighPercentThreshold?: number; // default 0.10 (i.e. 10%)
  /** µg/m³ cutoff above which we switch from absolute to percent A/B rule. */
  abHighCutoff?: number;           // default 100
  /** Absolute µg/m³ A-B disagreement considered a drop when avg <= abHighCutoff. */
  abLowAbsoluteThreshold?: number; // default 10
  /** RH drops outside (rhMin, rhMax) exclusive per the paper. */
  rhMin?: number;                  // default 0
  rhMax?: number;                  // default 100
  /** °F. Drops outside (tempMinF, tempMaxF) exclusive. */
  tempMinF?: number;               // default -200
  tempMaxF?: number;               // default 1000
  /** Minimum full-series temperature range in °F to consider a monitor outdoor. */
  minTempRangeF?: number;          // default 10 (paper tested 10 and 20)
  /** IQR multiplier for the median ± m*IQR observation-level outlier gate. */
  iqrMultiplier?: number;          // default 1.5
  /** Max fraction of null PM2.5 observations before the monitor is dropped. */
  maxMissingFraction?: number;     // default 0.10
  /** If true, observations that fail a gate are nulled out in cleanedSeries. */
  removeOutOfSpec?: boolean;       // default false
  /** If true, caller is asserting that the upstream metadata flagged this sensor indoor. */
  locationIsIndoor?: boolean;      // default false
};

export type Paper3MonitorVerdict =
  | "keep"
  | "drop-indoor"
  | "drop-temp-all-missing"
  | "drop-temp-range-too-small"
  | "drop-missing-data-exceeded";

export type Paper3QcResult = {
  sensorId: string;
  monitorVerdict: Paper3MonitorVerdict;
  totalPoints: number;
  flaggedPoints: number;
  removedPoints: number;
  missingFraction: number;
  tempRangeF: number | null;
  iqr: { median: number; q1: number; q3: number; lowFence: number; highFence: number } | null;
  issues: { code: string; message: string; count: number }[];
  cleanedSeries: PatSeries;
};

function computeIqrStats(values: number[], multiplier: number):
  { median: number; q1: number; q3: number; lowFence: number; highFence: number } | null {
  const finite = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (finite.length < 4) return null;
  const q = (p: number) => {
    const idx = (finite.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return finite[lo];
    return finite[lo] + (finite[hi] - finite[lo]) * (idx - lo);
  };
  const q1 = q(0.25);
  const q3 = q(0.75);
  const med = q(0.5);
  const iqr = q3 - q1;
  return {
    median: med,
    q1,
    q3,
    lowFence: med - multiplier * iqr,
    highFence: med + multiplier * iqr,
  };
}

export function runPaper3Qc(series: PatSeries, options: Paper3QcOptions = {}): Paper3QcResult {
  const {
    abHighPercentThreshold = 0.10,
    abHighCutoff = 100,
    abLowAbsoluteThreshold = 10,
    rhMin = 0,
    rhMax = 100,
    tempMinF = -200,
    tempMaxF = 1000,
    minTempRangeF = 10,
    iqrMultiplier = 1.5,
    maxMissingFraction = 0.10,
    removeOutOfSpec = false,
    locationIsIndoor = false,
  } = options;

  const sensorId = series.meta.sensorId;
  const totalPoints = series.points.length;
  const pmNullCount = series.points.filter((p) => p.pm25A === null && p.pm25B === null).length;
  const missingFraction = totalPoints === 0 ? 1 : pmNullCount / totalPoints;

  const tempValues = series.points
    .map((p) => p.temperature)
    .filter((t): t is number => t !== null && Number.isFinite(t));
  const tempRangeF = tempValues.length ? Math.max(...tempValues) - Math.min(...tempValues) : null;

  // --- Monitor-level short-circuits -----------------------------------------------------------
  const emptyResult = (verdict: Paper3MonitorVerdict, reason: string): Paper3QcResult => ({
    sensorId,
    monitorVerdict: verdict,
    totalPoints,
    flaggedPoints: totalPoints,
    removedPoints: removeOutOfSpec ? totalPoints : 0,
    missingFraction,
    tempRangeF,
    iqr: null,
    issues: [{ code: verdict, message: reason, count: totalPoints }],
    cleanedSeries: removeOutOfSpec
      ? { ...series, points: series.points.map((p) => ({ ...p, pm25A: null, pm25B: null })) }
      : series,
  });

  if (locationIsIndoor) {
    return emptyResult("drop-indoor", "Monitor metadata flagged as indoor.");
  }
  if (tempValues.length === 0) {
    return emptyResult("drop-temp-all-missing", "All temperature observations are missing.");
  }
  if (tempRangeF !== null && tempRangeF < minTempRangeF) {
    return emptyResult(
      "drop-temp-range-too-small",
      `Temperature range ${tempRangeF.toFixed(1)}°F < ${minTempRangeF}°F suggests indoor monitor.`,
    );
  }
  if (missingFraction > maxMissingFraction) {
    return emptyResult(
      "drop-missing-data-exceeded",
      `Missing-data fraction ${(missingFraction * 100).toFixed(1)}% exceeds ${(maxMissingFraction * 100).toFixed(1)}%.`,
    );
  }

  // --- Observation-level gates ----------------------------------------------------------------
  const avgValues = series.points.map((p) =>
    p.pm25A !== null && p.pm25B !== null ? (p.pm25A + p.pm25B) / 2 : null,
  );
  const iqr = computeIqrStats(
    avgValues.filter((v): v is number => v !== null),
    iqrMultiplier,
  );

  const abHighIdx = new Set<number>();
  const abLowIdx = new Set<number>();
  const rhIdx = new Set<number>();
  const tempIdx = new Set<number>();
  const iqrIdx = new Set<number>();

  series.points.forEach((point, i) => {
    const a = point.pm25A;
    const b = point.pm25B;
    if (a !== null && b !== null) {
      const avg = (a + b) / 2;
      const diff = Math.abs(a - b);
      if (avg > abHighCutoff && avg > 0 && diff / avg > abHighPercentThreshold) {
        abHighIdx.add(i);
      } else if (avg <= abHighCutoff && diff > abLowAbsoluteThreshold) {
        abLowIdx.add(i);
      }
    }
    if (point.humidity != null && (point.humidity <= rhMin || point.humidity >= rhMax)) {
      rhIdx.add(i);
    }
    if (point.temperature != null && (point.temperature <= tempMinF || point.temperature >= tempMaxF)) {
      tempIdx.add(i);
    }
    const avg = avgValues[i];
    if (iqr && avg !== null && (avg < iqr.lowFence || avg > iqr.highFence)) {
      iqrIdx.add(i);
    }
  });

  const allFlagged = new Set<number>([...abHighIdx, ...abLowIdx, ...rhIdx, ...tempIdx, ...iqrIdx]);
  let removedPoints = 0;

  const cleanedPoints = series.points.map((point, i) => {
    if (!allFlagged.has(i)) return point;
    if (!removeOutOfSpec) return point;
    removedPoints++;
    return {
      ...point,
      pm25A: abHighIdx.has(i) || abLowIdx.has(i) || iqrIdx.has(i) ? null : point.pm25A,
      pm25B: abHighIdx.has(i) || abLowIdx.has(i) || iqrIdx.has(i) ? null : point.pm25B,
      humidity: rhIdx.has(i) ? null : point.humidity,
      temperature: tempIdx.has(i) ? null : point.temperature,
    };
  });

  return {
    sensorId,
    monitorVerdict: "keep",
    totalPoints,
    flaggedPoints: allFlagged.size,
    removedPoints,
    missingFraction,
    tempRangeF,
    iqr,
    issues: [
      { code: "ab-drift-high", message: `|A-B|/avg > ${abHighPercentThreshold * 100}% when avg > ${abHighCutoff}.`, count: abHighIdx.size },
      { code: "ab-drift-low", message: `|A-B| > ${abLowAbsoluteThreshold} µg/m³ when avg ≤ ${abHighCutoff}.`, count: abLowIdx.size },
      { code: "rh-out-of-range", message: `Relative humidity outside (${rhMin}, ${rhMax}).`, count: rhIdx.size },
      { code: "temp-out-of-range", message: `Temperature outside (${tempMinF}, ${tempMaxF}) °F.`, count: tempIdx.size },
      { code: "iqr-outlier", message: `PM2.5 average outside median ± ${iqrMultiplier}·IQR.`, count: iqrIdx.size },
    ].filter((issue) => issue.count > 0),
    cleanedSeries: { ...series, points: cleanedPoints },
  };
}

/**
 * Reduced Major Axis (RMA) / geometric-mean regression. Unlike OLS this minimizes the product
 * of x- and y-residuals, which is appropriate for inter-unit comparisons where both axes have
 * measurement error (Paper 1 Supplementary §1 uses this for PurpleAir A/B agreement).
 */
export function reducedMajorAxisRegression(
  xs: number[],
  ys: number[],
): { slope: number; intercept: number; pearsonR: number; n: number } | null {
  if (xs.length !== ys.length || xs.length < 3) return null;
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < xs.length; i++) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) pairs.push([xs[i], ys[i]]);
  }
  if (pairs.length < 3) return null;
  const n = pairs.length;
  const meanX = pairs.reduce((s, p) => s + p[0], 0) / n;
  const meanY = pairs.reduce((s, p) => s + p[1], 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y] of pairs) {
    const dx = x - meanX;
    const dy = y - meanY;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  const slopeSign = sxy >= 0 ? 1 : -1;
  const slope = slopeSign * Math.sqrt(syy / sxx);
  const intercept = meanY - slope * meanX;
  const pearsonR = sxy / Math.sqrt(sxx * syy);
  return { slope, intercept, pearsonR, n };
}

export function patInternalFit(series: PatSeries): LinearFitResult | null {
  const pairs = series.points
    .filter((p) => p.pm25A !== null && p.pm25B !== null)
    .map((p) => ({ a: p.pm25A!, b: p.pm25B! }));
  if (pairs.length < 3) return null;
  return linearRegression(pairs.map((p) => p.a), pairs.map((p) => p.b));
}

export function patCreateAirSensor(series: PatSeries, options?: AdvancedQcOptions): AirSensorSeries {
  const qc = runAdvancedHourlyAbQc(series, { removeOutOfSpec: true, ...options });
  const hourly = patAggregate(qc.cleanedSeries, 60);
  return {
    meta: hourly.meta,
    points: hourly.points.map((point) => ({
      timestamp: point.timestamp,
      pm25: point.pm25A !== null && point.pm25B !== null
        ? Number(((point.pm25A + point.pm25B) / 2).toFixed(3))
        : point.pm25A ?? point.pm25B,
      humidity: point.humidity ?? null,
      temperature: point.temperature ?? null,
      pressure: point.pressure ?? null
    }))
  };
}

export function calculateEnhancedDailySoh(series: PatSeries): EnhancedSohDailyMetrics[] {
  const expectedPoints = detectExpectedPointsPerDay(series.points);
  const buckets = new Map<string, PatPoint[]>();
  for (const point of series.points) {
    const dayKey = formatInTimeZone(new Date(point.timestamp), series.meta.timezone, "yyyy-MM-dd");
    const bucket = buckets.get(dayKey) ?? [];
    bucket.push(point);
    buckets.set(dayKey, bucket);
  }

  return [...buckets.entries()].map(([date, points]) => {
    const validPairs = points.filter((p) => p.pm25A !== null && p.pm25B !== null);
    const aValues = validPairs.map((p) => p.pm25A!);
    const bValues = validPairs.map((p) => p.pm25B!);
    const deltas = validPairs.map((p) => Math.abs(p.pm25A! - p.pm25B!));
    const correlation = pearsonCorrelation(aValues, bValues);

    // DC signal detection: % of points where std dev of pm25 in a sliding window is 0
    let dcCount = 0;
    const dcWindowSize = 6; // ~6 consecutive readings
    for (let i = 0; i <= points.length - dcWindowSize; i++) {
      const windowA = points.slice(i, i + dcWindowSize).map((p) => p.pm25A).filter((v): v is number => v !== null);
      if (windowA.length >= dcWindowSize && standardDeviation(windowA) === 0) {
        dcCount++;
      }
    }
    const pctDC = Number(((dcCount / Math.max(points.length - dcWindowSize + 1, 1)) * 100).toFixed(2));

    // Daily A/B linear fit
    const abFit = aValues.length >= 3 ? linearRegression(aValues, bValues) : null;

    // Daily t-test
    const abTTest = welchTTest(aValues, bValues);

    return {
      date,
      pctReporting: Number(((points.length / expectedPoints) * 100).toFixed(2)),
      pctValid: Number(((validPairs.length / Math.max(points.length, 1)) * 100).toFixed(2)),
      pctDataCompleteness: Number(((validPairs.length / expectedPoints) * 100).toFixed(2)),
      meanAbsoluteChannelDelta: Number(average(deltas).toFixed(3)),
      channelAgreementScore: Number(Math.max(0, 100 - average(deltas) * 8).toFixed(2)),
      otherFitScore: Number((((correlation + 1) / 2) * 100).toFixed(2)),
      pctDC,
      abFit,
      abTTest
    };
  });
}

export function calculateEnhancedSohIndex(series: PatSeries): EnhancedSohIndexResult {
  const metrics = calculateEnhancedDailySoh(series);
  const index =
    metrics.reduce((sum, m) => {
      const dcPenalty = m.pctDC > 10 ? 10 : 0; // penalize DC signal
      const daily =
        m.pctReporting * 0.20 +
        m.pctValid * 0.20 +
        m.pctDataCompleteness * 0.15 +
        m.channelAgreementScore * 0.20 +
        m.otherFitScore * 0.10 +
        (100 - m.pctDC) * 0.10 + // reward non-DC
        (m.abFit ? m.abFit.rSquared * 100 * 0.05 : 50 * 0.05) - dcPenalty;
      return sum + daily;
    }, 0) / Math.max(metrics.length, 1);

  const normalizedIndex = Number(Math.max(0, Math.min(100, index)).toFixed(2));
  const status = normalizedIndex >= 85 ? "excellent" : normalizedIndex >= 70 ? "good" : normalizedIndex >= 50 ? "watch" : "poor";

  return { sensorId: series.meta.sensorId, index: normalizedIndex, status, metrics };
}

// ---------------------------------------------------------------------------
// pasPalette – AQI color palette
// ---------------------------------------------------------------------------

export function pasPalette(parameter: "pm25" | "temperature" | "humidity" = "pm25"): { breaks: number[]; colors: string[]; labels: string[] } {
  if (parameter === "pm25") {
    return {
      breaks: [0, 9.1, 35.5, 55.5, 125.5, 225.5, 325.5],
      colors: ["#2e9d5b", "#f0c419", "#f2994a", "#d64545", "#7d3c98", "#8b0000"],
      labels: ["Good", "Moderate", "USG", "Unhealthy", "Very Unhealthy", "Hazardous"]
    };
  }
  if (parameter === "temperature") {
    return {
      breaks: [-40, 32, 50, 68, 86, 104, 185],
      colors: ["#313695", "#4575b4", "#74add1", "#fdae61", "#f46d43", "#a50026"],
      labels: ["Freezing", "Cold", "Cool", "Warm", "Hot", "Extreme"]
    };
  }
  // humidity
  return {
    breaks: [0, 20, 40, 60, 80, 100],
    colors: ["#ffffcc", "#a1dab4", "#41b6c4", "#2c7fb8", "#253494"],
    labels: ["Very Dry", "Dry", "Comfortable", "Humid", "Very Humid"]
  };
}

// ---------------------------------------------------------------------------
// pasEnhanceData – Spatial enrichment from coordinates
// ---------------------------------------------------------------------------

// Internal helper
function approximateTimezone(longitude: number): string {
  // Simple UTC offset mapping from longitude
  const offset = Math.round(longitude / 15);
  const tzMap: Record<number, string> = {
    [-5]: "America/New_York",
    [-6]: "America/Chicago",
    [-7]: "America/Denver",
    [-8]: "America/Los_Angeles",
    [-9]: "America/Anchorage",
    [-10]: "Pacific/Honolulu",
    [0]: "Europe/London",
    [1]: "Europe/Paris",
    [8]: "Asia/Shanghai",
    [9]: "Asia/Tokyo",
    [10]: "Australia/Sydney",
  };
  return tzMap[offset] ?? `Etc/GMT${offset >= 0 ? "-" : "+"}${Math.abs(offset)}`;
}

export function pasEnhanceData(collection: PasCollection): PasCollection {
  return {
    ...collection,
    records: collection.records.map((record) => {
      // Approximate timezone from longitude if not set
      const tz = record.timezone ?? approximateTimezone(record.longitude);
      return {
        ...record,
        timezone: tz,
        // Compute distance to a reference point if not set (placeholder for PWFSL)
        uniqueId: record.uniqueId ?? `${record.id}-${record.locationType}-${record.latitude.toFixed(4)}-${record.longitude.toFixed(4)}`
      };
    })
  };
}

// ---------------------------------------------------------------------------
// patExternalFit – External fit against reference data
// ---------------------------------------------------------------------------

export function patExternalFit(
  series: PatSeries,
  reference: PatSeries
): ExternalFitResult | null {
  // Match timestamps between sensor and reference, compute regression
  const refMap = new Map(reference.points.map((p) => [p.timestamp.slice(0, 13), p])); // match by hour
  const pairs: Array<{ timestamp: string; sensor: number; reference: number }> = [];

  for (const point of series.points) {
    const hourKey = point.timestamp.slice(0, 13);
    const refPoint = refMap.get(hourKey);
    if (!refPoint) continue;
    const sensorVal = point.pm25A !== null && point.pm25B !== null ? (point.pm25A + point.pm25B) / 2 : null;
    const refVal = refPoint.pm25A !== null && refPoint.pm25B !== null ? (refPoint.pm25A + refPoint.pm25B) / 2 : refPoint.pm25A;
    if (sensorVal === null || refVal === null) continue;
    pairs.push({ timestamp: point.timestamp, sensor: sensorVal, reference: refVal });
  }

  if (pairs.length < 3) return null;
  const fit = linearRegression(pairs.map((p) => p.sensor), pairs.map((p) => p.reference));
  if (!fit) return null;

  return {
    fit,
    referenceSensorId: reference.meta.sensorId,
    referenceLabel: reference.meta.label,
    pairs
  };
}

export const EPA_SENSOR_VALIDATION_TARGETS: ReferenceValidationTargets = {
  minRSquared: 0.7,
  maxRmse: 7,
  maxNrmsePct: 30,
  slopeLow: 0.65,
  slopeHigh: 1.35,
  interceptLow: -5,
  interceptHigh: 5,
};

function referenceDistanceKm(series: PatSeries, reference: ReferenceObservationSeries | null): number | null {
  if (
    typeof series.meta.latitude !== "number"
    || typeof series.meta.longitude !== "number"
    || !reference
    || !Number.isFinite(reference.latitude)
    || !Number.isFinite(reference.longitude)
  ) {
    return null;
  }

  return Number(haversineKm(
    { latitude: series.meta.latitude, longitude: series.meta.longitude },
    { latitude: reference.latitude, longitude: reference.longitude },
  ).toFixed(3));
}

function buildReferenceValidation(
  series: PatSeries,
  reference: ReferenceObservationSeries | null,
  regressionPairs: Array<ComparisonPair & { sensorPm25Mean: number; referencePm25: number }>,
  fit: LinearFitResult | null,
): ReferenceValidationResult | null {
  if (!reference) return null;
  const n = regressionPairs.length;
  if (n < 3 || !fit) {
    return {
      source: reference.source,
      n,
      timeOverlapHours: new Set(regressionPairs.map((pair) => pair.timestamp.slice(0, 13))).size,
      distanceKm: referenceDistanceKm(series, reference),
      slope: fit?.slope ?? null,
      intercept: fit?.intercept ?? null,
      rSquared: fit?.rSquared ?? null,
      rmse: null,
      nrmsePct: null,
      mae: null,
      bias: null,
      status: "insufficient",
      targets: EPA_SENSOR_VALIDATION_TARGETS,
    };
  }

  let sqSum = 0;
  let absSum = 0;
  let biasSum = 0;
  const referenceValues: number[] = [];
  for (const pair of regressionPairs) {
    const error = pair.sensorPm25Mean - pair.referencePm25;
    sqSum += error * error;
    absSum += Math.abs(error);
    biasSum += error;
    referenceValues.push(pair.referencePm25);
  }

  const rmse = Math.sqrt(sqSum / n);
  const mae = absSum / n;
  const bias = biasSum / n;
  const referenceRange = Math.max(...referenceValues) - Math.min(...referenceValues);
  const nrmsePct = referenceRange > 0 ? (rmse / referenceRange) * 100 : null;
  const targetFailures = [
    fit.rSquared < EPA_SENSOR_VALIDATION_TARGETS.minRSquared,
    rmse > EPA_SENSOR_VALIDATION_TARGETS.maxRmse,
    nrmsePct !== null && nrmsePct > EPA_SENSOR_VALIDATION_TARGETS.maxNrmsePct,
    fit.slope < EPA_SENSOR_VALIDATION_TARGETS.slopeLow || fit.slope > EPA_SENSOR_VALIDATION_TARGETS.slopeHigh,
    fit.intercept < EPA_SENSOR_VALIDATION_TARGETS.interceptLow || fit.intercept > EPA_SENSOR_VALIDATION_TARGETS.interceptHigh,
  ].filter(Boolean).length;

  return {
    source: reference.source,
    n,
    timeOverlapHours: new Set(regressionPairs.map((pair) => pair.timestamp.slice(0, 13))).size,
    distanceKm: referenceDistanceKm(series, reference),
    slope: fit.slope,
    intercept: fit.intercept,
    rSquared: fit.rSquared,
    rmse: Number(rmse.toFixed(3)),
    nrmsePct: nrmsePct === null ? null : Number(nrmsePct.toFixed(2)),
    mae: Number(mae.toFixed(3)),
    bias: Number(bias.toFixed(3)),
    status: targetFailures === 0 ? "pass" : targetFailures <= 2 ? "watch" : "fail",
    targets: EPA_SENSOR_VALIDATION_TARGETS,
  };
}

export function buildReferenceComparison(
  series: PatSeries,
  reference: ReferenceObservationSeries | null,
): ComparisonResult {
  const hourKey = (timestamp: string) => {
    const time = new Date(timestamp).getTime();
    if (!Number.isFinite(time)) return timestamp.slice(0, 13);
    return new Date(Math.floor(time / 3_600_000) * 3_600_000).toISOString().slice(0, 13);
  };
  const referenceByHour = new Map<string, ReferenceObservationPoint>();
  for (const observation of reference?.observations ?? []) {
    referenceByHour.set(hourKey(observation.timestamp), observation);
  }

  const pairs: ComparisonPair[] = series.points.map((point) => {
    const referencePoint = referenceByHour.get(hourKey(point.timestamp));
    const sensorPm25Mean = point.pm25A !== null && point.pm25B !== null
      ? Number(((point.pm25A + point.pm25B) / 2).toFixed(3))
      : point.pm25A ?? point.pm25B;

    return {
      timestamp: point.timestamp,
      sensorPm25A: point.pm25A,
      sensorPm25B: point.pm25B,
      sensorPm25Mean,
      referencePm25: referencePoint?.pm25 ?? null,
      referenceAqi: referencePoint?.aqi ?? null,
    };
  }).filter((pair) => pair.sensorPm25Mean !== null || pair.referencePm25 !== null || pair.referenceAqi !== null);

  const regressionPairs = pairs.filter((pair): pair is ComparisonPair & { sensorPm25Mean: number; referencePm25: number } => (
    typeof pair.sensorPm25Mean === "number"
    && Number.isFinite(pair.sensorPm25Mean)
    && typeof pair.referencePm25 === "number"
    && Number.isFinite(pair.referencePm25)
  ));
  const fit = regressionPairs.length >= 3
    ? linearRegression(
      regressionPairs.map((pair) => pair.sensorPm25Mean),
      regressionPairs.map((pair) => pair.referencePm25),
    )
    : null;

  return {
    sensor: series.meta,
    reference,
    pairs,
    fit,
    validation: buildReferenceValidation(series, reference, regressionPairs, fit),
  };
}

// ---------------------------------------------------------------------------
// patRollingMean – Rolling average for timeseries smoothing
// ---------------------------------------------------------------------------

export function patRollingMean(series: PatSeries, windowSize = 5): PatSeries {
  const roll = (values: (number | null)[], size: number): (number | null)[] => {
    return values.map((_, i) => {
      const start = Math.max(0, i - Math.floor(size / 2));
      const end = Math.min(values.length, i + Math.ceil(size / 2));
      const window = values.slice(start, end).filter((v): v is number => v !== null);
      return window.length > 0 ? Number((window.reduce((a, b) => a + b, 0) / window.length).toFixed(3)) : null;
    });
  };

  const rolledA = roll(series.points.map((p) => p.pm25A), windowSize);
  const rolledB = roll(series.points.map((p) => p.pm25B), windowSize);

  return {
    ...series,
    points: series.points.map((point, i) => ({
      ...point,
      pm25A: rolledA[i],
      pm25B: rolledB[i]
    }))
  };
}

// ---------------------------------------------------------------------------
// patScatterMatrix – Prepare scatter matrix data
// ---------------------------------------------------------------------------

export function patScatterMatrix(series: PatSeries, sampleSize = 500): ScatterMatrixData {
  const sampled = sampleSize < series.points.length ? patSample(series, sampleSize) : series;
  const variables = ["pm25A", "pm25B", "humidity", "temperature", "pressure"] as const;

  const extract = (v: typeof variables[number]) =>
    sampled.points.map((p) => p[v]).filter((val): val is number => val !== null && val !== undefined);

  const pairs: ScatterMatrixData["pairs"] = [];
  for (let i = 0; i < variables.length; i++) {
    for (let j = i + 1; j < variables.length; j++) {
      const xData = extract(variables[i]);
      const yData = extract(variables[j]);
      // Align arrays to same length
      const len = Math.min(xData.length, yData.length);
      const x = xData.slice(0, len);
      const y = yData.slice(0, len);
      pairs.push({
        xVar: variables[i],
        yVar: variables[j],
        points: x.map((val, k) => [val, y[k]]),
        correlation: pearsonCorrelation(x, y)
      });
    }
  }

  return { variables: [...variables], pairs };
}

// ---------------------------------------------------------------------------
// Spatial Interpolation
// ---------------------------------------------------------------------------

export type InterpolationPoint = {
  id?: string; // stable sensor id when available
  x: number; // longitude
  y: number; // latitude
  value: number; // PM2.5 or AQI
  elevationMeters?: number | null;
};

export type InterpolationGrid = {
  width: number;
  height: number;
  bounds: { west: number; east: number; south: number; north: number };
  values: Float64Array; // row-major, width * height
  min: number;
  max: number;
  diagnostics?: InterpolationDiagnostics;
};

export type InterpolationMethod = "idw" | "kriging";

export type InterpolationDiagnostics = {
  kriging?: KrigingDiagnostics;
};

export type KrigingDiagnostics = {
  variogram: {
    nugget: number;
    sill: number;
    rangeKm: number;
  };
  maxNeighbors: number;
  requestedTileSize: number;
  effectiveTileSize: number;
  mode: "exact" | "tiled";
  fallbackReason?: "range-to-cell-spacing" | "tile-artifact-score";
  artifacts: KrigingArtifactMetrics;
};

export type KrigingArtifactMetrics = {
  inputMin: number;
  inputMax: number;
  outputMin: number;
  outputMax: number;
  overshootRate: number;
  severeOvershootRate: number;
  negativeRate: number;
  gridCellSpacingKm: number;
  variogramRangeKm: number;
  rangeToCellSpacingRatio: number;
  seamMeanRatio: number;
  tileBoundaryOutlierRate: number;
  interiorEdgeP95: number;
  boundaryEdgeP95: number;
  exactSampleComparison?: {
    sampleCount: number;
    meanAbs: number;
    p95Abs: number;
    p99Abs: number;
    overOneUgM3Rate: number;
    overTwoUgM3Rate: number;
    overFiveUgM3Rate: number;
  };
};

export type OrdinaryKrigingModel = {
  pointXs: Float64Array;
  pointYs: Float64Array;
  pointValues: Float64Array;
  pairwiseSemivariance: Float64Array;
  nugget: number;
  sill: number;
  range: number;
  valueMin: number;
  valueMax: number;
};

const EARTH_RADIUS_KM = 6371;
const EARTH_RADIUS_KM_SQUARED = EARTH_RADIUS_KM * EARTH_RADIUS_KM;
const KRIGING_MIN_RANGE_TO_CELL_SPACING_FOR_TILES = 2;
const KRIGING_MAX_SAFE_SEAM_MEAN_RATIO = 8;
const KRIGING_MAX_SAFE_BOUNDARY_OUTLIER_RATE = 0.35;

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function approximateDistanceKm(ax: number, ay: number, bx: number, by: number): number {
  const lat1 = toRadians(ay);
  const lat2 = toRadians(by);
  const deltaLon = toRadians(bx - ax);
  const deltaLat = lat2 - lat1;
  const x = deltaLon * Math.cos((lat1 + lat2) / 2);
  return Math.sqrt(x * x + deltaLat * deltaLat) * EARTH_RADIUS_KM;
}

function approximateDistanceSquaredKm(ax: number, ay: number, bx: number, by: number): number {
  const lat1 = toRadians(ay);
  const lat2 = toRadians(by);
  const deltaLon = toRadians(bx - ax);
  const deltaLat = lat2 - lat1;
  const x = deltaLon * Math.cos((lat1 + lat2) / 2);
  return (x * x + deltaLat * deltaLat) * EARTH_RADIUS_KM_SQUARED;
}

function projectLongitudeKm(longitude: number, cosLatitude: number): number {
  return toRadians(longitude) * cosLatitude * EARTH_RADIUS_KM;
}

function projectLatitudeKm(latitude: number): number {
  return toRadians(latitude) * EARTH_RADIUS_KM;
}

function projectedDistanceSquaredKm(ax: number, ay: number, bx: number, by: number): number {
  const deltaX = bx - ax;
  const deltaY = by - ay;
  return deltaX * deltaX + deltaY * deltaY;
}

function mergeCoincidentPoints(points: InterpolationPoint[]): InterpolationPoint[] {
  const merged = new Map<string, { x: number; y: number; total: number; count: number }>();

  for (const point of points) {
    const key = `${point.x}|${point.y}`;
    const existing = merged.get(key);
    if (existing) {
      existing.total += point.value;
      existing.count += 1;
      continue;
    }

    merged.set(key, {
      x: point.x,
      y: point.y,
      total: point.value,
      count: 1,
    });
  }

  return Array.from(merged.values(), (entry) => ({
    x: entry.x,
    y: entry.y,
    value: entry.total / entry.count,
  }));
}

export function idwInterpolate(
  knownPoints: InterpolationPoint[],
  gridWidth: number,
  gridHeight: number,
  bounds: { west: number; east: number; south: number; north: number },
  power: number = 2,
  maxNeighbors: number = -1 // -1 = use all
): InterpolationGrid {
  const normalizedPoints = mergeCoincidentPoints(knownPoints);

  if (gridWidth < 1 || gridHeight < 1) {
    return {
      width: gridWidth,
      height: gridHeight,
      bounds,
      values: new Float64Array(0),
      min: 0,
      max: 0,
    };
  }

  const values = new Float64Array(gridWidth * gridHeight);
  if (normalizedPoints.length === 0) {
    return { width: gridWidth, height: gridHeight, bounds, values, min: 0, max: 0 };
  }

  let min = Infinity, max = -Infinity;

  const lonStep = gridWidth > 1 ? (bounds.east - bounds.west) / (gridWidth - 1) : 0;
  const latStep = gridHeight > 1 ? (bounds.north - bounds.south) / (gridHeight - 1) : 0;
  const neighborLimit = maxNeighbors > 0 && maxNeighbors < normalizedPoints.length
    ? maxNeighbors
    : 0;
  const neighborDistances = neighborLimit > 0 ? new Float64Array(neighborLimit) : null;
  const neighborValues = neighborLimit > 0 ? new Float64Array(neighborLimit) : null;
  const powerScale = power / 2;

  for (let row = 0; row < gridHeight; row++) {
    for (let col = 0; col < gridWidth; col++) {
      const x = bounds.west + col * lonStep;
      const y = bounds.south + row * latStep;

      let exactMatch = false;
      let weightSum = 0;
      let valueSum = 0;
      let neighborCount = 0;
      let worstNeighborSlot = 0;
      let worstNeighborDistanceSq = -Infinity;

      for (const p of normalizedPoints) {
        const distSq = approximateDistanceSquaredKm(x, y, p.x, p.y);

        if (distSq < 1e-20) {
          values[row * gridWidth + col] = p.value;
          exactMatch = true;
          break;
        }

        if (neighborLimit === 0) {
          const w = power === 2 ? 1 / distSq : Math.pow(distSq, -powerScale);
          weightSum += w;
          valueSum += w * p.value;
          continue;
        }

        if (neighborCount < neighborLimit) {
          neighborDistances![neighborCount] = distSq;
          neighborValues![neighborCount] = p.value;
          if (distSq > worstNeighborDistanceSq) {
            worstNeighborDistanceSq = distSq;
            worstNeighborSlot = neighborCount;
          }
          neighborCount++;
          continue;
        }

        if (distSq < worstNeighborDistanceSq) {
          neighborDistances![worstNeighborSlot] = distSq;
          neighborValues![worstNeighborSlot] = p.value;

          worstNeighborDistanceSq = neighborDistances![0];
          worstNeighborSlot = 0;
          for (let slot = 1; slot < neighborCount; slot++) {
            if (neighborDistances![slot] > worstNeighborDistanceSq) {
              worstNeighborDistanceSq = neighborDistances![slot];
              worstNeighborSlot = slot;
            }
          }
        }
      }

      if (exactMatch) {
        const v = values[row * gridWidth + col];
        if (v < min) min = v;
        if (v > max) max = v;
        continue;
      }

      if (neighborLimit > 0) {
        for (let i = 0; i < neighborCount; i++) {
          const w = power === 2 ? 1 / neighborDistances![i] : Math.pow(neighborDistances![i], -powerScale);
          weightSum += w;
          valueSum += w * neighborValues![i];
        }
      }

      const v = weightSum > 0 ? valueSum / weightSum : 0;
      values[row * gridWidth + col] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }

  return { width: gridWidth, height: gridHeight, bounds, values, min, max };
}

// ---------------------------------------------------------------------------
// Spatio-temporal IDW (Carroll et al. 2025 / Li-Heap style)
//
// Weight: w = 1 / (d^2 + C * |dt|)
//   - d is great-circle distance in km between query and sensor
//   - dt is time offset in days between query timestamp and sensor timestamp
//   - C is a tunable parameter (km^2 / day); grid-searched by LOOCV RMSE
//
// Defaults follow the NC schools PM2.5 study: 500 km spatial radius,
// +/- 90 day time window. The helper also supports arbitrary query
// locations (schools, POIs) so exposure can be interpolated to points
// rather than a raster grid.
// ---------------------------------------------------------------------------

export type SpatioTemporalPoint = {
  id?: string;
  x: number; // longitude
  y: number; // latitude
  t: number; // timestamp in milliseconds since epoch
  value: number;
};

export type SpatioTemporalIdwOptions = {
  power?: number;            // default 2 (applied to spatial distance)
  timeWeightC?: number;      // default 1 (units: km^2 / day)
  maxDistanceKm?: number;    // default 500
  maxDaysBack?: number;      // default 90 (how far in past to consider)
  maxDaysForward?: number;   // default 90 (how far in future to consider)
  maxNeighbors?: number;     // default -1 (use all within window)
  minNeighbors?: number;     // default 1
};

export type SpatioTemporalQuery = {
  id?: string;
  x: number;
  y: number;
  t: number;
};

export type SpatioTemporalEstimate = {
  id?: string;
  x: number;
  y: number;
  t: number;
  value: number | null; // null when no valid neighbors in window
  neighborCount: number;
  weightSum: number;
};

const MS_PER_DAY = 86_400_000;
const SPATIOTEMPORAL_EPS = 1e-12;

export function computeSpatioTemporalIdwWeight(
  spatialDistSqKm2: number,
  timeDeltaDays: number,
  timeWeightC: number,
  power: number = 2,
): number {
  const spatialTerm = power === 2
    ? spatialDistSqKm2
    : Math.pow(Math.max(spatialDistSqKm2, 0), power / 2);
  const denom = spatialTerm + timeWeightC * Math.abs(timeDeltaDays);
  if (denom <= 0) return Number.POSITIVE_INFINITY;
  return 1 / denom;
}

function normalizeStOptions(options: SpatioTemporalIdwOptions): {
  power: number;
  timeWeightC: number;
  maxDistanceKm: number;
  maxDaysBack: number;
  maxDaysForward: number;
  maxNeighbors: number;
  minNeighbors: number;
  powerScale: number;
} {
  const power = options.power ?? 2;
  return {
    power,
    timeWeightC: options.timeWeightC ?? 1,
    maxDistanceKm: options.maxDistanceKm ?? 500,
    maxDaysBack: options.maxDaysBack ?? 90,
    maxDaysForward: options.maxDaysForward ?? 90,
    maxNeighbors: options.maxNeighbors ?? -1,
    minNeighbors: options.minNeighbors ?? 1,
    powerScale: power / 2,
  };
}

export function idwSpatioTemporalEstimate(
  points: SpatioTemporalPoint[],
  queries: SpatioTemporalQuery[],
  options: SpatioTemporalIdwOptions = {},
): SpatioTemporalEstimate[] {
  const cfg = normalizeStOptions(options);
  const maxDistSq = cfg.maxDistanceKm * cfg.maxDistanceKm;
  const results: SpatioTemporalEstimate[] = [];

  for (const q of queries) {
    let exactValue: number | null = null;
    const candidates: { w: number; value: number }[] = [];

    for (const p of points) {
      if (!Number.isFinite(p.value)) continue;
      const dtDays = (q.t - p.t) / MS_PER_DAY;
      if (dtDays > cfg.maxDaysBack) continue;
      if (-dtDays > cfg.maxDaysForward) continue;
      const distSq = approximateDistanceSquaredKm(q.x, q.y, p.x, p.y);
      if (distSq > maxDistSq) continue;

      const absDt = Math.abs(dtDays);
      if (distSq < SPATIOTEMPORAL_EPS && absDt < SPATIOTEMPORAL_EPS) {
        exactValue = p.value;
        break;
      }

      const spatialTerm = cfg.power === 2 ? distSq : Math.pow(Math.max(distSq, 0), cfg.powerScale);
      const denom = spatialTerm + cfg.timeWeightC * absDt;
      if (denom <= 0) continue;
      candidates.push({ w: 1 / denom, value: p.value });
    }

    if (exactValue !== null) {
      results.push({
        id: q.id,
        x: q.x,
        y: q.y,
        t: q.t,
        value: exactValue,
        neighborCount: 1,
        weightSum: Number.POSITIVE_INFINITY,
      });
      continue;
    }

    let selected = candidates;
    if (cfg.maxNeighbors > 0 && candidates.length > cfg.maxNeighbors) {
      candidates.sort((a, b) => b.w - a.w);
      selected = candidates.slice(0, cfg.maxNeighbors);
    }

    if (selected.length < cfg.minNeighbors) {
      results.push({
        id: q.id,
        x: q.x,
        y: q.y,
        t: q.t,
        value: null,
        neighborCount: selected.length,
        weightSum: 0,
      });
      continue;
    }

    let weightSum = 0;
    let valueSum = 0;
    for (const s of selected) {
      weightSum += s.w;
      valueSum += s.w * s.value;
    }

    results.push({
      id: q.id,
      x: q.x,
      y: q.y,
      t: q.t,
      value: weightSum > 0 ? valueSum / weightSum : null,
      neighborCount: selected.length,
      weightSum,
    });
  }

  return results;
}

export function idwSpatioTemporalInterpolateGrid(
  points: SpatioTemporalPoint[],
  gridWidth: number,
  gridHeight: number,
  bounds: { west: number; east: number; south: number; north: number },
  targetTime: number,
  options: SpatioTemporalIdwOptions = {},
): InterpolationGrid {
  if (gridWidth < 1 || gridHeight < 1) {
    return { width: gridWidth, height: gridHeight, bounds, values: new Float64Array(0), min: 0, max: 0 };
  }

  const values = new Float64Array(gridWidth * gridHeight);
  const lonStep = gridWidth > 1 ? (bounds.east - bounds.west) / (gridWidth - 1) : 0;
  const latStep = gridHeight > 1 ? (bounds.north - bounds.south) / (gridHeight - 1) : 0;

  const queries: SpatioTemporalQuery[] = [];
  queries.length = gridWidth * gridHeight;
  for (let row = 0; row < gridHeight; row++) {
    for (let col = 0; col < gridWidth; col++) {
      queries[row * gridWidth + col] = {
        x: bounds.west + col * lonStep,
        y: bounds.south + row * latStep,
        t: targetTime,
      };
    }
  }

  const estimates = idwSpatioTemporalEstimate(points, queries, options);

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < estimates.length; i++) {
    const v = estimates[i].value ?? 0;
    values[i] = v;
    if (v < min) min = v;
    if (v > max) max = v;
  }

  if (!Number.isFinite(min)) min = 0;
  if (!Number.isFinite(max)) max = 0;

  return { width: gridWidth, height: gridHeight, bounds, values, min, max };
}

export type StIdwLoocvResult = {
  timeWeightC: number;
  rmse: number;
  mae: number;
  bias: number;
  sampleCount: number;
};

export function stIdwLeaveOneOut(
  points: SpatioTemporalPoint[],
  timeWeightC: number,
  options: Omit<SpatioTemporalIdwOptions, "timeWeightC"> = {},
): StIdwLoocvResult {
  let sumSq = 0;
  let sumAbs = 0;
  let sumSigned = 0;
  let n = 0;

  for (let i = 0; i < points.length; i++) {
    const target = points[i];
    const others: SpatioTemporalPoint[] = [];
    for (let j = 0; j < points.length; j++) {
      if (j !== i) others.push(points[j]);
    }
    const est = idwSpatioTemporalEstimate(
      others,
      [{ x: target.x, y: target.y, t: target.t, id: target.id }],
      { ...options, timeWeightC },
    );
    if (!est[0] || est[0].value == null) continue;
    const err = est[0].value - target.value;
    sumSq += err * err;
    sumAbs += Math.abs(err);
    sumSigned += err;
    n++;
  }

  return {
    timeWeightC,
    rmse: n > 0 ? Math.sqrt(sumSq / n) : Number.NaN,
    mae: n > 0 ? sumAbs / n : Number.NaN,
    bias: n > 0 ? sumSigned / n : Number.NaN,
    sampleCount: n,
  };
}

export function stIdwGridSearchTimeWeight(
  points: SpatioTemporalPoint[],
  candidates: number[],
  options: Omit<SpatioTemporalIdwOptions, "timeWeightC"> = {},
): { best: StIdwLoocvResult; all: StIdwLoocvResult[] } {
  if (candidates.length === 0) {
    throw new Error("stIdwGridSearchTimeWeight requires at least one candidate timeWeightC");
  }
  const all = candidates.map((c) => stIdwLeaveOneOut(points, c, options));
  const valid = all.filter((r) => Number.isFinite(r.rmse));
  const best = valid.length > 0
    ? valid.reduce((a, b) => (a.rmse <= b.rmse ? a : b))
    : all[0];
  return { best, all };
}

function computeExperimentalVariogramFromDistanceMatrix(
  pointValues: Float64Array,
  pairwiseDistances: Float64Array,
  pointCount: number,
  maxPairDist: number,
  nBins: number = 15,
): Array<{ lag: number; gamma: number; count: number }> {
  if (maxPairDist <= 0) return [];
  const maxDist = maxPairDist / 2; // Use half max distance
  const binWidth = maxDist / nBins;
  const bins: Array<{ sum: number; count: number }> = Array.from({ length: nBins }, () => ({ sum: 0, count: 0 }));

  for (let i = 0; i < pointCount; i++) {
    const rowOffset = i * pointCount;
    for (let j = i + 1; j < pointCount; j++) {
      const dist = pairwiseDistances[rowOffset + j];
      if (dist > maxDist) continue;
      const valueDiff = pointValues[i] - pointValues[j];
      const binIdx = Math.min(Math.floor(dist / binWidth), nBins - 1);
      bins[binIdx].sum += valueDiff * valueDiff;
      bins[binIdx].count++;
    }
  }

  return bins
    .map((bin, i) => ({
      lag: (i + 0.5) * binWidth,
      gamma: bin.count > 0 ? bin.sum / (2 * bin.count) : 0,
      count: bin.count,
    }))
    .filter(b => b.count > 0);
}

function buildPairwiseDistanceMatrix(
  pointXs: Float64Array,
  pointYs: Float64Array,
): { distances: Float64Array; maxDistance: number } {
  const pointCount = pointXs.length;
  const distances = new Float64Array(pointCount * pointCount);
  let maxDistance = 0;

  for (let i = 0; i < pointCount; i++) {
    const rowOffset = i * pointCount;
    for (let j = i + 1; j < pointCount; j++) {
      const d = approximateDistanceKm(pointXs[i], pointYs[i], pointXs[j], pointYs[j]);
      distances[rowOffset + j] = d;
      distances[j * pointCount + i] = d;
      if (d > maxDistance) maxDistance = d;
    }
  }

  return { distances, maxDistance };
}

function convertPairwiseDistancesToSemivariances(
  pairwiseDistances: Float64Array,
  pointCount: number,
  nugget: number,
  sill: number,
  range: number,
): void {
  for (let i = 0; i < pointCount; i++) {
    const rowOffset = i * pointCount;
    for (let j = i + 1; j < pointCount; j++) {
      const gamma = sphericalVariogram(pairwiseDistances[rowOffset + j], nugget, sill, range);
      pairwiseDistances[rowOffset + j] = gamma;
      pairwiseDistances[j * pointCount + i] = gamma;
    }
  }
}

/** Fit spherical variogram model: returns { nugget, sill, range } */
function fitSphericalVariogram(
  experimental: Array<{ lag: number; gamma: number; count: number }>
): { nugget: number; sill: number; range: number } {
  if (experimental.length === 0) return { nugget: 0, sill: 1, range: 1 };

  const sorted = [...experimental].sort((left, right) => left.lag - right.lag);
  const firstGamma = sorted.find((entry) => entry.gamma > 0)?.gamma ?? 0;
  const maxGamma = Math.max(...sorted.map((entry) => entry.gamma), 1e-6);
  const upperTail = sorted.slice(Math.max(0, Math.floor(sorted.length * 0.6)));
  const upperTailMean = upperTail.reduce((sum, entry) => sum + entry.gamma, 0) / Math.max(upperTail.length, 1);
  const totalSillCandidates = Array.from(new Set([
    maxGamma,
    upperTailMean,
    Math.max(maxGamma * 0.9, firstGamma),
  ].map((value) => Number(value.toFixed(6))))).filter((value) => value > 0);
  const nuggetCandidates = Array.from(new Set([
    0,
    firstGamma * 0.25,
    firstGamma * 0.5,
  ].map((value) => Number(Math.max(0, value).toFixed(6)))));

  let bestModel = { nugget: 0, sill: Math.max(maxGamma, 1e-6), range: Math.max(sorted.at(-1)?.lag ?? 1, 1e-3) };
  let bestScore = Infinity;

  for (const totalSill of totalSillCandidates) {
    for (const nugget of nuggetCandidates) {
      const partialSill = Math.max(totalSill - nugget, 1e-6);
      for (const candidate of sorted) {
        const range = Math.max(candidate.lag, 1e-3);
        let score = 0;

        for (const entry of sorted) {
          const modeled = sphericalVariogram(entry.lag, nugget, partialSill, range);
          const residual = entry.gamma - modeled;
          const weight = entry.count / Math.max(entry.lag * entry.lag, 1);
          score += weight * residual * residual;
        }

        if (score < bestScore) {
          bestScore = score;
          bestModel = { nugget, sill: partialSill, range };
        }
      }
    }
  }

  return bestModel;
}

/** Spherical variogram model */
function sphericalVariogram(h: number, nugget: number, sill: number, range: number): number {
  if (h === 0) return 0;
  if (h >= range) return nugget + sill;
  const hr = h / range;
  return nugget + sill * (1.5 * hr - 0.5 * hr * hr * hr);
}

function solveAugmentedLinearSystem(
  aug: Float64Array,
  n: number,
  stride: number,
  solution: Float64Array,
): boolean {
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    let maxVal = Math.abs(aug[col * stride + col]);
    for (let row = col + 1; row < n; row++) {
      const value = Math.abs(aug[row * stride + col]);
      if (value > maxVal) {
        maxVal = value;
        maxRow = row;
      }
    }

    let rowScale = 0;
    const maxRowOffset = maxRow * stride;
    for (let j = 0; j < n; j++) {
      rowScale += Math.abs(aug[maxRowOffset + j]);
    }
    if (maxVal <= Math.max(1e-12, rowScale * 1e-10)) return false;

    if (maxRow !== col) {
      const colOffset = col * stride;
      for (let j = col; j <= n; j++) {
        const tmp = aug[colOffset + j];
        aug[colOffset + j] = aug[maxRowOffset + j];
        aug[maxRowOffset + j] = tmp;
      }
    }

    const pivotOffset = col * stride;
    const pivot = aug[pivotOffset + col];
    for (let row = col + 1; row < n; row++) {
      const rowOffset = row * stride;
      const factor = aug[rowOffset + col] / pivot;
      aug[rowOffset + col] = 0;
      for (let j = col + 1; j <= n; j++) {
        aug[rowOffset + j] -= factor * aug[pivotOffset + j];
      }
    }
  }

  for (let row = n - 1; row >= 0; row--) {
    const rowOffset = row * stride;
    let sum = aug[rowOffset + n];
    for (let j = row + 1; j < n; j++) {
      sum -= aug[rowOffset + j] * solution[j];
    }
    solution[row] = sum / aug[rowOffset + row];
  }

  return true;
}

function factorLinearSystem(
  matrix: Float64Array,
  n: number,
  stride: number,
  pivots: Int32Array,
): boolean {
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    let maxVal = Math.abs(matrix[col * stride + col]);
    for (let row = col + 1; row < n; row++) {
      const value = Math.abs(matrix[row * stride + col]);
      if (value > maxVal) {
        maxVal = value;
        maxRow = row;
      }
    }

    let rowScale = 0;
    const maxRowOffset = maxRow * stride;
    for (let j = 0; j < n; j++) {
      rowScale += Math.abs(matrix[maxRowOffset + j]);
    }
    if (maxVal <= Math.max(1e-12, rowScale * 1e-10)) return false;

    pivots[col] = maxRow;
    if (maxRow !== col) {
      const colOffset = col * stride;
      for (let j = 0; j < n; j++) {
        const tmp = matrix[colOffset + j];
        matrix[colOffset + j] = matrix[maxRowOffset + j];
        matrix[maxRowOffset + j] = tmp;
      }
    }

    const pivotOffset = col * stride;
    const pivot = matrix[pivotOffset + col];
    for (let row = col + 1; row < n; row++) {
      const rowOffset = row * stride;
      const factor = matrix[rowOffset + col] / pivot;
      matrix[rowOffset + col] = factor;
      for (let j = col + 1; j < n; j++) {
        matrix[rowOffset + j] -= factor * matrix[pivotOffset + j];
      }
    }
  }

  return true;
}

function solveFactoredLinearSystem(
  matrix: Float64Array,
  n: number,
  stride: number,
  pivots: Int32Array,
  rhs: Float64Array,
  solution: Float64Array,
): void {
  for (let i = 0; i < n; i++) {
    solution[i] = rhs[i];
  }

  for (let col = 0; col < n; col++) {
    const pivotRow = pivots[col];
    if (pivotRow !== col) {
      const tmp = solution[col];
      solution[col] = solution[pivotRow];
      solution[pivotRow] = tmp;
    }
  }

  for (let row = 0; row < n; row++) {
    const rowOffset = row * stride;
    let sum = solution[row];
    for (let col = 0; col < row; col++) {
      sum -= matrix[rowOffset + col] * solution[col];
    }
    solution[row] = sum;
  }

  for (let row = n - 1; row >= 0; row--) {
    const rowOffset = row * stride;
    let sum = solution[row];
    for (let col = row + 1; col < n; col++) {
      sum -= matrix[rowOffset + col] * solution[col];
    }
    solution[row] = sum / matrix[rowOffset + row];
  }
}

function selectNearestPointIndexes(
  x: number,
  y: number,
  pointProjectedXs: Float64Array,
  pointProjectedYs: Float64Array,
  maxNeighbors: number,
  outIndexes: Int32Array,
  outDistanceSquares: Float64Array,
): number {
  let neighborCount = 0;
  let worstNeighborSlot = 0;
  let worstNeighborDistanceSq = -Infinity;

  for (let i = 0; i < pointProjectedXs.length; i++) {
    const distSq = projectedDistanceSquaredKm(x, y, pointProjectedXs[i], pointProjectedYs[i]);

    if (neighborCount < maxNeighbors) {
      outIndexes[neighborCount] = i;
      outDistanceSquares[neighborCount] = distSq;
      if (distSq > worstNeighborDistanceSq) {
        worstNeighborDistanceSq = distSq;
        worstNeighborSlot = neighborCount;
      }
      neighborCount++;
      continue;
    }

    if (distSq < worstNeighborDistanceSq) {
      outIndexes[worstNeighborSlot] = i;
      outDistanceSquares[worstNeighborSlot] = distSq;

      worstNeighborDistanceSq = outDistanceSquares[0];
      worstNeighborSlot = 0;
      for (let slot = 1; slot < neighborCount; slot++) {
        const slotDistanceSq = outDistanceSquares[slot];
        if (slotDistanceSq > worstNeighborDistanceSq) {
          worstNeighborDistanceSq = slotDistanceSq;
          worstNeighborSlot = slot;
        }
      }
    }
  }

  return neighborCount;
}

function interpolateKrigingTiles(
  values: Float64Array,
  gridWidth: number,
  gridHeight: number,
  bounds: { west: number; east: number; south: number; north: number },
  pointXs: Float64Array,
  pointYs: Float64Array,
  projectionCosLat: number,
  pointProjectedXs: Float64Array,
  pointProjectedYs: Float64Array,
  pointValues: Float64Array,
  pairwiseSemivariance: Float64Array,
  nugget: number,
  sill: number,
  range: number,
  maxNeighbors: number,
  tileSize: number,
): { min: number; max: number } {
  let min = Infinity, max = -Infinity;
  const pointCount = pointXs.length;
  const lonStep = gridWidth > 1 ? (bounds.east - bounds.west) / (gridWidth - 1) : 0;
  const latStep = gridHeight > 1 ? (bounds.north - bounds.south) / (gridHeight - 1) : 0;
  const maxSystemSize = maxNeighbors + 1;
  const neighborIndexes = new Int32Array(maxNeighbors);
  const neighborDistanceSquares = new Float64Array(maxNeighbors);
  const matrix = new Float64Array(maxSystemSize * maxSystemSize);
  const pivots = new Int32Array(maxSystemSize);
  const rhs = new Float64Array(maxSystemSize);
  const weights = new Float64Array(maxSystemSize);
  const cellDistances = new Float64Array(maxNeighbors);
  const diagonalJitter = Math.max((nugget + sill) * 1e-6, 1e-8);

  for (let rowStart = 0; rowStart < gridHeight; rowStart += tileSize) {
    const rowEnd = Math.min(rowStart + tileSize, gridHeight);
    const centerRow = (rowStart + rowEnd - 1) / 2;
    const centerY = bounds.south + centerRow * latStep;

    for (let colStart = 0; colStart < gridWidth; colStart += tileSize) {
      const colEnd = Math.min(colStart + tileSize, gridWidth);
      const centerCol = (colStart + colEnd - 1) / 2;
      const centerX = bounds.west + centerCol * lonStep;
      const centerProjectedX = projectLongitudeKm(centerX, projectionCosLat);
      const centerProjectedY = projectLatitudeKm(centerY);
      const nn = selectNearestPointIndexes(
        centerProjectedX,
        centerProjectedY,
        pointProjectedXs,
        pointProjectedYs,
        maxNeighbors,
        neighborIndexes,
        neighborDistanceSquares,
      );

      if (nn < 2) {
        const fallbackValue = nn === 1 ? pointValues[neighborIndexes[0]] : 0;
        for (let row = rowStart; row < rowEnd; row++) {
          for (let col = colStart; col < colEnd; col++) {
            values[row * gridWidth + col] = fallbackValue;
          }
        }
        if (fallbackValue < min) min = fallbackValue;
        if (fallbackValue > max) max = fallbackValue;
        continue;
      }

      const size = nn + 1;
      const stride = size;
      for (let i = 0; i < nn; i++) {
        const rowOffset = i * stride;
        const leftIdx = neighborIndexes[i];
        for (let j = 0; j < nn; j++) {
          matrix[rowOffset + j] = i === j
            ? diagonalJitter
            : pairwiseSemivariance[leftIdx * pointCount + neighborIndexes[j]];
        }
        matrix[rowOffset + nn] = 1;
      }
      const lagrangeRowOffset = nn * stride;
      for (let j = 0; j < nn; j++) {
        matrix[lagrangeRowOffset + j] = 1;
      }
      matrix[lagrangeRowOffset + nn] = 0;

      const factored = factorLinearSystem(matrix, size, stride, pivots);

      for (let row = rowStart; row < rowEnd; row++) {
        const y = bounds.south + row * latStep;
        for (let col = colStart; col < colEnd; col++) {
          const x = bounds.west + col * lonStep;
          let exactMatchSlot = -1;

          for (let i = 0; i < nn; i++) {
            const pointIndex = neighborIndexes[i];
            const dist = approximateDistanceKm(x, y, pointXs[pointIndex], pointYs[pointIndex]);
            cellDistances[i] = dist;
            if (dist < 1e-10) {
              exactMatchSlot = i;
              break;
            }
            rhs[i] = sphericalVariogram(dist, nugget, sill, range);
          }
          rhs[nn] = 1;

          let value: number;
          if (exactMatchSlot >= 0) {
            value = pointValues[neighborIndexes[exactMatchSlot]];
          } else if (factored) {
            solveFactoredLinearSystem(matrix, size, stride, pivots, rhs, weights);
            value = 0;
            for (let i = 0; i < nn; i++) {
              value += weights[i] * pointValues[neighborIndexes[i]];
            }
            if (!Number.isFinite(value)) value = pointValues[neighborIndexes[0]] ?? 0;
          } else {
            let wSum = 0, vSum = 0;
            for (let i = 0; i < nn; i++) {
              const w = 1 / (cellDistances[i] * cellDistances[i]);
              wSum += w;
              vSum += w * pointValues[neighborIndexes[i]];
            }
            value = wSum > 0 ? vSum / wSum : 0;
          }

          values[row * gridWidth + col] = value;
          if (value < min) min = value;
          if (value > max) max = value;
        }
      }
    }
  }

  return { min, max };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((sorted.length - 1) * p)),
  );
  return sorted[index];
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function estimateGridCellSpacingKm(
  bounds: { west: number; east: number; south: number; north: number },
  gridWidth: number,
  gridHeight: number,
): number {
  const midLat = (bounds.south + bounds.north) / 2;
  const horizontalSpacing = gridWidth > 1
    ? approximateDistanceKm(bounds.west, midLat, bounds.east, midLat) / (gridWidth - 1)
    : 0;
  const verticalSpacing = gridHeight > 1
    ? approximateDistanceKm(bounds.west, bounds.south, bounds.west, bounds.north) / (gridHeight - 1)
    : 0;

  return Math.max(horizontalSpacing, verticalSpacing, 1e-9);
}

function collectKrigingSeamStats(
  values: Float64Array,
  gridWidth: number,
  gridHeight: number,
  tileSize: number,
): {
  seamMeanRatio: number;
  tileBoundaryOutlierRate: number;
  interiorEdgeP95: number;
  boundaryEdgeP95: number;
} {
  if (tileSize <= 1 || gridWidth < 2 || gridHeight < 2) {
    return {
      seamMeanRatio: 1,
      tileBoundaryOutlierRate: 0,
      interiorEdgeP95: 0,
      boundaryEdgeP95: 0,
    };
  }

  const boundaryEdges: number[] = [];
  const interiorEdges: number[] = [];

  for (let row = 0; row < gridHeight; row++) {
    const rowOffset = row * gridWidth;
    for (let col = 1; col < gridWidth; col++) {
      const diff = Math.abs(values[rowOffset + col] - values[rowOffset + col - 1]);
      (col % tileSize === 0 ? boundaryEdges : interiorEdges).push(diff);
    }
  }

  for (let row = 1; row < gridHeight; row++) {
    const rowOffset = row * gridWidth;
    const previousRowOffset = (row - 1) * gridWidth;
    for (let col = 0; col < gridWidth; col++) {
      const diff = Math.abs(values[rowOffset + col] - values[previousRowOffset + col]);
      (row % tileSize === 0 ? boundaryEdges : interiorEdges).push(diff);
    }
  }

  const interiorMean = mean(interiorEdges);
  const boundaryMean = mean(boundaryEdges);
  const interiorEdgeP95 = percentile(interiorEdges, 0.95);
  const boundaryEdgeP95 = percentile(boundaryEdges, 0.95);

  return {
    seamMeanRatio: boundaryMean / Math.max(interiorMean, 1e-9),
    tileBoundaryOutlierRate: boundaryEdges.filter((diff) => diff > interiorEdgeP95).length / Math.max(boundaryEdges.length, 1),
    interiorEdgeP95,
    boundaryEdgeP95,
  };
}

function computeKrigingArtifactMetrics(
  grid: InterpolationGrid,
  model: OrdinaryKrigingModel,
  requestedTileSize: number,
): KrigingArtifactMetrics {
  const inputMin = model.valueMin;
  const inputMax = model.valueMax;
  const inputRange = Math.max(inputMax - inputMin, 1e-9);
  let overshootCount = 0;
  let severeOvershootCount = 0;
  let negativeCount = 0;

  for (const value of grid.values) {
    if (value < inputMin || value > inputMax) overshootCount++;
    if (value < inputMin - inputRange * 0.1 || value > inputMax + inputRange * 0.1) {
      severeOvershootCount++;
    }
    if (value < 0) negativeCount++;
  }

  const cellCount = Math.max(grid.values.length, 1);
  const gridCellSpacingKm = estimateGridCellSpacingKm(grid.bounds, grid.width, grid.height);
  const seamStats = collectKrigingSeamStats(grid.values, grid.width, grid.height, requestedTileSize);

  return {
    inputMin,
    inputMax,
    outputMin: grid.min,
    outputMax: grid.max,
    overshootRate: overshootCount / cellCount,
    severeOvershootRate: severeOvershootCount / cellCount,
    negativeRate: negativeCount / cellCount,
    gridCellSpacingKm,
    variogramRangeKm: model.range,
    rangeToCellSpacingRatio: model.range / gridCellSpacingKm,
    ...seamStats,
  };
}

function attachKrigingDiagnostics(
  grid: InterpolationGrid,
  model: OrdinaryKrigingModel,
  maxNeighbors: number,
  requestedTileSize: number,
  effectiveTileSize: number,
  mode: KrigingDiagnostics["mode"],
  fallbackReason?: KrigingDiagnostics["fallbackReason"],
): InterpolationGrid {
  const artifacts = computeKrigingArtifactMetrics(grid, model, requestedTileSize);
  return {
    ...grid,
    diagnostics: {
      ...grid.diagnostics,
      kriging: {
        variogram: {
          nugget: model.nugget,
          sill: model.sill,
          rangeKm: model.range,
        },
        maxNeighbors,
        requestedTileSize,
        effectiveTileSize,
        mode,
        fallbackReason,
        artifacts,
      },
    },
  };
}

function shouldFallbackTiledKriging(metrics: KrigingArtifactMetrics): boolean {
  return metrics.seamMeanRatio > KRIGING_MAX_SAFE_SEAM_MEAN_RATIO
    || metrics.tileBoundaryOutlierRate > KRIGING_MAX_SAFE_BOUNDARY_OUTLIER_RATE;
}

export function ordinaryKrigingInterpolate(
  knownPoints: InterpolationPoint[],
  gridWidth: number,
  gridHeight: number,
  bounds: { west: number; east: number; south: number; north: number },
  maxNeighbors: number = 12,
  tileSize: number = 1,
): InterpolationGrid {
  const model = createOrdinaryKrigingModel(knownPoints);
  return interpolateOrdinaryKrigingModel(model, gridWidth, gridHeight, bounds, maxNeighbors, tileSize);
}

export function createOrdinaryKrigingModel(knownPoints: InterpolationPoint[]): OrdinaryKrigingModel {
  const normalizedPoints = mergeCoincidentPoints(knownPoints);
  const pointCount = normalizedPoints.length;
  const pointXs = new Float64Array(pointCount);
  const pointYs = new Float64Array(pointCount);
  const pointValues = new Float64Array(pointCount);
  let valueMin = Infinity;
  let valueMax = -Infinity;

  for (let i = 0; i < pointCount; i++) {
    const x = normalizedPoints[i].x;
    const y = normalizedPoints[i].y;
    const value = normalizedPoints[i].value;
    pointXs[i] = x;
    pointYs[i] = y;
    pointValues[i] = value;
    if (value < valueMin) valueMin = value;
    if (value > valueMax) valueMax = value;
  }

  const pairwiseDistances = buildPairwiseDistanceMatrix(pointXs, pointYs);

  // Step 1: Compute experimental variogram
  const experimental = computeExperimentalVariogramFromDistanceMatrix(
    pointValues,
    pairwiseDistances.distances,
    pointCount,
    pairwiseDistances.maxDistance,
  );

  // Step 2: Fit spherical model
  const { nugget, sill, range } = fitSphericalVariogram(experimental);
  const pairwiseSemivariance = pairwiseDistances.distances;
  convertPairwiseDistancesToSemivariances(pairwiseSemivariance, pointCount, nugget, sill, range);

  return {
    pointXs,
    pointYs,
    pointValues,
    pairwiseSemivariance,
    nugget,
    sill,
    range,
    valueMin: Number.isFinite(valueMin) ? valueMin : 0,
    valueMax: Number.isFinite(valueMax) ? valueMax : 0,
  };
}

export function interpolateOrdinaryKrigingModel(
  model: OrdinaryKrigingModel,
  gridWidth: number,
  gridHeight: number,
  bounds: { west: number; east: number; south: number; north: number },
  maxNeighbors: number = 12,
  tileSize: number = 1,
): InterpolationGrid {
  if (gridWidth < 1 || gridHeight < 1) {
    return {
      width: gridWidth,
      height: gridHeight,
      bounds,
      values: new Float64Array(0),
      min: 0,
      max: 0,
    };
  }

  const values = new Float64Array(gridWidth * gridHeight);
  const pointCount = model.pointValues.length;
  if (pointCount === 0) {
    return { width: gridWidth, height: gridHeight, bounds, values, min: 0, max: 0 };
  }

  const {
    pointXs,
    pointYs,
    pointValues,
    pairwiseSemivariance,
    nugget,
    sill,
    range,
  } = model;
  const pointProjectedXs = new Float64Array(pointCount);
  const pointProjectedYs = new Float64Array(pointCount);
  // Rank candidate neighborhoods in a fixed local projection; solve distances still use the geographic metric.
  const projectionCosLat = Math.cos(toRadians((bounds.south + bounds.north) / 2));
  for (let i = 0; i < pointCount; i++) {
    pointProjectedXs[i] = projectLongitudeKm(pointXs[i], projectionCosLat);
    pointProjectedYs[i] = projectLatitudeKm(pointYs[i]);
  }

  const neighborLimit = Math.max(1, Math.min(maxNeighbors > 0 ? maxNeighbors : pointCount, pointCount));
  const neighborIndexes = new Int32Array(neighborLimit);
  const neighborDistances = new Float64Array(neighborLimit);

  const maxSystemSize = neighborLimit + 1;
  const aug = new Float64Array(maxSystemSize * (maxSystemSize + 1));
  const weights = new Float64Array(maxSystemSize);
  const requestedTileSize = Math.max(1, Math.floor(tileSize));
  let effectiveTileSize = requestedTileSize;
  let fallbackReason: KrigingDiagnostics["fallbackReason"];

  if (effectiveTileSize > 1) {
    const gridCellSpacingKm = estimateGridCellSpacingKm(bounds, gridWidth, gridHeight);
    const rangeToCellSpacingRatio = range / gridCellSpacingKm;
    if (rangeToCellSpacingRatio < KRIGING_MIN_RANGE_TO_CELL_SPACING_FOR_TILES) {
      effectiveTileSize = 1;
      fallbackReason = "range-to-cell-spacing";
    }
  }

  if (effectiveTileSize > 1) {
    const stats = interpolateKrigingTiles(
      values,
      gridWidth,
      gridHeight,
      bounds,
      pointXs,
      pointYs,
      projectionCosLat,
      pointProjectedXs,
      pointProjectedYs,
      pointValues,
      pairwiseSemivariance,
      nugget,
      sill,
      range,
      neighborLimit,
      effectiveTileSize,
    );
    const tiledGrid = attachKrigingDiagnostics(
      { width: gridWidth, height: gridHeight, bounds, values, min: stats.min, max: stats.max },
      model,
      neighborLimit,
      requestedTileSize,
      effectiveTileSize,
      "tiled",
    );

    const artifacts = tiledGrid.diagnostics?.kriging?.artifacts;
    if (artifacts && shouldFallbackTiledKriging(artifacts)) {
      const exactGrid = interpolateOrdinaryKrigingModel(model, gridWidth, gridHeight, bounds, maxNeighbors, 1);
      return attachKrigingDiagnostics(
        { ...exactGrid, diagnostics: undefined },
        model,
        neighborLimit,
        requestedTileSize,
        1,
        "exact",
        "tile-artifact-score",
      );
    }

    return tiledGrid;
  }

  // Step 3: Interpolate each grid point
  let min = Infinity, max = -Infinity;

  const lonStep = gridWidth > 1 ? (bounds.east - bounds.west) / (gridWidth - 1) : 0;
  const latStep = gridHeight > 1 ? (bounds.north - bounds.south) / (gridHeight - 1) : 0;

  for (let row = 0; row < gridHeight; row++) {
    for (let col = 0; col < gridWidth; col++) {
      const x = bounds.west + col * lonStep;
      const y = bounds.south + row * latStep;
      const projectedX = projectLongitudeKm(x, projectionCosLat);
      const projectedY = projectLatitudeKm(y);

      let neighborCount = 0;
      let worstNeighborSlot = 0;
      let worstNeighborDistanceSq = -Infinity;
      let exactMatchIndex = -1;

      for (let i = 0; i < pointCount; i++) {
        const distSq = projectedDistanceSquaredKm(projectedX, projectedY, pointProjectedXs[i], pointProjectedYs[i]);
        if (distSq < 1e-20) {
          exactMatchIndex = i;
          break;
        }

        if (neighborCount < neighborLimit) {
          neighborIndexes[neighborCount] = i;
          neighborDistances[neighborCount] = distSq;
          if (distSq > worstNeighborDistanceSq) {
            worstNeighborDistanceSq = distSq;
            worstNeighborSlot = neighborCount;
          }
          neighborCount++;
          continue;
        }

        if (distSq < worstNeighborDistanceSq) {
          neighborIndexes[worstNeighborSlot] = i;
          neighborDistances[worstNeighborSlot] = distSq;

          worstNeighborDistanceSq = neighborDistances[0];
          worstNeighborSlot = 0;
          for (let slot = 1; slot < neighborCount; slot++) {
            if (neighborDistances[slot] > worstNeighborDistanceSq) {
              worstNeighborDistanceSq = neighborDistances[slot];
              worstNeighborSlot = slot;
            }
          }
        }
      }

      if (exactMatchIndex >= 0) {
        const v = pointValues[exactMatchIndex];
        values[row * gridWidth + col] = v;
        if (v < min) min = v;
        if (v > max) max = v;
        continue;
      }

      if (neighborCount < 2) {
        // Fallback to nearest neighbor
        const v = neighborCount === 1 ? pointValues[neighborIndexes[0]] : 0;
        values[row * gridWidth + col] = v;
        if (v < min) min = v;
        if (v > max) max = v;
        continue;
      }

      // Build kriging system: (nn+1) x (nn+1) augmented with Lagrange
      const nn = neighborCount;
      const size = nn + 1;
      const stride = size + 1;
      const diagonalJitter = Math.max((nugget + sill) * 1e-6, 1e-8);
      for (let i = 0; i < nn; i++) {
        const pointIndex = neighborIndexes[i];
        neighborDistances[i] = approximateDistanceKm(x, y, pointXs[pointIndex], pointYs[pointIndex]);
      }

      // Fill K matrix (semivariance between known points)
      for (let i = 0; i < nn; i++) {
        const rowOffset = i * stride;
        const leftIdx = neighborIndexes[i];
        for (let j = 0; j < nn; j++) {
          aug[rowOffset + j] = i === j
            ? diagonalJitter
            : pairwiseSemivariance[leftIdx * pointCount + neighborIndexes[j]];
        }
        aug[rowOffset + nn] = 1; // Lagrange column
        aug[rowOffset + size] = sphericalVariogram(neighborDistances[i], nugget, sill, range);
      }
      const lagrangeRowOffset = nn * stride;
      for (let j = 0; j < nn; j++) {
        aug[lagrangeRowOffset + j] = 1; // Lagrange row
      }
      aug[lagrangeRowOffset + nn] = 0; // Bottom-right corner
      aug[lagrangeRowOffset + size] = 1; // Lagrange constraint

      // Solve kriging system
      const solved = solveAugmentedLinearSystem(aug, size, stride, weights);

      if (!solved) {
        // Fallback to IDW if kriging fails
        let wSum = 0, vSum = 0;
        for (let i = 0; i < nn; i++) {
          const w = 1 / (neighborDistances[i] * neighborDistances[i]);
          wSum += w;
          vSum += w * pointValues[neighborIndexes[i]];
        }
        values[row * gridWidth + col] = wSum > 0 ? vSum / wSum : 0;
      } else {
        // Compute estimate: Z* = sum(lambda_i * Z_i)
        let v = 0;
        for (let i = 0; i < nn; i++) {
          v += weights[i] * pointValues[neighborIndexes[i]];
        }
        values[row * gridWidth + col] = Number.isFinite(v) ? v : pointValues[neighborIndexes[0]] ?? 0;
      }

      const v = values[row * gridWidth + col];
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }

  return attachKrigingDiagnostics(
    { width: gridWidth, height: gridHeight, bounds, values, min, max },
    model,
    neighborLimit,
    requestedTileSize,
    1,
    "exact",
    fallbackReason,
  );
}

// ---------------------------------------------------------------------------
// Point-based estimators
//
// estimateAtPoints lets us interpolate to arbitrary lat/lon receptors
// (schools, POIs, monitoring sites) without raster grids. Both IDW and
// kriging variants produce a per-point value plus the source it was derived
// from ("exact" sample, kriging system, IDW fallback, nearest, or none).
// ---------------------------------------------------------------------------

export type PointEstimateQuery = {
  id?: string;
  x: number; // longitude
  y: number; // latitude
};

export type PointEstimateSource =
  | "exact"
  | "kriging"
  | "idw-fallback"
  | "nearest"
  | "none";

export type PointEstimate = {
  id?: string;
  x: number;
  y: number;
  value: number | null;
  neighborCount: number;
  source: PointEstimateSource;
};

export type IdwEstimateOptions = {
  power?: number;          // default 2
  maxNeighbors?: number;   // default -1 (all)
  maxDistanceKm?: number;  // default -1 (no limit)
};

export function idwEstimateAtPoints(
  knownPoints: InterpolationPoint[],
  queries: PointEstimateQuery[],
  options: IdwEstimateOptions = {},
): PointEstimate[] {
  const power = options.power ?? 2;
  const maxNeighbors = options.maxNeighbors ?? -1;
  const maxDistanceKm = options.maxDistanceKm ?? -1;
  const powerScale = power / 2;
  const normalizedPoints = mergeCoincidentPoints(knownPoints);
  const maxDistSq = maxDistanceKm > 0 ? maxDistanceKm * maxDistanceKm : Number.POSITIVE_INFINITY;
  const results: PointEstimate[] = [];

  for (const q of queries) {
    if (normalizedPoints.length === 0) {
      results.push({ id: q.id, x: q.x, y: q.y, value: null, neighborCount: 0, source: "none" });
      continue;
    }

    let exactValue: number | null = null;
    const candidates: { distSq: number; value: number }[] = [];

    for (const p of normalizedPoints) {
      const distSq = approximateDistanceSquaredKm(q.x, q.y, p.x, p.y);
      if (distSq < 1e-20) {
        exactValue = p.value;
        break;
      }
      if (distSq > maxDistSq) continue;
      candidates.push({ distSq, value: p.value });
    }

    if (exactValue !== null) {
      results.push({ id: q.id, x: q.x, y: q.y, value: exactValue, neighborCount: 1, source: "exact" });
      continue;
    }

    let selected = candidates;
    if (maxNeighbors > 0 && candidates.length > maxNeighbors) {
      candidates.sort((a, b) => a.distSq - b.distSq);
      selected = candidates.slice(0, maxNeighbors);
    }

    if (selected.length === 0) {
      results.push({ id: q.id, x: q.x, y: q.y, value: null, neighborCount: 0, source: "none" });
      continue;
    }

    let weightSum = 0;
    let valueSum = 0;
    for (const c of selected) {
      const w = power === 2 ? 1 / c.distSq : Math.pow(c.distSq, -powerScale);
      weightSum += w;
      valueSum += w * c.value;
    }

    results.push({
      id: q.id,
      x: q.x,
      y: q.y,
      value: weightSum > 0 ? valueSum / weightSum : null,
      neighborCount: selected.length,
      source: "idw-fallback",
    });
  }

  return results;
}

export type KrigingEstimateOptions = {
  maxNeighbors?: number; // default 12
};

export function krigingEstimateAtPoints(
  model: OrdinaryKrigingModel,
  queries: PointEstimateQuery[],
  options: KrigingEstimateOptions = {},
): PointEstimate[] {
  const maxNeighbors = options.maxNeighbors ?? 12;
  const pointCount = model.pointValues.length;
  if (pointCount === 0) {
    return queries.map((q) => ({
      id: q.id,
      x: q.x,
      y: q.y,
      value: null,
      neighborCount: 0,
      source: "none" as PointEstimateSource,
    }));
  }

  const { pointXs, pointYs, pointValues, pairwiseSemivariance, nugget, sill, range } = model;

  // Use the centroid of the queries to pick a single projection latitude — keeps
  // local Euclidean ranking stable. Falls back to the model centroid if queries
  // are empty.
  let centroidLat = 0;
  if (queries.length > 0) {
    for (const q of queries) centroidLat += q.y;
    centroidLat /= queries.length;
  } else {
    let sumY = 0;
    for (let i = 0; i < pointCount; i++) sumY += pointYs[i];
    centroidLat = sumY / pointCount;
  }
  const projectionCosLat = Math.cos(toRadians(centroidLat));
  const pointProjectedXs = new Float64Array(pointCount);
  const pointProjectedYs = new Float64Array(pointCount);
  for (let i = 0; i < pointCount; i++) {
    pointProjectedXs[i] = projectLongitudeKm(pointXs[i], projectionCosLat);
    pointProjectedYs[i] = projectLatitudeKm(pointYs[i]);
  }

  const neighborLimit = Math.max(1, Math.min(maxNeighbors > 0 ? maxNeighbors : pointCount, pointCount));
  const neighborIndexes = new Int32Array(neighborLimit);
  const neighborDistances = new Float64Array(neighborLimit);
  const maxSystemSize = neighborLimit + 1;
  const aug = new Float64Array(maxSystemSize * (maxSystemSize + 1));
  const weights = new Float64Array(maxSystemSize);

  const out: PointEstimate[] = [];
  for (const q of queries) {
    const projectedX = projectLongitudeKm(q.x, projectionCosLat);
    const projectedY = projectLatitudeKm(q.y);

    let neighborCount = 0;
    let worstNeighborSlot = 0;
    let worstNeighborDistanceSq = -Infinity;
    let exactMatchIndex = -1;

    for (let i = 0; i < pointCount; i++) {
      const distSq = projectedDistanceSquaredKm(projectedX, projectedY, pointProjectedXs[i], pointProjectedYs[i]);
      if (distSq < 1e-20) {
        exactMatchIndex = i;
        break;
      }
      if (neighborCount < neighborLimit) {
        neighborIndexes[neighborCount] = i;
        neighborDistances[neighborCount] = distSq;
        if (distSq > worstNeighborDistanceSq) {
          worstNeighborDistanceSq = distSq;
          worstNeighborSlot = neighborCount;
        }
        neighborCount++;
        continue;
      }
      if (distSq < worstNeighborDistanceSq) {
        neighborIndexes[worstNeighborSlot] = i;
        neighborDistances[worstNeighborSlot] = distSq;
        worstNeighborDistanceSq = neighborDistances[0];
        worstNeighborSlot = 0;
        for (let slot = 1; slot < neighborCount; slot++) {
          if (neighborDistances[slot] > worstNeighborDistanceSq) {
            worstNeighborDistanceSq = neighborDistances[slot];
            worstNeighborSlot = slot;
          }
        }
      }
    }

    if (exactMatchIndex >= 0) {
      out.push({
        id: q.id,
        x: q.x,
        y: q.y,
        value: pointValues[exactMatchIndex],
        neighborCount: 1,
        source: "exact",
      });
      continue;
    }

    if (neighborCount === 0) {
      out.push({ id: q.id, x: q.x, y: q.y, value: null, neighborCount: 0, source: "none" });
      continue;
    }

    if (neighborCount < 2) {
      out.push({
        id: q.id,
        x: q.x,
        y: q.y,
        value: pointValues[neighborIndexes[0]],
        neighborCount,
        source: "nearest",
      });
      continue;
    }

    const nn = neighborCount;
    const size = nn + 1;
    const stride = size + 1;
    const diagonalJitter = Math.max((nugget + sill) * 1e-6, 1e-8);
    for (let i = 0; i < nn; i++) {
      const pointIndex = neighborIndexes[i];
      neighborDistances[i] = approximateDistanceKm(q.x, q.y, pointXs[pointIndex], pointYs[pointIndex]);
    }
    for (let i = 0; i < nn; i++) {
      const rowOffset = i * stride;
      const leftIdx = neighborIndexes[i];
      for (let j = 0; j < nn; j++) {
        aug[rowOffset + j] = i === j
          ? diagonalJitter
          : pairwiseSemivariance[leftIdx * pointCount + neighborIndexes[j]];
      }
      aug[rowOffset + nn] = 1;
      aug[rowOffset + size] = sphericalVariogram(neighborDistances[i], nugget, sill, range);
    }
    const lagrangeRowOffset = nn * stride;
    for (let j = 0; j < nn; j++) aug[lagrangeRowOffset + j] = 1;
    aug[lagrangeRowOffset + nn] = 0;
    aug[lagrangeRowOffset + size] = 1;

    const solved = solveAugmentedLinearSystem(aug, size, stride, weights);

    if (!solved) {
      let wSum = 0, vSum = 0;
      for (let i = 0; i < nn; i++) {
        const w = 1 / (neighborDistances[i] * neighborDistances[i]);
        wSum += w;
        vSum += w * pointValues[neighborIndexes[i]];
      }
      out.push({
        id: q.id,
        x: q.x,
        y: q.y,
        value: wSum > 0 ? vSum / wSum : null,
        neighborCount: nn,
        source: "idw-fallback",
      });
      continue;
    }

    let v = 0;
    for (let i = 0; i < nn; i++) v += weights[i] * pointValues[neighborIndexes[i]];
    out.push({
      id: q.id,
      x: q.x,
      y: q.y,
      value: Number.isFinite(v) ? v : pointValues[neighborIndexes[0]] ?? null,
      neighborCount: nn,
      source: "kriging",
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// AQI Color Scale & Grid Rendering
// ---------------------------------------------------------------------------

/**
 * Convert PM2.5 (ug/m3) to US EPA AQI index.
 * Uses EPA's piecewise-linear PM2.5 breakpoint table.
 */
export function pm25ToAqi(pm25: number, profile: AqiProfile = EPA_PM25_AQI_PROFILE): number {
  if (!Number.isFinite(pm25)) return 0;
  const c = Math.max(0, pm25);
  const last = profile.breakpoints.at(-1);
  for (const bp of profile.breakpoints) {
    if (c >= bp.concLow && c <= bp.concHigh) {
      return Math.round(((bp.aqiHigh - bp.aqiLow) / (bp.concHigh - bp.concLow)) * (c - bp.concLow) + bp.aqiLow);
    }
  }
  return last ? last.aqiHigh : 0;
}

function hourlyPm25Buckets(samples: NowCastSample[]): number[] {
  const buckets = new Map<number, number[]>();
  for (const sample of samples) {
    if (typeof sample.pm25 !== "number" || !Number.isFinite(sample.pm25)) continue;
    const timestamp = new Date(sample.timestamp).getTime();
    if (!Number.isFinite(timestamp)) continue;
    const hour = Math.floor(timestamp / 3_600_000) * 3_600_000;
    const values = buckets.get(hour) ?? [];
    values.push(sample.pm25);
    buckets.set(hour, values);
  }

  return [...buckets.entries()]
    .sort((left, right) => right[0] - left[0])
    .map(([, values]) => average(values))
    .slice(0, 12);
}

export function calculateNowCast(samples: NowCastSample[], profile: AqiProfile = EPA_PM25_AQI_PROFILE): NowCastResult {
  const hourlyValues = hourlyPm25Buckets(samples);
  const hoursRequired = 12;
  if (hourlyValues.length < 2) {
    return {
      pm25NowCast: null,
      aqi: null,
      weightFactor: null,
      hoursUsed: hourlyValues.length,
      hoursRequired,
      status: "insufficient",
      provenance: "epa-nowcast-aqi",
    };
  }

  const maxValue = Math.max(...hourlyValues);
  const minValue = Math.min(...hourlyValues);
  const weightFactor = maxValue > 0 ? Math.max(0.5, minValue / maxValue) : 1;
  let weightedSum = 0;
  let weightSum = 0;

  for (let index = 0; index < hourlyValues.length; index += 1) {
    const weight = weightFactor ** index;
    weightedSum += hourlyValues[index] * weight;
    weightSum += weight;
  }

  const pm25NowCast = Number((weightedSum / Math.max(weightSum, 1e-9)).toFixed(3));
  return {
    pm25NowCast,
    aqi: pm25ToAqi(pm25NowCast, profile),
    weightFactor: Number(weightFactor.toFixed(3)),
    hoursUsed: hourlyValues.length,
    hoursRequired,
    status: hourlyValues.length >= hoursRequired ? "stable" : "calculating",
    provenance: "epa-nowcast-aqi",
  };
}

/** Convert AQI to RGBA color */
export function aqiToColor(aqi: number): [number, number, number, number] {
  // EPA AQI color breakpoints matching AQI_Map project
  if (aqi <= 50) {
    // Good: Green
    const t = aqi / 50;
    return [Math.round(0 + t * 0), Math.round(128 + t * 0), Math.round(0), 180];
  }
  if (aqi <= 100) {
    // Moderate: Green -> Yellow
    const t = (aqi - 50) / 50;
    return [Math.round(t * 255), Math.round(128 + t * 127), Math.round(0), 180];
  }
  if (aqi <= 150) {
    // USG: Yellow -> Orange
    const t = (aqi - 100) / 50;
    return [255, Math.round(255 - t * 115), Math.round(0), 180];
  }
  if (aqi <= 200) {
    // Unhealthy: Orange -> Red
    const t = (aqi - 150) / 50;
    return [255, Math.round(140 - t * 140), 0, 180];
  }
  if (aqi <= 300) {
    // Very Unhealthy: Red -> Purple
    const t = (aqi - 200) / 100;
    return [Math.round(255 - t * 127), 0, Math.round(t * 128), 180];
  }
  // Hazardous: Purple -> Maroon
  const t = Math.min((aqi - 300) / 200, 1);
  return [Math.round(128 - t * 0), 0, Math.round(128 - t * 128), 180];
}

/** Render an InterpolationGrid to an RGBA ImageData-compatible Uint8ClampedArray */
export function gridToImageData(
  grid: InterpolationGrid,
  useAqi: boolean = true
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(grid.width * grid.height * 4);

  for (let i = 0; i < grid.values.length; i++) {
    const v = grid.values[i];
    let color: [number, number, number, number];

    if (useAqi) {
      color = aqiToColor(pm25ToAqi(v));
    } else {
      // Generic gradient: blue -> green -> yellow -> red
      const t = grid.max > grid.min ? (v - grid.min) / (grid.max - grid.min) : 0;
      if (t < 0.25) {
        const s = t / 0.25;
        color = [0, Math.round(s * 255), 255, 160];
      } else if (t < 0.5) {
        const s = (t - 0.25) / 0.25;
        color = [0, 255, Math.round(255 - s * 255), 160];
      } else if (t < 0.75) {
        const s = (t - 0.5) / 0.25;
        color = [Math.round(s * 255), 255, 0, 160];
      } else {
        const s = (t - 0.75) / 0.25;
        color = [255, Math.round(255 - s * 255), 0, 160];
      }
    }

    // Note: grid row 0 = south, but image row 0 = top
    // Flip vertically
    const gridRow = Math.floor(i / grid.width);
    const gridCol = i % grid.width;
    const imgRow = grid.height - 1 - gridRow;
    const imgIdx = (imgRow * grid.width + gridCol) * 4;

    data[imgIdx] = color[0];
    data[imgIdx + 1] = color[1];
    data[imgIdx + 2] = color[2];
    data[imgIdx + 3] = color[3];
  }

  return data;
}
