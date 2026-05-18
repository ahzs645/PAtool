// ---------------------------------------------------------------------------
// sourceLoaders — concrete `MonitorLoader` adapters that talk to live AQ
// services via JS-native `fetch`. Each loader returns a `Monitor` shaped
// for the `airMonitorPipeline` so they can be chained with `filterMeta`,
// `dailyLstMean`, etc.
//
// Keys are supplied by env vars on `WorkerEnv`; if a key is missing the
// loader throws a typed error rather than hitting the network.
// ---------------------------------------------------------------------------

import {
  Monitor,
  type LoaderQuery,
  type MonitorLoader,
  type MonitorMetaRow,
  type MonitorRow,
  lstOffsetHoursForTimezone,
} from "@patool/shared";

import type { WorkerEnv } from "./purpleair";

export class MissingApiKeyError extends Error {
  constructor(public readonly source: string) {
    super(`missing API key for ${source} loader`);
  }
}

// ---------------------------------------------------------------------------
// AirNow
// ---------------------------------------------------------------------------

export function createAirNowLoader(env: WorkerEnv): MonitorLoader {
  return {
    source: "AirNow",
    async load(query: LoaderQuery): Promise<Monitor> {
      const apiKey = env.AIRNOW_API_KEY;
      if (!apiKey) throw new MissingApiKeyError("AirNow");
      const params = new URLSearchParams({
        parameters: airNowParameter(query.parameter),
        BBOX: airNowBbox(query.bbox) ?? "-130,20,-60,60",
        dataType: "B",
        format: "application/json",
        verbose: "1",
        nowcastonly: "0",
        includerawconcentrations: "1",
        API_KEY: apiKey,
        startDate: query.start.slice(0, 13),
        endDate: query.end.slice(0, 13),
      });
      const response = await fetch(`https://www.airnowapi.org/aq/data/?${params.toString()}`);
      if (!response.ok) throw new Error(`AirNow ${response.status} ${response.statusText}`);
      const rows = (await response.json()) as AirNowRow[];
      return buildMonitor(rows.map((row) => ({
        siteId: row.SiteName ?? row.AgencyName ?? "AirNow",
        agency: row.AgencyName,
        latitude: row.Latitude,
        longitude: row.Longitude,
        timestamp: `${row.UTC}T00:00:00Z`,
        value: row.Value ?? null,
        timezone: undefined,
      })), "AirNow", query.parameter);
    },
  };
}

type AirNowRow = {
  Latitude: number;
  Longitude: number;
  UTC: string;
  Value: number | null;
  AgencyName?: string;
  SiteName?: string;
  Parameter?: string;
};

function airNowParameter(parameter: LoaderQuery["parameter"]): string {
  switch (parameter) {
    case "PM2.5": return "PM25";
    case "PM10": return "PM10";
    default: return parameter;
  }
}

function airNowBbox(bbox: LoaderQuery["bbox"]): string | null {
  if (!bbox) return null;
  return `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`;
}

// ---------------------------------------------------------------------------
// EPA AQS
// ---------------------------------------------------------------------------

