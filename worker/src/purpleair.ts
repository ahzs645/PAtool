import {
  type DataStatus,
  type PasCollection,
  type PatSeries,
  type PurpleAirLocalOptions,
  type ReferenceObservationSeries,
  type SensorRecord,
  normalizePurpleAirLocalRecord,
  normalizePurpleAirLocalSeries,
  normalizePasCollection,
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
  AIRFUSE_BASE_URL?: string;
};

type PurpleAirFieldsPayload = {
  fields?: string[];
  data?: unknown[][];
};

type LocalSensorConfig = PurpleAirLocalOptions & {
  url: string;
};

type FetchJsonOptions = {
  retries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 503 || status >= 500;
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

      const retryAfter = Number(response.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : retryDelayMs * (attempt + 1));
    } catch {
      if (attempt === retries) return null;
      await sleep(retryDelayMs * (attempt + 1));
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

async function fetchWithEdgeCache(url: string, init?: RequestInit, ttlSeconds = 300): Promise<unknown | null> {
  const cache = typeof caches !== "undefined" ? (caches as unknown as { default?: Cache }).default : undefined;
  const key = new Request(url, { method: "GET" });

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

function buildPurpleAirHistoryUrl(
  liveBase: string,
  sensorId: string,
  start?: string,
  end?: string,
  aggregate: "raw" | "hourly" = "raw",
): string {
  const url = new URL(`${liveBase.replace(/\/$/, "")}/sensors/${encodeURIComponent(sensorId)}/history`);
  url.searchParams.set("fields", "pm2.5_atm_a,pm2.5_atm_b,humidity,temperature,pressure");
  url.searchParams.set("average", aggregate === "hourly" ? "60" : "0");

  const startTimestamp = parseTimestampSeconds(start);
  const endTimestamp = parseTimestampSeconds(end, true);
  if (startTimestamp !== undefined) {
    url.searchParams.set("start_timestamp", String(startTimestamp));
  }
  if (endTimestamp !== undefined) {
    url.searchParams.set("end_timestamp", String(endTimestamp));
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
      { headers: purpleAirHeaders(env) }
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
    const history = await fetchWithEdgeCache(
      buildPurpleAirHistoryUrl(liveBase, sensorId, start, end, aggregate ?? "raw"),
      { headers: purpleAirHeaders(env) }
    );
    const normalized = history ? normalizePatSeries(sensorId, history as PurpleAirFieldsPayload) : null;
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

export async function getPwfslMonitorData(
  env: WorkerEnv,
  latitude: number,
  longitude: number
): Promise<ReferenceObservationSeries | null> {
  // Try to fetch from AirNow API if available
  if (env.AIRNOW_API_KEY) {
    const url = `https://www.airnowapi.org/aq/observation/latLong/current/?format=application/json&latitude=${latitude}&longitude=${longitude}&distance=50&API_KEY=${env.AIRNOW_API_KEY}`;
    const data = await tryFetchJson(url);
    if (data && Array.isArray(data)) {
      const pm25Obs = (data as any[]).filter((d: any) => d.ParameterName === "PM2.5");
      if (pm25Obs.length > 0) {
        const label = `${pm25Obs[0].ReportingArea} (Federal)`;
        return {
          source: "airnow",
          label,
          latitude,
          longitude,
          observations: pm25Obs.map((obs: any) => ({
            timestamp: new Date(`${obs.DateObserved}T${String(obs.HourObserved ?? "12").padStart(2, "0")}:00:00Z`).toISOString(),
            parameter: "PM2.5",
            pm25: null,
            aqi: obs.AQI === null || obs.AQI === undefined ? null : Number(obs.AQI),
            category: typeof obs.Category?.Name === "string" ? obs.Category.Name : undefined,
            reportingArea: typeof obs.ReportingArea === "string" ? obs.ReportingArea : undefined,
          }))
        };
      }
    }
  }

  return null;
}
