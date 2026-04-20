import {
  type DataStatus,
  type ComparisonResult,
  type FireDetection,
  type HazardContext,
  type PasCollection,
  type PatSeries,
  type PurpleAirLocalOptions,
  type ReferenceObservationSeries,
  type SensorRecord,
  buildReferenceComparison,
  normalizePurpleAirLocalRecord,
  normalizePurpleAirLocalSeries,
  normalizePasCollection,
  parseFirmsCsv,
  patAggregate,
  patFilterDate,
} from "@patool/shared";
import { samplePasCollection, samplePatSeries, sampleSensorRecord } from "@patool/shared/fixtures";

export type WorkerEnv = {
  ARCHIVE_BASE_URL?: string;
  PURPLEAIR_API_BASE?: string;
  PURPLEAIR_API_KEY?: string;
  PURPLEAIR_READ_KEY?: string;
  PURPLEAIR_LOCAL_SENSOR_URLS?: string;
  AIRNOW_API_KEY?: string;
  OPENAQ_API_KEY?: string;
  AQS_API_KEY?: string;
  AQS_EMAIL?: string;
  FIRMS_MAP_KEY?: string;
  AIRFUSE_BASE_URL?: string;
};

type PurpleAirFieldsPayload = {
  fields?: string[];
  data?: unknown[][];
};

export type PurpleAirAverage = "0" | "2" | "10" | "30" | "60" | "360" | "1440" | "10080" | "43200" | "525600";
export type PurpleAirHistoryField =
  | "pm2.5_atm_a"
  | "pm2.5_atm_b"
  | "pm2.5_a"
  | "pm2.5_b"
  | "pm2.5_cf_1_a"
  | "pm2.5_cf_1_b"
  | "humidity"
  | "temperature"
  | "pressure";

export type PurpleAirApiError = {
  status: number;
  message: string;
  retryable: boolean;
  body?: unknown;
};

export type PurpleAirHistoryWindow = {
  startTimestamp: number;
  endTimestamp: number;
};

export type PurpleAirHistoryWindowPlan = {
  average: PurpleAirAverage;
  windows: PurpleAirHistoryWindow[];
};

type ReferenceSourceParam = "airnow";

type BoundingBox = {
  west: number;
  south: number;
  east: number;
  north: number;
};

type LocalSensorConfig = PurpleAirLocalOptions & {
  url: string;
};

type FetchJsonOptions = {
  retries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  cache?: boolean;
};

type FetchCacheOptions = {
  cache?: boolean;
  cacheKeyScope?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 503 || status >= 500;
}

export function parsePurpleAirRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const deltaSeconds = Number(value);
  if (Number.isFinite(deltaSeconds) && deltaSeconds >= 0) {
    return deltaSeconds * 1000;
  }
  const dateMs = Date.parse(value);
  if (!Number.isFinite(dateMs)) return null;
  return Math.max(0, dateMs - Date.now());
}

async function tryFetchJson(url: string, init?: RequestInit, options: FetchJsonOptions = {}): Promise<unknown | null> {
  const { retries = 2, retryDelayMs = 750, timeoutMs = 10_000 } = options;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: init?.signal ?? AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) {
        return await response.json();
      }
      if (!isRetryableStatus(response.status) || attempt === retries) {
        return null;
      }

      await sleep(parsePurpleAirRetryAfter(response.headers.get("retry-after")) ?? retryDelayMs * 2 ** attempt);
    } catch {
      if (attempt === retries) return null;
      await sleep(retryDelayMs * 2 ** attempt);
    }
  }

  return null;
}

function purpleAirHeaders(env: WorkerEnv): HeadersInit | undefined {
  if (!env.PURPLEAIR_API_KEY && !env.PURPLEAIR_READ_KEY) return undefined;
  return {
    "User-Agent": "PAtool/0.1",
    ...(env.PURPLEAIR_API_KEY ? { "X-API-Key": env.PURPLEAIR_API_KEY } : {}),
    ...(env.PURPLEAIR_READ_KEY ? { "X-Read-Key": env.PURPLEAIR_READ_KEY } : {})
  };
}

