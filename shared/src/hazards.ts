export type HazardSource = "hms" | "firms" | "hrrr";

export type HrrrWindSample = {
  source: "hrrr";
  timestamp: string;
  cycle?: string;
  forecastHour?: number;
  latitude: number;
  longitude: number;
  windDirection: number;
  windSpeed: number;
  u?: number;
  v?: number;
};

export type FireDetection = {
  source: "firms" | "hms";
  latitude: number;
  longitude: number;
  acquisitionTime: string;
  satellite?: string;
  instrument?: string;
  confidence?: string | number;
  frpMw?: number | null;
  brightness?: number | null;
};

export type SmokePolygon = {
  source: "hms";
  density: "light" | "medium" | "heavy" | "unknown";
  timestamp: string;
  geometry: GeoJsonGeometry;
  properties?: Record<string, unknown>;
};

export type HazardContext = {
  generatedAt: string;
  attribution: string;
  cautions: string[];
  wind?: HrrrWindSample[];
  fires?: FireDetection[];
  smoke?: SmokePolygon[];
};

export type GeoJsonGeometry =
  | { type: "Point"; coordinates: number[] }
  | { type: "MultiPoint"; coordinates: number[][] }
  | { type: "LineString"; coordinates: number[][] }
  | { type: "MultiLineString"; coordinates: number[][][] }
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

export function parseFirmsCsv(text: string): FireDetection[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((cell) => cell.trim());

  return rows.slice(1).flatMap((row): FireDetection[] => {
    const record = Object.fromEntries(header.map((key, index) => [key, row[index] ?? ""]));
    const latitude = Number(record.latitude ?? record.lat);
    const longitude = Number(record.longitude ?? record.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];

    const date = String(record.acq_date ?? "").trim();
    const time = String(record.acq_time ?? "").padStart(4, "0");
    const timestamp = /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? new Date(`${date}T${time.slice(0, 2)}:${time.slice(2, 4)}:00Z`).toISOString()
      : new Date().toISOString();

    return [{
      source: "firms",
      latitude,
      longitude,
      acquisitionTime: timestamp,
      satellite: stringOrUndefined(record.satellite),
      instrument: stringOrUndefined(record.instrument),
      confidence: stringOrUndefined(record.confidence),
      frpMw: finiteNumber(record.frp),
      brightness: finiteNumber(record.brightness),
    }];
  });
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function finiteNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((part) => part.trim())) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }

  row.push(cell);
  if (row.some((part) => part.trim())) rows.push(row);
  return rows;
}
