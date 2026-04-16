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
  humidity: z.number().nullable().optional(),
  pressure: z.number().nullable().optional(),
  temperature: z.number().nullable().optional(),
  distanceToClosestMonitorKm: z.number().nullable().optional()
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
  humidity: z.number().nullable().optional(),
  temperature: z.number().nullable().optional(),
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
  category?: string;
  reportingArea?: string;
};

export type ReferenceObservationSeries = {
  source: "airnow";
  label: string;
  latitude: number;
  longitude: number;
  observations: ReferenceObservationPoint[];
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

function safeNumber(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
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
    humidity: safeNumber(raw.humidity),
    pressure: safeNumber(raw.pressure),
    temperature: safeNumber(raw.temperature),
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
    if (point.pm25A === null || point.pm25B === null) return [];
    return Math.abs(point.pm25A - point.pm25B) > 4 ? [index] : [];
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

export function pm25ToAqiBand(value: number | null | undefined): { label: string; color: string } {
  const pm25 = value ?? 0;
  if (pm25 <= 12) return { label: "Good", color: "#2e9d5b" };
  if (pm25 <= 35.4) return { label: "Moderate", color: "#f0c419" };
  if (pm25 <= 55.4) return { label: "USG", color: "#f2994a" };
  if (pm25 <= 150.4) return { label: "Unhealthy", color: "#d64545" };
  return { label: "Very Unhealthy", color: "#7d3c98" };
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
    if (point.pm25A !== null && point.pm25B !== null && Math.abs(point.pm25A - point.pm25B) > 4) {
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
      breaks: [0, 12, 35.4, 55.4, 150.4, 250.4, 500],
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
  x: number; // longitude
  y: number; // latitude
  value: number; // PM2.5 or AQI
};

export type InterpolationGrid = {
  width: number;
  height: number;
  bounds: { west: number; east: number; south: number; north: number };
  values: Float64Array; // row-major, width * height
  min: number;
  max: number;
};

export type InterpolationMethod = "idw" | "kriging";

const EARTH_RADIUS_KM = 6371;

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

  for (let row = 0; row < gridHeight; row++) {
    for (let col = 0; col < gridWidth; col++) {
      const x = bounds.west + col * lonStep;
      const y = bounds.south + row * latStep;

      let exactMatch = false;
      let weightSum = 0;
      let valueSum = 0;
      let neighborCount = 0;
      let worstNeighborSlot = 0;
      let worstNeighborDistance = -Infinity;

      for (const p of normalizedPoints) {
        const dist = approximateDistanceKm(x, y, p.x, p.y);

        if (dist < 1e-10) {
          values[row * gridWidth + col] = p.value;
          exactMatch = true;
          break;
        }

        if (neighborLimit === 0) {
          const w = 1 / Math.pow(dist, power);
          weightSum += w;
          valueSum += w * p.value;
          continue;
        }

        if (neighborCount < neighborLimit) {
          neighborDistances![neighborCount] = dist;
          neighborValues![neighborCount] = p.value;
          if (dist > worstNeighborDistance) {
            worstNeighborDistance = dist;
            worstNeighborSlot = neighborCount;
          }
          neighborCount++;
          continue;
        }

        if (dist < worstNeighborDistance) {
          neighborDistances![worstNeighborSlot] = dist;
          neighborValues![worstNeighborSlot] = p.value;

          worstNeighborDistance = neighborDistances![0];
          worstNeighborSlot = 0;
          for (let slot = 1; slot < neighborCount; slot++) {
            if (neighborDistances![slot] > worstNeighborDistance) {
              worstNeighborDistance = neighborDistances![slot];
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
          const w = 1 / Math.pow(neighborDistances![i], power);
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

/** Compute experimental variogram from point data */
function computeExperimentalVariogram(
  points: InterpolationPoint[],
  nBins: number = 15
): Array<{ lag: number; gamma: number; count: number }> {
  // Calculate all pairwise distances and squared differences
  const pairs: Array<{ dist: number; sqDiff: number }> = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dist = approximateDistanceKm(points[i].x, points[i].y, points[j].x, points[j].y);
      const sqDiff = (points[i].value - points[j].value) ** 2;
      pairs.push({ dist, sqDiff });
    }
  }

  if (pairs.length === 0) return [];

  // Bin by distance. Use a manual loop instead of Math.max(...arr) — with N points,
  // pairs has O(N^2) entries, and spreading that many args blows the call stack.
  let maxPairDist = 0;
  for (const { dist } of pairs) {
    if (dist > maxPairDist) maxPairDist = dist;
  }
  if (maxPairDist <= 0) return [];
  const maxDist = maxPairDist / 2; // Use half max distance
  const binWidth = maxDist / nBins;
  const bins: Array<{ sum: number; count: number }> = Array.from({ length: nBins }, () => ({ sum: 0, count: 0 }));

  for (const { dist, sqDiff } of pairs) {
    if (dist > maxDist) continue;
    const binIdx = Math.min(Math.floor(dist / binWidth), nBins - 1);
    bins[binIdx].sum += sqDiff;
    bins[binIdx].count++;
  }

  return bins
    .map((bin, i) => ({
      lag: (i + 0.5) * binWidth,
      gamma: bin.count > 0 ? bin.sum / (2 * bin.count) : 0,
      count: bin.count,
    }))
    .filter(b => b.count > 0);
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
  pointXs: Float64Array,
  pointYs: Float64Array,
  maxNeighbors: number,
  outIndexes: Int32Array,
  outDistances: Float64Array,
): number {
  let neighborCount = 0;
  let worstNeighborSlot = 0;
  let worstNeighborDistance = -Infinity;

  for (let i = 0; i < pointXs.length; i++) {
    const dist = approximateDistanceKm(x, y, pointXs[i], pointYs[i]);

    if (neighborCount < maxNeighbors) {
      outIndexes[neighborCount] = i;
      outDistances[neighborCount] = dist;
      if (dist > worstNeighborDistance) {
        worstNeighborDistance = dist;
        worstNeighborSlot = neighborCount;
      }
      neighborCount++;
      continue;
    }

    if (dist < worstNeighborDistance) {
      outIndexes[worstNeighborSlot] = i;
      outDistances[worstNeighborSlot] = dist;

      worstNeighborDistance = outDistances[0];
      worstNeighborSlot = 0;
      for (let slot = 1; slot < neighborCount; slot++) {
        if (outDistances[slot] > worstNeighborDistance) {
          worstNeighborDistance = outDistances[slot];
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
  const neighborDistances = new Float64Array(maxNeighbors);
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
      const nn = selectNearestPointIndexes(
        centerX,
        centerY,
        pointXs,
        pointYs,
        maxNeighbors,
        neighborIndexes,
        neighborDistances,
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

export function ordinaryKrigingInterpolate(
  knownPoints: InterpolationPoint[],
  gridWidth: number,
  gridHeight: number,
  bounds: { west: number; east: number; south: number; north: number },
  maxNeighbors: number = 12,
  tileSize: number = 1,
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

  // Step 1: Compute experimental variogram
  const experimental = computeExperimentalVariogram(normalizedPoints);

  // Step 2: Fit spherical model
  const { nugget, sill, range } = fitSphericalVariogram(experimental);

  const pointCount = normalizedPoints.length;
  const pointXs = new Float64Array(pointCount);
  const pointYs = new Float64Array(pointCount);
  const pointValues = new Float64Array(pointCount);
  for (let i = 0; i < pointCount; i++) {
    pointXs[i] = normalizedPoints[i].x;
    pointYs[i] = normalizedPoints[i].y;
    pointValues[i] = normalizedPoints[i].value;
  }

  const neighborLimit = Math.max(1, Math.min(maxNeighbors > 0 ? maxNeighbors : pointCount, pointCount));
  const neighborIndexes = new Int32Array(neighborLimit);
  const neighborDistances = new Float64Array(neighborLimit);
  const pairwiseSemivariance = new Float64Array(pointCount * pointCount);
  for (let i = 0; i < pointCount; i++) {
    for (let j = i + 1; j < pointCount; j++) {
      const d = approximateDistanceKm(pointXs[i], pointYs[i], pointXs[j], pointYs[j]);
      const gamma = sphericalVariogram(d, nugget, sill, range);
      pairwiseSemivariance[i * pointCount + j] = gamma;
      pairwiseSemivariance[j * pointCount + i] = gamma;
    }
  }

  const maxSystemSize = neighborLimit + 1;
  const aug = new Float64Array(maxSystemSize * (maxSystemSize + 1));
  const weights = new Float64Array(maxSystemSize);
  const effectiveTileSize = Math.max(1, Math.floor(tileSize));

  if (effectiveTileSize > 1) {
    const stats = interpolateKrigingTiles(
      values,
      gridWidth,
      gridHeight,
      bounds,
      pointXs,
      pointYs,
      pointValues,
      pairwiseSemivariance,
      nugget,
      sill,
      range,
      neighborLimit,
      effectiveTileSize,
    );
    return { width: gridWidth, height: gridHeight, bounds, values, min: stats.min, max: stats.max };
  }

  // Step 3: Interpolate each grid point
  let min = Infinity, max = -Infinity;

  const lonStep = gridWidth > 1 ? (bounds.east - bounds.west) / (gridWidth - 1) : 0;
  const latStep = gridHeight > 1 ? (bounds.north - bounds.south) / (gridHeight - 1) : 0;

  for (let row = 0; row < gridHeight; row++) {
    for (let col = 0; col < gridWidth; col++) {
      const x = bounds.west + col * lonStep;
      const y = bounds.south + row * latStep;

      let neighborCount = 0;
      let worstNeighborSlot = 0;
      let worstNeighborDistance = -Infinity;
      let exactMatchIndex = -1;

      for (let i = 0; i < pointCount; i++) {
        const dist = approximateDistanceKm(x, y, pointXs[i], pointYs[i]);
        if (dist < 1e-10) {
          exactMatchIndex = i;
          break;
        }

        if (neighborCount < neighborLimit) {
          neighborIndexes[neighborCount] = i;
          neighborDistances[neighborCount] = dist;
          if (dist > worstNeighborDistance) {
            worstNeighborDistance = dist;
            worstNeighborSlot = neighborCount;
          }
          neighborCount++;
          continue;
        }

        if (dist < worstNeighborDistance) {
          neighborIndexes[worstNeighborSlot] = i;
          neighborDistances[worstNeighborSlot] = dist;

          worstNeighborDistance = neighborDistances[0];
          worstNeighborSlot = 0;
          for (let slot = 1; slot < neighborCount; slot++) {
            if (neighborDistances[slot] > worstNeighborDistance) {
              worstNeighborDistance = neighborDistances[slot];
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

  return { width: gridWidth, height: gridHeight, bounds, values, min, max };
}

// ---------------------------------------------------------------------------
// AQI Color Scale & Grid Rendering
// ---------------------------------------------------------------------------

/**
 * Convert PM2.5 (ug/m3) to US EPA AQI index.
 * Uses EPA's piecewise-linear breakpoints.
 */
export function pm25ToAqi(pm25: number): number {
  const bp: Array<[number, number, number, number]> = [
    // [concLow, concHigh, aqiLow, aqiHigh]
    [0.0, 12.0, 0, 50],
    [12.1, 35.4, 51, 100],
    [35.5, 55.4, 101, 150],
    [55.5, 150.4, 151, 200],
    [150.5, 250.4, 201, 300],
    [250.5, 350.4, 301, 400],
    [350.5, 500.4, 401, 500],
  ];
  const c = Math.max(0, pm25);
  if (c > 500.4) return 500;
  for (const [cLo, cHi, aLo, aHi] of bp) {
    if (c >= cLo && c <= cHi) {
      return ((aHi - aLo) / (cHi - cLo)) * (c - cLo) + aLo;
    }
  }
  return 0;
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
