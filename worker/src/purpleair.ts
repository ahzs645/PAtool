import {
  type PasCollection,
  type PatSeries,
  type SensorRecord,
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
  AIRNOW_API_KEY?: string;
};

type PurpleAirFieldsPayload = {
  fields?: string[];
  data?: unknown[][];
};

async function tryFetchJson(url: string, init?: RequestInit): Promise<unknown | null> {
  try {
    const response = await fetch(url, init);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function purpleAirHeaders(env: WorkerEnv): HeadersInit | undefined {
  if (!env.PURPLEAIR_API_KEY && !env.PURPLEAIR_READ_KEY) return undefined;
  return {
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

  if (env.PURPLEAIR_API_KEY) {
    const liveBase = env.PURPLEAIR_API_BASE ?? "https://api.purpleair.com/v1";
    const live = await fetchWithEdgeCache(
      `${liveBase}/sensors?fields=sensor_index,name,latitude,longitude,location_type,pm2.5,pm2.5_10minute,pm2.5_30minute,pm2.5_1hour,pm2.5_6hour,pm2.5_24hour,pm2.5_1week,humidity,pressure,temperature`,
      { headers: purpleAirHeaders(env) }
    );
    if (live) {
      return normalizePasCollection(live, "live");
    }
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

  if (env.PURPLEAIR_API_KEY) {
    const liveBase = env.PURPLEAIR_API_BASE ?? "https://api.purpleair.com/v1";
    const history = await fetchWithEdgeCache(
      `${liveBase}/sensors/${sensorId}/history?fields=pm2.5_atm_a,pm2.5_atm_b,humidity,temperature,pressure`,
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
): Promise<PatSeries | null> {
  // Try to fetch from AirNow API if available
  if (env.AIRNOW_API_KEY) {
    const url = `https://www.airnowapi.org/aq/observation/latLong/current/?format=application/json&latitude=${latitude}&longitude=${longitude}&distance=50&API_KEY=${env.AIRNOW_API_KEY}`;
    const data = await tryFetchJson(url);
    if (data && Array.isArray(data)) {
      // Convert AirNow response to PatSeries format
      const pm25Obs = (data as any[]).filter((d: any) => d.ParameterName === "PM2.5");
      if (pm25Obs.length > 0) {
        return {
          meta: {
            sensorId: `airnow-${pm25Obs[0].ReportingArea}`,
            label: `${pm25Obs[0].ReportingArea} (Federal)`,
            timezone: "America/Los_Angeles",
          },
          points: pm25Obs.map((obs: any) => ({
            timestamp: new Date(obs.DateObserved + "T" + (obs.HourObserved ?? "12") + ":00:00").toISOString(),
            pm25A: obs.AQI ? Number(obs.AQI) : null,
            pm25B: null,
            humidity: null,
            temperature: null,
            pressure: null,
          }))
        };
      }
    }
  }

  return null;
}