async function fetchWithEdgeCache(
  url: string,
  init?: RequestInit,
  ttlSeconds = 300,
  options: FetchCacheOptions = {},
): Promise<unknown | null> {
  if (options.cache === false) {
    return tryFetchJson(url, init);
  }
  const cache = typeof caches !== "undefined" ? (caches as unknown as { default?: Cache }).default : undefined;
  const cacheUrl = options.cacheKeyScope ? `${url}#scope=${encodeURIComponent(options.cacheKeyScope)}` : url;
  const key = new Request(cacheUrl, { method: "GET" });

  if (cache) {
    const cached = await cache.match(key);
    if (cached) {
      try {
        return await cached.json();
      } catch {
        return null;
      }
    }
  }

  const response = await tryFetchJson(url, init);
  if (response && cache) {
    const payload = new Response(JSON.stringify(response), {
      headers: {
        "content-type": "application/json",
        "cache-control": `public, max-age=${ttlSeconds}`
      }
    });
    void cache.put(key, payload.clone());
  }

  return response;
}

function normalizeLocalSensorUrl(rawUrl: string): string {
  const withScheme = /^https?:\/\//i.test(rawUrl) ? rawUrl : `http://${rawUrl}`;
  const url = new URL(withScheme);

  if (!url.pathname || url.pathname === "/") {
    url.pathname = "/json";
  }

  if (url.pathname.endsWith("/json") && !url.searchParams.has("live")) {
    url.searchParams.set("live", "true");
  }

  return url.toString();
}

function parseLocalSensorConfigs(env: WorkerEnv): LocalSensorConfig[] {
  const raw = env.PURPLEAIR_LOCAL_SENSOR_URLS?.trim();
  if (!raw) return [];

  return raw
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry): LocalSensorConfig[] => {
      const separatorIndex = entry.indexOf("=");
      const id = separatorIndex > 0 ? entry.slice(0, separatorIndex).trim() : undefined;
      const rawUrl = separatorIndex > 0 ? entry.slice(separatorIndex + 1).trim() : entry;
      if (!rawUrl) return [];

      try {
        const url = normalizeLocalSensorUrl(rawUrl);
        const fallbackId = id || new URL(url).hostname;
        return [{ id: fallbackId, label: id, url }];
      } catch {
        return [];
      }
    });
}

async function getConfiguredLocalSensors(env: WorkerEnv): Promise<Array<{ config: LocalSensorConfig; payload: unknown }>> {
  const configs = parseLocalSensorConfigs(env);
  const settled: Array<{ config: LocalSensorConfig; payload: unknown } | null> = await Promise.all(
    configs.map(async (config) => {
      const payload: unknown | null = await tryFetchJson(config.url, undefined, { retries: 1, timeoutMs: 5_000 });
      return payload === null ? null : { config, payload };
    })
  );

  return settled.flatMap((item) => item === null ? [] : [item]);
}

export async function getLocalPasCollection(env: WorkerEnv = {}): Promise<PasCollection> {
  const localSensors = await getConfiguredLocalSensors(env);
  return {
    generatedAt: new Date().toISOString(),
    source: "local",
    records: localSensors.map(({ config, payload }) => normalizePurpleAirLocalRecord(payload, config)),
  };
}

export async function getDataStatus(env: WorkerEnv = {}): Promise<DataStatus> {
  const liveConfigured = Boolean(env.PURPLEAIR_API_KEY);
  const localConfigured = Boolean(env.PURPLEAIR_LOCAL_SENSOR_URLS?.trim());
  const [collection, localCollection] = await Promise.all([
    getPasCollection(env),
    localConfigured ? getLocalPasCollection(env) : Promise.resolve(null),
  ]);
  const warnings: string[] = [];

  if (liveConfigured && collection.source !== "live") {
    warnings.push("Live PurpleAir fetch is unavailable; PAtool is serving fallback data.");
  }
  if (localConfigured && localCollection?.records.length === 0) {
    warnings.push("Configured local PurpleAir sensors did not return LAN JSON data.");
  }
  if (!liveConfigured && !localConfigured && collection.source === "fixture") {
    warnings.push("Worker is serving bundled fixture data because no live or LAN source is configured.");
  }

  return {
    mode: "api",
    collectionSource: collection.source,
    generatedAt: new Date().toISOString(),
    liveConfigured,
    localConfigured,
    warnings,
  };
}