export function createAqsLoader(env: WorkerEnv): MonitorLoader {
  return {
    source: "AQS",
    async load(query: LoaderQuery): Promise<Monitor> {
      if (!env.AQS_API_KEY || !env.AQS_EMAIL) throw new MissingApiKeyError("AQS");
      const params = new URLSearchParams({
        email: env.AQS_EMAIL,
        key: env.AQS_API_KEY,
        param: aqsParameter(query.parameter),
        bdate: yyyymmdd(query.start),
        edate: yyyymmdd(query.end),
        ...(query.bbox ? {
          minlat: String(query.bbox.south),
          maxlat: String(query.bbox.north),
          minlon: String(query.bbox.west),
          maxlon: String(query.bbox.east),
        } : {}),
      });
      const url = `https://aqs.epa.gov/data/api/sampleData/byBox?${params.toString()}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`AQS ${response.status} ${response.statusText}`);
      const payload = (await response.json()) as { Data: AqsRow[] };
      return buildMonitor(payload.Data.map((row) => ({
        siteId: `${row.state_code}-${row.county_code}-${row.site_number}`,
        agency: row.local_site_name ?? "EPA AQS",
        latitude: row.latitude,
        longitude: row.longitude,
        timestamp: `${row.date_gmt}T${row.time_gmt ?? "00:00"}:00Z`,
        value: row.sample_measurement,
        timezone: undefined,
      })), "AQS", query.parameter);
    },
  };
}

type AqsRow = {
  state_code: string;
  county_code: string;
  site_number: string;
  latitude: number;
  longitude: number;
  date_gmt: string;
  time_gmt?: string;
  sample_measurement: number;
  local_site_name?: string;
};

function aqsParameter(parameter: LoaderQuery["parameter"]): string {
  switch (parameter) {
    case "PM2.5": return "88101";
    case "PM10": return "81102";
    case "O3":   return "44201";
    case "NO2":  return "42602";
    case "CO":   return "42101";
    case "SO2":  return "42401";
  }
}

function yyyymmdd(iso: string): string {
  const date = new Date(iso);
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// OpenAQ v3
// ---------------------------------------------------------------------------

export function createOpenAqLoader(env: WorkerEnv): MonitorLoader {
  return {
    source: "OpenAQ",
    async load(query: LoaderQuery): Promise<Monitor> {
      if (!env.OPENAQ_API_KEY) throw new MissingApiKeyError("OpenAQ");
      const params = new URLSearchParams({
        parameter: query.parameter.toLowerCase(),
        date_from: query.start,
        date_to: query.end,
        limit: "1000",
        ...(query.bbox ? {
          bbox: `${query.bbox.west},${query.bbox.south},${query.bbox.east},${query.bbox.north}`,
        } : {}),
      });
      const response = await fetch(`https://api.openaq.org/v3/measurements?${params.toString()}`, {
        headers: { "X-API-Key": env.OPENAQ_API_KEY },
      });
      if (!response.ok) throw new Error(`OpenAQ ${response.status} ${response.statusText}`);
      const payload = (await response.json()) as { results: OpenAqMeasurement[] };
      return buildMonitor(payload.results.map((row) => ({
        siteId: row.location ?? `loc-${row.locationsId}`,
        agency: row.provider?.name,
        latitude: row.coordinates?.latitude ?? 0,
        longitude: row.coordinates?.longitude ?? 0,
        timestamp: row.period?.datetimeFrom?.utc ?? row.datetime ?? "",
        value: row.value,
        timezone: row.coordinates?.timezone,
      })), "OpenAQ", query.parameter);
    },
  };
}

type OpenAqMeasurement = {
  location?: string;
  locationsId?: number;
  value: number;
  datetime?: string;
  period?: { datetimeFrom?: { utc: string } };
  coordinates?: { latitude: number; longitude: number; timezone?: string };
  provider?: { name?: string };
};

// ---------------------------------------------------------------------------
// shared transform: rows → Monitor
// ---------------------------------------------------------------------------

type NormalizedRow = {
  siteId: string;
  agency?: string;
  latitude: number;
  longitude: number;
  timestamp: string;
  value: number | null;
  timezone: string | undefined;
};

function buildMonitor(rows: readonly NormalizedRow[], source: MonitorMetaRow["source"], parameter: LoaderQuery["parameter"]): Monitor {
  const metaIndex = new Map<string, MonitorMetaRow>();
  const dataByTs = new Map<string, MonitorRow>();
  for (const row of rows) {
    if (!row.timestamp || !Number.isFinite(row.value as number)) continue;
    if (!metaIndex.has(row.siteId)) {
      metaIndex.set(row.siteId, {
        monitorId: row.siteId,
        siteName: row.siteId,
        agency: row.agency,
        source,
        parameter,
        units: parameter === "CO" ? "ppm" : parameter.startsWith("PM") ? "ug/m3" : "ppb",
        latitude: row.latitude,
        longitude: row.longitude,
        timezone: row.timezone,
        utcOffsetHours: lstOffsetHoursForTimezone(row.timezone),
      });
    }
    const dataRow = dataByTs.get(row.timestamp) ?? { datetime: row.timestamp };
    dataRow[row.siteId] = row.value;
    dataByTs.set(row.timestamp, dataRow);
  }
  const meta = [...metaIndex.values()].sort((a, b) => a.monitorId.localeCompare(b.monitorId));
  const data = [...dataByTs.values()].sort((a, b) => a.datetime.localeCompare(b.datetime));
  return new Monitor(meta, data);
}
