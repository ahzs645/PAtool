import type { PatSeries } from "./domain";
import { applySentinelAutoQaFlags, type SentinelQaFlag } from "./qaFlags";

export type SentinelCanonicalField =
  | "sensorId"
  | "timestamp"
  | "signal"
  | "windSpeed"
  | "windDirection"
  | "temperature"
  | "humidity"
  | "latitude"
  | "longitude"
  | "canister"
  | "qa";

export type SentinelColumnMapping = Partial<Record<SentinelCanonicalField, string>>;

export type SentinelRawRow = Record<string, string>;

export type SentinelNormalizedRecord = {
  sensorId: string;
  timestamp: string;
  signal: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  temperature: number | null;
  humidity: number | null;
  latitude: number | null;
  longitude: number | null;
  canister: string | null;
  qaFlags: SentinelQaFlag[];
  sourceRow: number;
};

export type SentinelNormalizeOptions = {
  mapping: SentinelColumnMapping;
  timezone?: string;
  windSpeedUnit?: "m/s" | "mph";
  defaultSensorId?: string;
  autoQa?: boolean;
};

const CANDIDATES: Record<SentinelCanonicalField, string[]> = {
  sensorId: ["sensor_id", "sensor id", "unit", "serial", "spod", "id", "device"],
  timestamp: ["timestamp", "date/time", "date time", "local date time", "datetime", "time"],
  signal: ["signal_1", "signal", "pid1_ppb_calc", "pm25", "pm2.5", "pm2_5", "concentration"],
  windSpeed: ["ws", "ws_speed", "wind speed", "wind_speed"],
  windDirection: ["wd", "ws_direction", "wind direction", "wind_direction"],
  temperature: ["temp", "temperature", "ambient temperature"],
  humidity: ["rh", "rh_humd", "humidity", "relative humidity"],
  latitude: ["lat", "latitude"],
  longitude: ["long", "lon", "lng", "longitude"],
  canister: ["canister", "trig.trig_activeflag", "trigger", "canister trigger"],
  qa: ["qa", "flag", "flags", "quality"],
};

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += char;
    }
  }

  cells.push(cell.trim());
  return cells.map((value) => value.replace(/^"|"$/g, ""));
}

export function parseSentinelCsv(text: string, options: { skipRows?: number } = {}): SentinelRawRow[] {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .slice(options.skipRows ?? 0)
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];

  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row: SentinelRawRow = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? "";
    });
    return row;
  });
}

export function inferSentinelColumnMapping(headers: readonly string[]): SentinelColumnMapping {
  const normalized = new Map(headers.map((header) => [normalizeHeader(header), header]));
  const mapping: SentinelColumnMapping = {};

  for (const [field, candidates] of Object.entries(CANDIDATES) as Array<[SentinelCanonicalField, string[]]>) {
    const exact = candidates.map(normalizeHeader).find((candidate) => normalized.has(candidate));
    if (exact) {
      mapping[field] = normalized.get(exact);
      continue;
    }
    const partial = headers.find((header) => {
      const h = normalizeHeader(header);
      return candidates.some((candidate) => h.includes(normalizeHeader(candidate)));
    });
    if (partial) mapping[field] = partial;
  }

  return mapping;
}

function parseNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toUpperCase() === "NA") return null;
  const parsed = Number(trimmed.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTimestamp(value: string | undefined, timezone = "UTC"): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const isoWithoutOffset = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (isoWithoutOffset) {
    const [, y, mo, d, h, mi, s = "0"] = isoWithoutOffset;
    return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s))).toISOString();
  }

  const match = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?$/i);
  if (!match) {
    const direct = new Date(raw);
    return Number.isFinite(direct.getTime()) ? direct.toISOString() : raw;
  }
  const [, a, b, y, hh, mm, ss = "0", meridian] = match;
  const year = Number(y.length === 2 ? `20${y}` : y);
  const month = Number(a) > 12 ? Number(b) - 1 : Number(a) - 1;
  const day = Number(a) > 12 ? Number(a) : Number(b);
  let hour = Number(hh);
  if (meridian?.toUpperCase() === "PM" && hour < 12) hour += 12;
  if (meridian?.toUpperCase() === "AM" && hour === 12) hour = 0;

  // The Date constructor cannot apply arbitrary IANA zones without a larger
  // dependency path. Keep UTC stable unless the input already had an offset.
  const iso = new Date(Date.UTC(year, month, day, hour, Number(mm), Number(ss))).toISOString();
  return timezone === "UTC" ? iso : iso;
}

function parseManualFlags(value: string | undefined): SentinelQaFlag[] {
  if (!value) return [];
  return value
    .split(/[,;|]/)
    .map((flag) => flag.trim())
    .filter((flag): flag is SentinelQaFlag => flag.length > 0 && flag.toLowerCase() !== "none");
}

function mapped(row: SentinelRawRow, mapping: SentinelColumnMapping, field: SentinelCanonicalField): string | undefined {
  const column = mapping[field];
  return column ? row[column] : undefined;
}

export function normalizeSentinelRows(
  rows: readonly SentinelRawRow[],
  options: SentinelNormalizeOptions,
): SentinelNormalizedRecord[] {
  const speedFactor = options.windSpeedUnit === "mph" ? 1 / 2.237 : 1;
  const normalized = rows.map<SentinelNormalizedRecord>((row, index) => {
    const signal = parseNumber(mapped(row, options.mapping, "signal"));
    const windSpeed = parseNumber(mapped(row, options.mapping, "windSpeed"));
    return {
      sensorId: mapped(row, options.mapping, "sensorId")?.trim() || options.defaultSensorId || "uploaded-sensor",
      timestamp: parseTimestamp(mapped(row, options.mapping, "timestamp"), options.timezone),
      signal,
      windSpeed: windSpeed === null ? null : windSpeed * speedFactor,
      windDirection: parseNumber(mapped(row, options.mapping, "windDirection")),
      temperature: parseNumber(mapped(row, options.mapping, "temperature")),
      humidity: parseNumber(mapped(row, options.mapping, "humidity")),
      latitude: parseNumber(mapped(row, options.mapping, "latitude")),
      longitude: parseNumber(mapped(row, options.mapping, "longitude")),
      canister: mapped(row, options.mapping, "canister")?.trim() || null,
      qaFlags: parseManualFlags(mapped(row, options.mapping, "qa")),
      sourceRow: index + 1,
    };
  });

  return options.autoQa === false ? normalized : applySentinelAutoQaFlags(normalized);
}

export function sentinelRecordsToPatSeries(records: readonly SentinelNormalizedRecord[], sensorId?: string): PatSeries {
  const filtered = records
    .filter((record) => !sensorId || record.sensorId === sensorId)
    .filter((record) => record.timestamp)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const first = filtered[0];

  return {
    meta: {
      sensorId: sensorId ?? first?.sensorId ?? "uploaded-sensor",
      label: sensorId ?? first?.sensorId ?? "Uploaded sensor",
      timezone: "UTC",
      latitude: first?.latitude ?? undefined,
      longitude: first?.longitude ?? undefined,
    },
    points: filtered.map((record) => ({
      timestamp: record.timestamp,
      pm25A: record.signal,
      pm25B: null,
      humidity: record.humidity,
      temperature: record.temperature,
      pressure: null,
    })),
  };
}