async function getLocalPatSeries(env: WorkerEnv, sensorId: string): Promise<PatSeries | null> {
  const localSensors = await getConfiguredLocalSensors(env);
  const match = localSensors.find(({ config, payload }) => {
    const normalized = normalizePurpleAirLocalRecord(payload, config);
    return normalized.id === sensorId || normalized.label === sensorId || config.id === sensorId;
  });

  return match ? normalizePurpleAirLocalSeries(match.payload, match.config) : null;
}

function mergeCollections(base: PasCollection, local: PasCollection): PasCollection {
  if (!local.records.length) return base;
  const byId = new Map(base.records.map((record) => [record.id, record]));
  for (const record of local.records) {
    byId.set(record.id, record);
  }

  return {
    ...base,
    generatedAt: new Date().toISOString(),
    records: [...byId.values()],
  };
}

function parseTimestampSeconds(input: string | undefined, end = false): number | undefined {
  if (!input) return undefined;
  const trimmed = input.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [year, month, day] = trimmed.split("-").map(Number);
    const date = Date.UTC(year, month - 1, day + (end ? 1 : 0), 0, 0, 0, 0);
    return Math.floor(date / 1000);
  }

  const parsed = new Date(trimmed);
  return Number.isFinite(parsed.getTime()) ? Math.floor(parsed.getTime() / 1000) : undefined;
}

const PURPLEAIR_HISTORY_FIELDS = [
  "pm2.5_atm_a",
  "pm2.5_atm_b",
  "humidity",
  "temperature",
  "pressure",
] as const satisfies readonly PurpleAirHistoryField[];

const PURPLEAIR_AVERAGE_BY_AGGREGATE: Record<"raw" | "hourly", PurpleAirAverage> = {
  raw: "0",
  hourly: "60",
};

const SECONDS_PER_DAY = 86_400;

const PURPLEAIR_MAX_HISTORY_WINDOW_SECONDS: Record<PurpleAirAverage, number> = {
  "0": 2 * SECONDS_PER_DAY,
  "2": 14 * SECONDS_PER_DAY,
  "10": 30 * SECONDS_PER_DAY,
  "30": 60 * SECONDS_PER_DAY,
  "60": 180 * SECONDS_PER_DAY,
  "360": 365 * SECONDS_PER_DAY,
  "1440": 3 * 365 * SECONDS_PER_DAY,
  "10080": 10 * 365 * SECONDS_PER_DAY,
  "43200": 30 * 365 * SECONDS_PER_DAY,
  "525600": 100 * 365 * SECONDS_PER_DAY,
};

export function planPurpleAirHistoryWindows(
  start?: string,
  end?: string,
  average: PurpleAirAverage = "0",
): PurpleAirHistoryWindowPlan {
  const startTimestamp = parseTimestampSeconds(start);
  const endTimestamp = parseTimestampSeconds(end, true);
  if (startTimestamp === undefined || endTimestamp === undefined || endTimestamp <= startTimestamp) {
    return { average, windows: [] };
  }

  const maxSpan = PURPLEAIR_MAX_HISTORY_WINDOW_SECONDS[average];
  const windows: PurpleAirHistoryWindow[] = [];
  for (let cursor = startTimestamp; cursor < endTimestamp; cursor += maxSpan) {
    windows.push({
      startTimestamp: cursor,
      endTimestamp: Math.min(cursor + maxSpan, endTimestamp),
    });
  }

  return { average, windows };
}

function buildPurpleAirHistoryUrl(
  liveBase: string,
  sensorId: string,
  options: {
    startTimestamp?: number;
    endTimestamp?: number;
    start?: string;
    end?: string;
    average?: PurpleAirAverage;
    fields?: readonly PurpleAirHistoryField[];
    readKey?: string;
  } = {},
): string {
  const url = new URL(`${liveBase.replace(/\/$/, "")}/sensors/${encodeURIComponent(sensorId)}/history`);
  const fields = options.fields ?? PURPLEAIR_HISTORY_FIELDS;
  url.searchParams.set("fields", fields.join(","));
  url.searchParams.set("average", options.average ?? "0");

  const startTimestamp = options.startTimestamp ?? parseTimestampSeconds(options.start);
  const endTimestamp = options.endTimestamp ?? parseTimestampSeconds(options.end, true);
  if (startTimestamp !== undefined) {
    url.searchParams.set("start_timestamp", String(startTimestamp));
  }
  if (endTimestamp !== undefined) {
    url.searchParams.set("end_timestamp", String(endTimestamp));
  }
  if (options.readKey) {
    url.searchParams.set("read_key", options.readKey);
  }

  return url.toString();
}

