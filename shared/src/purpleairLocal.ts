import {
  type Citation,
  pasRecordSchema,
  patSeriesSchema,
  type PasRecord,
  type PatSeries,
} from "./domain";

export type PurpleAirLocalOptions = {
  id?: string;
  label?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
  locationType?: "inside" | "outside" | "unknown";
  timestamp?: string;
};

export type CorrectionProfile = {
  id: "epa-barkjohn-2021";
  label: string;
  citation: Citation;
  appliesTo: "purpleair-pm25";
  requiresHumidity: true;
  correct: (pm25: number | null | undefined, humidity: number | null | undefined) => number | null;
};

function safeNumber(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function firstNumber(raw: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = safeNumber(raw[key]);
    if (typeof value === "number") {
      return value;
    }
  }

  return null;
}

function firstString(raw: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return undefined;
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

function parseLocalTimestamp(raw: Record<string, unknown>, fallback?: string): string {
  const rawTimestamp = raw.DateTime ?? raw.date_time ?? raw.last_seen ?? raw.timestamp ?? raw.time_stamp ?? fallback;

  if (typeof rawTimestamp === "number" && Number.isFinite(rawTimestamp)) {
    return new Date(rawTimestamp > 10_000_000_000 ? rawTimestamp : rawTimestamp * 1000).toISOString();
  }

  if (typeof rawTimestamp === "string" && rawTimestamp.trim()) {
    const asNumber = Number(rawTimestamp);
    if (Number.isFinite(asNumber)) {
      return new Date(asNumber > 10_000_000_000 ? asNumber : asNumber * 1000).toISOString();
    }

    const parsed = new Date(rawTimestamp);
    if (Number.isFinite(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return new Date().toISOString();
}

function localSensorId(raw: Record<string, unknown>, options: PurpleAirLocalOptions = {}): string {
  return (
    options.id
    ?? firstString(raw, ["SensorId", "sensor_index", "sensorId", "Id", "id", "Geo", "geo"])
    ?? "local-purpleair"
  );
}

function localSensorLabel(raw: Record<string, unknown>, options: PurpleAirLocalOptions = {}): string {
  return (
    options.label
    ?? firstString(raw, ["name", "label", "Geo", "geo", "SensorId", "sensor_index", "Id", "id"])
    ?? "Local PurpleAir"
  );
}

export function correctPurpleAirPm25(
  pm25: number | null | undefined,
  humidity: number | null | undefined,
): number | null {
  if (typeof pm25 !== "number" || !Number.isFinite(pm25)) return null;
  if (typeof humidity !== "number" || !Number.isFinite(humidity)) return Number(Math.max(0, pm25).toFixed(3));

  return Number(Math.max(0, 0.524 * pm25 - 0.0862 * humidity + 5.75).toFixed(3));
}

export const correctionProfile: CorrectionProfile = {
  id: "epa-barkjohn-2021",
  label: "US EPA/Barkjohn PurpleAir PM2.5 correction",
  citation: {
    title: "A correction model for PurpleAir PM2.5 data in the United States",
    url: "https://amt.copernicus.org/articles/14/4617/2021/",
    year: 2021,
  },
  appliesTo: "purpleair-pm25",
  requiresHumidity: true,
  correct: correctPurpleAirPm25,
};

export function purpleAirLocalPm25(raw: Record<string, unknown>, corrected = false): number | null {
  const humidity = firstNumber(raw, ["current_humidity", "humidity", "Humidity"]);
  const preferred = firstNumber(raw, [
    "pm2.5_atm",
    "pm2_5_atm",
    "pm2.5_atm_a",
    "pm2_5_atm_a",
    "pm2.5_cf_1",
    "pm2_5_cf_1",
    "pm25",
    "pm2_5",
  ]);

  return corrected ? correctPurpleAirPm25(preferred, humidity) : preferred;
}

export function normalizePurpleAirLocalRecord(input: unknown, options: PurpleAirLocalOptions = {}): PasRecord {
  const raw = input as Record<string, unknown>;
  const latitude = options.latitude ?? firstNumber(raw, ["lat", "latitude", "Latitude"]) ?? 0;
  const longitude = options.longitude ?? firstNumber(raw, ["lon", "lng", "longitude", "Longitude"]) ?? 0;
  const humidity = firstNumber(raw, ["current_humidity", "humidity", "Humidity"]);
  const temperature = firstNumber(raw, ["current_temp_f", "temperature", "Temperature"]);
  const pressure = firstNumber(raw, ["pressure", "current_pressure", "Pressure"]);

  return pasRecordSchema.parse({
    id: localSensorId(raw, options),
    label: localSensorLabel(raw, options),
    latitude,
    longitude,
    timezone: options.timezone,
    locationType: options.locationType ?? locationTypeFromRaw(raw.location_type ?? raw.place ?? raw.DEVICE_LOCATIONTYPE),
    uniqueId: firstString(raw, ["mac", "Mac", "Geo", "geo"]),
    pm25Current: purpleAirLocalPm25(raw),
    humidity,
    pressure,
    temperature,
  });
}

export function normalizePurpleAirLocalSeries(input: unknown, options: PurpleAirLocalOptions = {}): PatSeries {
  const raw = input as Record<string, unknown>;
  const humidity = firstNumber(raw, ["current_humidity", "humidity", "Humidity"]);
  const temperature = firstNumber(raw, ["current_temp_f", "temperature", "Temperature"]);
  const pressure = firstNumber(raw, ["pressure", "current_pressure", "Pressure"]);
  const pm25A = firstNumber(raw, [
    "pm2.5_atm_a",
    "pm2_5_atm_a",
    "pm2.5_atm",
    "pm2_5_atm",
    "pm2.5_cf_1_a",
    "pm2_5_cf_1_a",
    "pm2.5_cf_1",
    "pm2_5_cf_1",
  ]);
  const pm25B = firstNumber(raw, [
    "pm2.5_atm_b",
    "pm2_5_atm_b",
    "pm2.5_cf_1_b",
    "pm2_5_cf_1_b",
  ]);

  return patSeriesSchema.parse({
    meta: {
      sensorId: localSensorId(raw, options),
      label: localSensorLabel(raw, options),
      timezone: options.timezone ?? "UTC",
      latitude: options.latitude ?? firstNumber(raw, ["lat", "latitude", "Latitude"]) ?? undefined,
      longitude: options.longitude ?? firstNumber(raw, ["lon", "lng", "longitude", "Longitude"]) ?? undefined,
    },
    points: [{
      timestamp: parseLocalTimestamp(raw, options.timestamp),
      pm25A,
      pm25B,
      humidity,
      temperature,
      pressure,
    }],
  });
}
