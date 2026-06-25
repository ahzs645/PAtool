export type ImportFieldRole =
  | "timestamp"
  | "timezone"
  | "sensorId"
  | "referenceId"
  | "latitude"
  | "longitude"
  | "pollutant"
  | "referencePollutant"
  | "sensorPollutant"
  | "windSpeed"
  | "windDirection"
  | "temperature"
  | "humidity"
  | "pressure"
  | "qaFlag";

export type ImportColumnMapping = Partial<Record<ImportFieldRole, string>>;

export type ImportPreset = {
  id: string;
  label: string;
  description: string;
  aliases: Partial<Record<ImportFieldRole, string[]>>;
};

export type MappedImportRow = {
  raw: Record<string, string>;
  timestamp: string | null;
  sensorId: string | null;
  referenceId: string | null;
  latitude: number | null;
  longitude: number | null;
  pollutant: number | null;
  referencePollutant: number | null;
  sensorPollutant: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  temperature: number | null;
  humidity: number | null;
  pressure: number | null;
  qaFlag: string | null;
};

export const IMPORT_PRESETS: ImportPreset[] = [
  {
    id: "asdu-standard",
    label: "ASDU / ASNAT standard format",
    description: "Standard-format files produced by the EPA Air Sensor Data Unifier (ASDU) for loading into ASNAT.",
    aliases: {
      timestamp: ["timestamp(UTC)", "timestamp", "datetime(UTC)", "datetime", "time(UTC)"],
      sensorId: ["id(-)", "id", "site", "site_id", "monitor_id", "sensor"],
      longitude: ["longitude(deg)", "longitude", "lon", "lng"],
      latitude: ["latitude(deg)", "latitude", "lat"],
      pollutant: [
        "pm25(ug/m3)", "pm10(ug/m3)", "ozone(ppb)", "o3(ppb)", "no2(ppb)", "co(ppm)", "so2(ppb)",
        "pm25", "pm2.5", "pm10", "ozone", "o3", "no2", "co", "so2", "measurement", "value", "concentration",
      ],
      temperature: ["temperature(C)", "temperature", "temp"],
      humidity: ["relativeHumidity(%)", "humidity", "rh"],
      pressure: ["seaLevelPress(hPa)", "pressure(hPa)", "pressure"],
      qaFlag: ["flagged(-)", "flag", "qa_flag"],
    },
  },
  {
    id: "epa-collocation",
    label: "EPA collocation",
    description: "Sensor/reference comparison files with timestamped pollutant columns.",
    aliases: {
      timestamp: ["timestamp", "datetime", "date_gmt", "sample_time", "time"],
      referencePollutant: ["reference", "ref", "frM", "fem", "pm25_ref", "conc_ref"],
      sensorPollutant: ["sensor", "candidate", "pm25_sensor", "conc_sensor", "raw"],
      temperature: ["temperature", "temp", "temp_c"],
      humidity: ["humidity", "rh", "relative_humidity"],
    },
  },
  {
    id: "purpleair-ab",
    label: "PurpleAir A/B",
    description: "PurpleAir history exports with A/B channels and environmental fields.",
    aliases: {
      timestamp: ["timestamp", "created_at", "time_stamp", "datetime"],
      sensorId: ["sensor_index", "sensor_id", "id", "label"],
      sensorPollutant: ["pm2.5_atm", "pm2_5_atm", "pm25", "pm2.5_cf_1"],
      humidity: ["humidity", "rh"],
      temperature: ["temperature", "temp_f", "temp"],
      pressure: ["pressure", "pressure_mbar"],
    },
  },
  {
    id: "sentinel-fenceline",
    label: "SENTINEL fenceline",
    description: "Fenceline sensor files with concentration, wind, met, and QA fields.",
    aliases: {
      timestamp: ["timestamp", "date_time", "datetime", "date"],
      sensorId: ["sensor", "sensor_id", "node", "unit"],
      pollutant: ["concentration", "conc", "signal", "pm25", "pm2.5"],
      windSpeed: ["wind_speed", "ws", "ws_ms"],
      windDirection: ["wind_direction", "wd", "wd_deg"],
      humidity: ["humidity", "rh"],
      temperature: ["temperature", "temp"],
      qaFlag: ["qa", "qa_flag", "flag"],
    },
  },
  {
    id: "mobile-campaign",
    label: "Mobile campaign",
    description: "AirBeam/mobile sensor route data with location and PM2.5.",
    aliases: {
      timestamp: ["timestamp", "time", "date_time"],
      sensorId: ["session", "sensor", "sensor_id"],
      latitude: ["latitude", "lat"],
      longitude: ["longitude", "lon", "lng"],
      pollutant: ["pm2.5", "pm25", "value", "concentration"],
    },
  },
];

export function inferImportMapping(columns: readonly string[], presetId?: string): ImportColumnMapping {
  const normalized = new Map(columns.map((column) => [normalizeColumn(column), column]));
  const presets = presetId
    ? IMPORT_PRESETS.filter((preset) => preset.id === presetId)
    : IMPORT_PRESETS;
  const mapping: ImportColumnMapping = {};

  for (const preset of presets) {
    for (const [role, aliases] of Object.entries(preset.aliases) as Array<[ImportFieldRole, string[]]>) {
      if (mapping[role]) continue;
      const match = aliases.find((alias) => normalized.has(normalizeColumn(alias)));
      if (match) mapping[role] = normalized.get(normalizeColumn(match));
    }
  }

  return mapping;
}

export function applyImportMapping(
  rows: Array<Record<string, string>>,
  mapping: ImportColumnMapping,
): MappedImportRow[] {
  return rows.map((row) => ({
    raw: row,
    timestamp: readString(row, mapping.timestamp),
    sensorId: readString(row, mapping.sensorId),
    referenceId: readString(row, mapping.referenceId),
    latitude: readNumber(row, mapping.latitude),
    longitude: readNumber(row, mapping.longitude),
    pollutant: readNumber(row, mapping.pollutant),
    referencePollutant: readNumber(row, mapping.referencePollutant),
    sensorPollutant: readNumber(row, mapping.sensorPollutant),
    windSpeed: readNumber(row, mapping.windSpeed),
    windDirection: readNumber(row, mapping.windDirection),
    temperature: readNumber(row, mapping.temperature),
    humidity: readNumber(row, mapping.humidity),
    pressure: readNumber(row, mapping.pressure),
    qaFlag: readString(row, mapping.qaFlag),
  }));
}

function normalizeColumn(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function readString(row: Record<string, string>, column: string | undefined): string | null {
  if (!column) return null;
  const value = row[column]?.trim();
  return value ? value : null;
}

function readNumber(row: Record<string, string>, column: string | undefined): number | null {
  const value = readString(row, column);
  if (value === null) return null;
  const number = Number(value.replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}