function normalizePatSeries(sensorId: string, payload: PurpleAirFieldsPayload): PatSeries | null {
  if (!payload.fields || !payload.data) return null;

  const indexOf = (name: string) => payload.fields?.indexOf(name) ?? -1;
  const timeIndex = [indexOf("time_stamp"), indexOf("time_stamp_utc"), indexOf("time")].find((index) => index >= 0) ?? -1;
  const aIndex = [indexOf("pm2.5_atm_a"), indexOf("pm2.5_a"), indexOf("pm2.5_cf_1_a")].find((index) => index >= 0) ?? -1;
  const bIndex = [indexOf("pm2.5_atm_b"), indexOf("pm2.5_b"), indexOf("pm2.5_cf_1_b")].find((index) => index >= 0) ?? -1;
  const humidityIndex = indexOf("humidity");
  const temperatureIndex = indexOf("temperature");
  const pressureIndex = indexOf("pressure");

  if (timeIndex < 0 || aIndex < 0 || bIndex < 0) return null;

  return {
    meta: {
      ...samplePatSeries.meta,
      sensorId
    },
    points: payload.data
      .map((row) => {
        const rawTime = row[timeIndex];
        const epoch = typeof rawTime === "number" ? rawTime : Number(rawTime);
        const timestamp = Number.isFinite(epoch)
          ? new Date(epoch > 10_000_000_000 ? epoch : epoch * 1000).toISOString()
          : new Date(String(rawTime)).toISOString();

        const toNumber = (value: unknown) => {
          const numeric = Number(value);
          return Number.isFinite(numeric) ? numeric : null;
        };

        return {
          timestamp,
          pm25A: toNumber(row[aIndex]),
          pm25B: toNumber(row[bIndex]),
          humidity: humidityIndex >= 0 ? toNumber(row[humidityIndex]) : null,
          temperature: temperatureIndex >= 0 ? toNumber(row[temperatureIndex]) : null,
          pressure: pressureIndex >= 0 ? toNumber(row[pressureIndex]) : null
        };
      })
      .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
  };
}

function mergePatSeries(sensorId: string, parts: PatSeries[]): PatSeries | null {
  const pointsByTimestamp = new Map<string, PatSeries["points"][number]>();
  for (const part of parts) {
    for (const point of part.points) {
      pointsByTimestamp.set(point.timestamp, point);
    }
  }

  if (!pointsByTimestamp.size) return null;
  return {
    meta: {
      ...samplePatSeries.meta,
      sensorId,
    },
    points: [...pointsByTimestamp.values()].sort((left, right) => left.timestamp.localeCompare(right.timestamp)),
  };
}

async function fetchPurpleAirSensorHistory(
  env: WorkerEnv,
  liveBase: string,
  sensorId: string,
  start?: string,
  end?: string,
  aggregate: "raw" | "hourly" = "raw",
): Promise<PatSeries | null> {
  const average = PURPLEAIR_AVERAGE_BY_AGGREGATE[aggregate];
  const windowPlan = planPurpleAirHistoryWindows(start, end, average);
  const windows = windowPlan.windows.length
    ? windowPlan.windows
    : [{ startTimestamp: parseTimestampSeconds(start), endTimestamp: parseTimestampSeconds(end, true) }];

  const payloads = await Promise.all(windows.map((window) => {
    const url = buildPurpleAirHistoryUrl(liveBase, sensorId, {
      average,
      startTimestamp: window.startTimestamp,
      endTimestamp: window.endTimestamp,
      readKey: env.PURPLEAIR_READ_KEY,
    });
    return fetchWithEdgeCache(
      url,
      { headers: purpleAirHeaders(env) },
      300,
      {
        cache: !env.PURPLEAIR_READ_KEY,
        cacheKeyScope: env.PURPLEAIR_READ_KEY ? undefined : `purpleair-history-${sensorId}-${average}`,
      },
    );
  }));

  const normalized = payloads.flatMap((payload): PatSeries[] => {
    if (!payload) return [];
    const series = normalizePatSeries(sensorId, payload as PurpleAirFieldsPayload);
    return series ? [series] : [];
  });

  return mergePatSeries(sensorId, normalized);
}

