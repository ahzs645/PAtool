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

export type HazardEventAttribution = {
  label: "likely sensor fault" | "likely smoke event" | "likely local source" | "reference mismatch" | "insufficient context";
  confidence: "high" | "medium" | "low";
  reasons: string[];
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

export function parseHmsSmokeGeoJson(input: unknown, bounds?: { west: number; south: number; east: number; north: number }): SmokePolygon[] {
  const collection = input as { type?: string; features?: unknown[] };
  if (collection?.type !== "FeatureCollection" || !Array.isArray(collection.features)) return [];

  return collection.features.flatMap((feature): SmokePolygon[] => {
    const raw = feature as { geometry?: GeoJsonGeometry | null; properties?: Record<string, unknown> };
    if (!raw.geometry || !geometryIntersectsBounds(raw.geometry, bounds)) return [];
    return [{
      source: "hms",
      density: hmsDensity(raw.properties),
      timestamp: hmsTimestamp(raw.properties),
      geometry: raw.geometry,
      properties: raw.properties,
    }];
  });
}

export function attributePm25Event(context: {
  channelDisagreement?: boolean;
  pm25Spike?: boolean;
  nearbySmoke?: boolean;
  nearbyFire?: boolean;
  windAligned?: boolean;
  referenceMismatch?: boolean;
}): HazardEventAttribution {
  if (context.channelDisagreement) {
    return {
      label: "likely sensor fault",
      confidence: context.pm25Spike ? "high" : "medium",
      reasons: ["PurpleAir A/B channels disagree during the event window."],
    };
  }
  if (context.nearbySmoke || context.nearbyFire) {
    const reasons = [
      context.nearbySmoke ? "NOAA HMS smoke intersects the sensor area." : "",
      context.nearbyFire ? "NASA FIRMS fire detections are nearby." : "",
      context.windAligned ? "Wind context is consistent with transport toward the sensor." : "",
    ].filter(Boolean);
    return {
      label: "likely smoke event",
      confidence: context.nearbySmoke && context.nearbyFire ? "high" : "medium",
      reasons,
    };
  }
  if (context.referenceMismatch) {
    return {
      label: "reference mismatch",
      confidence: "medium",
      reasons: ["PurpleAir and reference observations diverge without matching local hazard context."],
    };
  }
  if (context.pm25Spike) {
    return {
      label: "likely local source",
      confidence: "low",
      reasons: ["PM2.5 rises without matching smoke, fire, or channel-fault context."],
    };
  }
  return {
    label: "insufficient context",
    confidence: "low",
    reasons: ["No event attribution signal was strong enough."],
  };
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function hmsDensity(properties: Record<string, unknown> | undefined): SmokePolygon["density"] {
  const raw = String(properties?.Density ?? properties?.density ?? properties?.SMOKE ?? "").toLowerCase();
  if (raw.includes("light")) return "light";
  if (raw.includes("medium")) return "medium";
  if (raw.includes("heavy")) return "heavy";
  return "unknown";
}

function hmsTimestamp(properties: Record<string, unknown> | undefined): string {
  const raw = properties?.Start ?? properties?.start ?? properties?.timestamp ?? properties?.valid_time;
  if (typeof raw === "string" && raw.trim()) {
    const parsed = new Date(raw);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function geometryIntersectsBounds(
  geometry: GeoJsonGeometry,
  bounds: { west: number; south: number; east: number; north: number } | undefined,
): boolean {
  if (!bounds) return true;
  const bbox = geometryBounds(geometry);
  if (!bbox) return false;
  return bbox.east >= bounds.west
    && bbox.west <= bounds.east
    && bbox.north >= bounds.south
    && bbox.south <= bounds.north;
}

function geometryBounds(geometry: GeoJsonGeometry): { west: number; south: number; east: number; north: number } | null {
  const coordinates = flattenCoordinates(geometry.coordinates);
  if (!coordinates.length) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [longitude, latitude] of coordinates) {
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) continue;
    west = Math.min(west, longitude);
    east = Math.max(east, longitude);
    south = Math.min(south, latitude);
    north = Math.max(north, latitude);
  }
  if (!Number.isFinite(west) || !Number.isFinite(south) || !Number.isFinite(east) || !Number.isFinite(north)) return null;
  return { west, south, east, north };
}

function flattenCoordinates(coordinates: unknown): number[][] {
  if (!Array.isArray(coordinates)) return [];
  if (typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
    return [coordinates as number[]];
  }
  return coordinates.flatMap((item) => flattenCoordinates(item));
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
