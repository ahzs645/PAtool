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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function dewpointF(temperatureF: number | null, humidity: number | null): number | null {
  if (temperatureF === null || humidity === null || humidity <= 0) return null;
  const temperatureC = (temperatureF - 32) * 5 / 9;
  const rh = clamp(humidity, 0.1, 100);
  const gamma = Math.log(rh / 100) + (17.625 * temperatureC) / (243.04 + temperatureC);
  const dewpointC = (243.04 * gamma) / (17.625 - gamma);
  return Number((dewpointC * 9 / 5 + 32).toFixed(3));
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
  const adjustedHumidity = typeof humidity === "number" ? Number(clamp(humidity + 4, 0, 100).toFixed(3)) : null;
  const adjustedTemperature = typeof temperature === "number" ? Number((temperature - 8).toFixed(3)) : null;

  return pasRecordSchema.parse({
    id: localSensorId(raw, options),
    label: localSensorLabel(raw, options),
    latitude,
    longitude,
    timezone: options.timezone,
    locationType: options.locationType ?? locationTypeFromRaw(raw.location_type ?? raw.place ?? raw.DEVICE_LOCATIONTYPE),
    uniqueId: firstString(raw, ["mac", "Mac", "Geo", "geo"]),
    pm25Current: purpleAirLocalPm25(raw),
    pm25Cf1: firstNumber(raw, ["pm2.5_cf_1", "pm2_5_cf_1", "pm25_cf_1"]),
    pm25Cf1A: firstNumber(raw, ["pm2.5_cf_1_a", "pm2_5_cf_1_a"]),
    pm25Cf1B: firstNumber(raw, ["pm2.5_cf_1_b", "pm2_5_cf_1_b"]),
    pm25Atm: firstNumber(raw, ["pm2.5_atm", "pm2_5_atm", "pm25"]),
    pm25AtmA: firstNumber(raw, ["pm2.5_atm_a", "pm2_5_atm_a", "pm2.5_atm"]),
    pm25AtmB: firstNumber(raw, ["pm2.5_atm_b", "pm2_5_atm_b"]),
    pm25Alt: firstNumber(raw, ["pm2.5_alt", "pm2_5_alt"]),
    pm25AltA: firstNumber(raw, ["pm2.5_alt_a", "pm2_5_alt_a"]),
    pm25AltB: firstNumber(raw, ["pm2.5_alt_b", "pm2_5_alt_b"]),
    pm1Atm: firstNumber(raw, ["pm1.0_atm", "pm1_0_atm"]),
    pm10Atm: firstNumber(raw, ["pm10.0_atm", "pm10_0_atm"]),
    particleCount03um: firstNumber(raw, ["0.3_um_count", "p_0_3_um", "particles_03um"]),
    particleCount05um: firstNumber(raw, ["0.5_um_count", "p_0_5_um", "particles_05um"]),
    particleCount10um: firstNumber(raw, ["10.0_um_count", "p_10_0_um", "particles_10um"]),
    humidity,
    adjustedHumidity,
    pressure,
    temperature,
    adjustedTemperature,
    dewpoint: dewpointF(adjustedTemperature, adjustedHumidity),
    confidence: firstNumber(raw, ["confidence"]),
    channelFlags: firstNumber(raw, ["channel_flags", "channelFlags"]),
    rssi: firstNumber(raw, ["rssi", "RSSI"]),
    uptimeMinutes: firstNumber(raw, ["uptime", "uptime_minutes"]),
    paLatencyMs: firstNumber(raw, ["pa_latency", "paLatencyMs"]),
    memoryKb: firstNumber(raw, ["memory", "memory_kb"]),
    firmwareVersion: firstString(raw, ["firmware_version", "firmwareVersion"]),
    hardwareVersion: firstString(raw, ["hardware", "hardware_version", "hardwareVersion"]),
    lastSeen: firstString(raw, ["last_seen", "lastSeen"]),
  });
}

export function normalizePurpleAirLocalSeries(input: unknown, options: PurpleAirLocalOptions = {}): PatSeries {
  const raw = input as Record<string, unknown>;
  const humidity = firstNumber(raw, ["current_humidity", "humidity", "Humidity"]);
  const temperature = firstNumber(raw, ["current_temp_f", "temperature", "Temperature"]);
  const pressure = firstNumber(raw, ["pressure", "current_pressure", "Pressure"]);
  const adjustedHumidity = typeof humidity === "number" ? Number(clamp(humidity + 4, 0, 100).toFixed(3)) : null;
  const adjustedTemperature = typeof temperature === "number" ? Number((temperature - 8).toFixed(3)) : null;
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
      pm25Cf1A: firstNumber(raw, ["pm2.5_cf_1_a", "pm2_5_cf_1_a", "pm2.5_cf_1", "pm2_5_cf_1"]),
      pm25Cf1B: firstNumber(raw, ["pm2.5_cf_1_b", "pm2_5_cf_1_b"]),
      pm25AtmA: firstNumber(raw, ["pm2.5_atm_a", "pm2_5_atm_a", "pm2.5_atm", "pm2_5_atm"]),
      pm25AtmB: firstNumber(raw, ["pm2.5_atm_b", "pm2_5_atm_b"]),
      pm25AltA: firstNumber(raw, ["pm2.5_alt_a", "pm2_5_alt_a", "pm2.5_alt", "pm2_5_alt"]),
      pm25AltB: firstNumber(raw, ["pm2.5_alt_b", "pm2_5_alt_b"]),
      particleCount03umA: firstNumber(raw, ["0.3_um_count_a", "p_0_3_um_a"]),
      particleCount03umB: firstNumber(raw, ["0.3_um_count_b", "p_0_3_um_b"]),
      confidence: firstNumber(raw, ["confidence"]),
      channelFlags: firstNumber(raw, ["channel_flags", "channelFlags"]),
      humidity,
      temperature,
      adjustedHumidity,
      adjustedTemperature,
      dewpoint: dewpointF(adjustedTemperature, adjustedHumidity),
      pressure,
    }],
  });
}