export async function getPasCollection(env: WorkerEnv = {}, date?: string): Promise<PasCollection> {
  if (env.ARCHIVE_BASE_URL && date) {
    const stamp = date.replaceAll("-", "");
    const year = stamp.slice(0, 4);
    const archive = await fetchWithEdgeCache(`${env.ARCHIVE_BASE_URL}/pas/${year}/pas_${stamp}.json`, undefined, 900);
    if (archive) {
      return normalizePasCollection(archive, "archive");
    }
  }

  const localCollection = date ? null : await getLocalPasCollection(env);

  if (env.PURPLEAIR_API_KEY) {
    const liveBase = env.PURPLEAIR_API_BASE ?? "https://api.purpleair.com/v1";
    const live = await fetchWithEdgeCache(
      `${liveBase}/sensors?fields=sensor_index,name,latitude,longitude,location_type,pm2.5,pm2.5_10minute,pm2.5_30minute,pm2.5_1hour,pm2.5_6hour,pm2.5_24hour,pm2.5_1week,humidity,pressure,temperature`,
      { headers: purpleAirHeaders(env) },
      300,
      {
        cache: !env.PURPLEAIR_READ_KEY,
        cacheKeyScope: "purpleair-sensors-public",
      },
    );
    if (live) {
      const liveCollection = normalizePasCollection(live, "live");
      return localCollection ? mergeCollections(liveCollection, localCollection) : liveCollection;
    }
  }

  if (localCollection?.records.length) {
    return localCollection;
  }

  return samplePasCollection;
}

export async function getPatSeries(
  env: WorkerEnv = {},
  sensorId: string,
  start?: string,
  end?: string,
  aggregate?: "raw" | "hourly"
): Promise<PatSeries> {
  let series: PatSeries = samplePatSeries.meta.sensorId === sensorId ? samplePatSeries : { ...samplePatSeries, meta: { ...samplePatSeries.meta, sensorId } };

  const localSeries = await getLocalPatSeries(env, sensorId);
  if (localSeries) {
    series = localSeries;
  } else if (env.PURPLEAIR_API_KEY) {
    const liveBase = env.PURPLEAIR_API_BASE ?? "https://api.purpleair.com/v1";
    const normalized = await fetchPurpleAirSensorHistory(env, liveBase, sensorId, start, end, aggregate ?? "raw");
    if (normalized) {
      series = normalized;
    }
  }

  if (start && end) {
    series = patFilterDate(series, start, end);
  }

  if (aggregate === "hourly") {
    return patAggregate(series, 60);
  }

  return series;
}

export async function getSensorRecord(env: WorkerEnv = {}, sensorId: string, period: "latest" | "month" | "year"): Promise<SensorRecord> {
  const series = await getPatSeries(env, sensorId);
  const latest = period === "latest" ? series.points.at(-1) ?? sampleSensorRecord.latest : series.points.at(-1) ?? sampleSensorRecord.latest;
  return {
    id: sensorId,
    meta: series.meta,
    latest
  };
}

function airNowTimestamp(obs: Record<string, unknown>): string {
  const date = typeof obs.DateObserved === "string" ? obs.DateObserved : new Date().toISOString().slice(0, 10);
  const hour = String(obs.HourObserved ?? "12").padStart(2, "0");
  return new Date(`${date}T${hour}:00:00Z`).toISOString();
}

export async function getAirNowConditions(
  env: WorkerEnv,
  latitude: number,
  longitude: number,
  distanceKm = 50,
): Promise<ReferenceObservationSeries | null> {
  if (env.AIRNOW_API_KEY) {
    const url = new URL("https://www.airnowapi.org/aq/observation/latLong/current/");
    url.searchParams.set("format", "application/json");
    url.searchParams.set("latitude", String(latitude));
    url.searchParams.set("longitude", String(longitude));
    url.searchParams.set("distance", String(distanceKm));
    url.searchParams.set("API_KEY", env.AIRNOW_API_KEY);

    const data = await tryFetchJson(url.toString());
    if (data && Array.isArray(data)) {
      const pm25Obs = (data as any[]).filter((d: any) => d.ParameterName === "PM2.5");
      if (pm25Obs.length > 0) {
        const label = `${pm25Obs[0].ReportingArea} (Federal)`;
        return {
          source: "airnow",
          kind: "conditions",
          label,
          latitude,
          longitude,
          sourceUrl: "https://docs.airnowapi.org/webservices",
          attribution: "AirNow reporting-area AQI from federal, state, local, and tribal monitoring agencies.",
          observations: pm25Obs.map((obs: any) => ({
            timestamp: airNowTimestamp(obs),
            parameter: "PM2.5",
            pm25: null,
            aqi: obs.AQI === null || obs.AQI === undefined ? null : Number(obs.AQI),
            provenance: "official-reference",
            category: typeof obs.Category?.Name === "string" ? obs.Category.Name : undefined,
            reportingArea: typeof obs.ReportingArea === "string" ? obs.ReportingArea : undefined,
          }))
        };
      }
    }
  }

  return null;
}

export async function getPwfslMonitorData(
  env: WorkerEnv,
  latitude: number,
  longitude: number,
): Promise<ReferenceObservationSeries | null> {
  return getAirNowConditions(env, latitude, longitude);
}

export async function getReferenceComparison(
  env: WorkerEnv,
  sensorId: string,
  latitude: number,
  longitude: number,
  start?: string,
  end?: string,
  source: ReferenceSourceParam = "airnow",
): Promise<ComparisonResult> {
  const [series, reference] = await Promise.all([
    getPatSeries(env, sensorId, start, end, "hourly"),
    source === "airnow" ? getAirNowConditions(env, latitude, longitude) : Promise.resolve(null),
  ]);

  return buildReferenceComparison(series, reference);
}

function clampDayRange(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.min(5, Math.max(1, Math.round(value)));
}

function isValidBounds(bounds: BoundingBox): boolean {
  return Number.isFinite(bounds.west)
    && Number.isFinite(bounds.south)
    && Number.isFinite(bounds.east)
    && Number.isFinite(bounds.north)
    && bounds.west >= -180
    && bounds.east <= 180
    && bounds.south >= -90
    && bounds.north <= 90
    && bounds.west < bounds.east
    && bounds.south < bounds.north;
}

export async function getFirmsFireDetections(
  env: WorkerEnv,
  bounds: BoundingBox,
  options: { dayRange?: number; date?: string; source?: string } = {},
): Promise<FireDetection[]> {
  if (!env.FIRMS_MAP_KEY || !isValidBounds(bounds)) return [];
  const dayRange = clampDayRange(options.dayRange);
  const source = options.source ?? "VIIRS_SNPP_NRT";
  const coordinates = `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`;
  const path = [
    "https://firms.modaps.eosdis.nasa.gov/api/area/csv",
    encodeURIComponent(env.FIRMS_MAP_KEY),
    encodeURIComponent(source),
    encodeURIComponent(coordinates),
    String(dayRange),
    ...(options.date ? [encodeURIComponent(options.date)] : []),
  ].join("/");

  try {
    const response = await fetch(path, {
      headers: { "user-agent": "PAtool/0.1" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return [];
    return parseFirmsCsv(await response.text());
  } catch {
    return [];
  }
}

export async function getHazardContext(
  env: WorkerEnv,
  bounds: BoundingBox,
  options: { dayRange?: number; date?: string } = {},
): Promise<HazardContext> {
  const fires = await getFirmsFireDetections(env, bounds, options);
  return {
    generatedAt: new Date().toISOString(),
    attribution: "NASA FIRMS active fire detections; HMS smoke and HRRR wind layers are reserved for the overlay pipeline.",
    cautions: [
      "FIRMS detections are satellite hotspots, not confirmed incident perimeters.",
      "Use smoke/fire context to explain possible PM2.5 spikes; do not treat it as a monitor replacement.",
    ],
    fires,
    smoke: [],
    wind: [],
  };
}
