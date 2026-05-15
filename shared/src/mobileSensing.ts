export type MobileSourceKind = "airbeam" | "purpleair" | "openaq" | "reference" | "generic";

export type MobileAggregation = "raw" | "1min" | "1hr" | "1day";

export type MobileSensingPoint = {
  id: string;
  source: MobileSourceKind;
  sourceId: string;
  sessionId: string;
  timestamp: string;
  latitude: number;
  longitude: number;
  pm25: number;
  humidity?: number | null;
  temperature?: number | null;
  gpsAccuracyMeters?: number | null;
  speedMetersPerSecond?: number | null;
  bearingDegrees?: number | null;
  sampleCount?: number;
};

export type MobileSessionSummary = {
  sessionId: string;
  source: MobileSourceKind;
  sourceId: string;
  pointCount: number;
  startedAt: string | null;
  endedAt: string | null;
  latitudeMean: number | null;
  longitudeMean: number | null;
  pm25Mean: number | null;
  pm25Median: number | null;
  pm25P95: number | null;
  distanceKm: number;
  durationMinutes: number | null;
};

export type MobileCampaignSummary = {
  sessionCount: number;
  pointCount: number;
  startedAt: string | null;
  endedAt: string | null;
  pm25Mean: number | null;
  pm25Median: number | null;
  pm25P95: number | null;
  distanceKm: number;
  sessions: MobileSessionSummary[];
};

export type ReferenceMonitor = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  source?: string;
  pm25?: number | null;
};

export type ReferenceMonitorMatch = {
  monitor: ReferenceMonitor;
  distanceKm: number;
};

export type ReferenceObservation = {
  timestamp: string;
  pm25: number;
  monitorId?: string;
};

export type AdjustedMobilePoint = MobileSensingPoint & {
  referencePm25: number;
  referencePeriodMean: number;
  adjustmentRatio: number;
  adjustedPm25: number;
};

export type MobileCalendarCell = {
  date: string;
  dayOfWeek: number;
  weekIndex: number;
  pm25Mean: number;
  sampleCount: number;
  aqiCategory: Pm25AqiCategory;
};

export type Pm25AqiCategory = "good" | "moderate" | "unhealthy-sensitive" | "unhealthy" | "very-unhealthy" | "hazardous";

export type DistributionSummary = {
  count: number;
  min: number | null;
  q1: number | null;
  median: number | null;
  q3: number | null;
  max: number | null;
  mean: number | null;
  stdDev: number | null;
  missing: number;
};

export type HistogramBin = {
  min: number;
  max: number;
  count: number;
};

export type RouteSegmentSummary = {
  segmentId: string;
  sessionId: string;
  startedAt: string;
  endedAt: string;
  pointCount: number;
  distanceKm: number;
  pm25Mean: number;
  pm25Max: number;
  latitudeMean: number;
  longitudeMean: number;
};

export type MobileQcOptions = {
  maxGpsAccuracyMeters?: number;
  maxSpeedMetersPerSecond?: number;
  minPm25?: number;
  maxPm25?: number;
};

export type MobileQcIssue = {
  code: "gps-accuracy" | "impossible-speed" | "pm25-range" | "duplicate-timestamp" | "invalid-coordinate";
  message: string;
  count: number;
};

export type MobileQcResult = {
  totalPoints: number;
  keptPoints: number;
  removedPoints: number;
  issues: MobileQcIssue[];
  cleanedPoints: MobileSensingPoint[];
};

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const EARTH_RADIUS_KM = 6371.0088;

const PM25_AQI_BREAKS: Array<{ upper: number; category: Pm25AqiCategory }> = [
  { upper: 12, category: "good" },
  { upper: 35, category: "moderate" },
  { upper: 55, category: "unhealthy-sensitive" },
  { upper: 150, category: "unhealthy" },
  { upper: 250, category: "very-unhealthy" },
  { upper: Infinity, category: "hazardous" },
];

export function parseAirBeamCsv(text: string, options: { sourceId?: string; fallbackSessionId?: string } = {}): MobileSensingPoint[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];

  const headers = rows[0].map(normalizeHeader);
  const index = (candidates: string[]) => candidates.map((candidate) => headers.indexOf(candidate)).find((i) => i >= 0) ?? -1;
  const sessionIndex = index(["sessionname", "session", "sessionid", "file", "filename"]);
  const timestampIndex = index(["timestamp", "time", "datetime", "date"]);
  const latIndex = index(["latitude", "lat"]);
  const lonIndex = index(["longitude", "lon", "lng"]);
  const pm25Index = index(["pm25", "pm25ugm3", "pm25value", "pm25airbeam", "particulatematterpm25"]);
  const humidityIndex = index(["humidity", "rh", "relativehumidity"]);
  const temperatureIndex = index(["temperature", "temp"]);
  const gpsAccuracyIndex = index(["gpsaccuracy", "accuracy", "gpsaccuracymeters"]);

  if (timestampIndex < 0 || latIndex < 0 || lonIndex < 0 || pm25Index < 0) return [];

  const fallbackSessionId = options.fallbackSessionId ?? "airbeam-session";
  const sourceId = options.sourceId ?? fallbackSessionId;

  return rows.slice(1).flatMap((row, rowIndex) => {
    const timestamp = parseTimestamp(row[timestampIndex]);
    const latitude = numeric(row[latIndex]);
    const longitude = numeric(row[lonIndex]);
    const pm25 = numeric(row[pm25Index]);
    if (!timestamp || latitude === null || longitude === null || pm25 === null) return [];

    const sessionId = cleanText(row[sessionIndex]) || fallbackSessionId;
    return [{
      id: `${sourceId}:${sessionId}:${timestamp}:${rowIndex}`,
      source: "airbeam" as const,
      sourceId,
      sessionId,
      timestamp,
      latitude,
      longitude,
      pm25,
      humidity: humidityIndex >= 0 ? numeric(row[humidityIndex]) : null,
      temperature: temperatureIndex >= 0 ? numeric(row[temperatureIndex]) : null,
      gpsAccuracyMeters: gpsAccuracyIndex >= 0 ? numeric(row[gpsAccuracyIndex]) : null,
      sampleCount: 1,
    }];
  }).sort(comparePoints);
}

export function aggregateMobilePoints(
  points: ReadonlyArray<MobileSensingPoint>,
  aggregation: MobileAggregation,
): MobileSensingPoint[] {
  if (aggregation === "raw") return [...points].sort(comparePoints);

  const groups = new Map<string, MobileSensingPoint[]>();
  for (const point of points) {
    const bucket = floorTimestamp(point.timestamp, aggregation);
    if (!bucket) continue;
    const key = `${point.source}\u0000${point.sourceId}\u0000${point.sessionId}\u0000${bucket}`;
    const group = groups.get(key);
    if (group) group.push(point);
    else groups.set(key, [point]);
  }

  return [...groups.values()].map((group) => {
    const first = group[0];
    const timestamp = floorTimestamp(first.timestamp, aggregation) ?? first.timestamp;
    return {
      ...first,
      id: `${first.sourceId}:${first.sessionId}:${timestamp}:${aggregation}`,
      timestamp,
      latitude: meanRequired(group.map((point) => point.latitude)),
      longitude: meanRequired(group.map((point) => point.longitude)),
      pm25: meanRequired(group.map((point) => point.pm25)),
      humidity: meanOptional(group.map((point) => point.humidity)),
      temperature: meanOptional(group.map((point) => point.temperature)),
      gpsAccuracyMeters: meanOptional(group.map((point) => point.gpsAccuracyMeters)),
      speedMetersPerSecond: meanOptional(group.map((point) => point.speedMetersPerSecond)),
      bearingDegrees: null,
      sampleCount: group.reduce((sum, point) => sum + (point.sampleCount ?? 1), 0),
    };
  }).sort(comparePoints);
}

export function cleanMobilePoints(
  points: ReadonlyArray<MobileSensingPoint>,
  options: MobileQcOptions = {},
): MobileQcResult {
  const maxGpsAccuracyMeters = options.maxGpsAccuracyMeters ?? 100;
  const maxSpeedMetersPerSecond = options.maxSpeedMetersPerSecond ?? 45;
  const minPm25 = options.minPm25 ?? 0;
  const maxPm25 = options.maxPm25 ?? 1000;
  const issueCounts = new Map<MobileQcIssue["code"], number>();
  const seenTimestampBySession = new Set<string>();
  const kept: MobileSensingPoint[] = [];
  let previousBySession = new Map<string, MobileSensingPoint>();

  const addIssue = (code: MobileQcIssue["code"]) => {
    issueCounts.set(code, (issueCounts.get(code) ?? 0) + 1);
  };

  for (const point of [...points].sort(comparePoints)) {
    const duplicateKey = `${point.sessionId}\u0000${point.timestamp}`;
    const invalidCoordinate = !Number.isFinite(point.latitude)
      || !Number.isFinite(point.longitude)
      || Math.abs(point.latitude) > 90
      || Math.abs(point.longitude) > 180;
    const poorGps = typeof point.gpsAccuracyMeters === "number"
      && Number.isFinite(point.gpsAccuracyMeters)
      && point.gpsAccuracyMeters > maxGpsAccuracyMeters;
    const invalidPm = !Number.isFinite(point.pm25) || point.pm25 < minPm25 || point.pm25 > maxPm25;
    const duplicate = seenTimestampBySession.has(duplicateKey);
    const previous = previousBySession.get(point.sessionId);
    const speed = previous ? inferredSpeedMetersPerSecond(previous, point) : point.speedMetersPerSecond ?? 0;
    const impossibleSpeed = speed > maxSpeedMetersPerSecond;

    seenTimestampBySession.add(duplicateKey);
    previousBySession.set(point.sessionId, point);

    if (invalidCoordinate) addIssue("invalid-coordinate");
    if (poorGps) addIssue("gps-accuracy");
    if (invalidPm) addIssue("pm25-range");
    if (duplicate) addIssue("duplicate-timestamp");
    if (impossibleSpeed) addIssue("impossible-speed");

    if (invalidCoordinate || poorGps || invalidPm || duplicate || impossibleSpeed) continue;
    kept.push({ ...point, speedMetersPerSecond: point.speedMetersPerSecond ?? (previous ? speed : point.speedMetersPerSecond) });
  }

  return {
    totalPoints: points.length,
    keptPoints: kept.length,
    removedPoints: points.length - kept.length,
    issues: [...issueCounts.entries()].map(([code, count]) => ({ code, count, message: qcMessage(code) })),
    cleanedPoints: kept,
  };
}

export function summarizeMobileCampaign(points: ReadonlyArray<MobileSensingPoint>): MobileCampaignSummary {
  const sorted = [...points].sort(comparePoints);
  const sessions = new Map<string, MobileSensingPoint[]>();
  for (const point of sorted) {
    const group = sessions.get(point.sessionId);
    if (group) group.push(point);
    else sessions.set(point.sessionId, [point]);
  }
  const sessionSummaries = [...sessions.values()].map(summarizeMobileSession);

  return {
    sessionCount: sessionSummaries.length,
    pointCount: sorted.length,
    startedAt: sorted[0]?.timestamp ?? null,
    endedAt: sorted.at(-1)?.timestamp ?? null,
    pm25Mean: meanOptional(sorted.map((point) => point.pm25)),
    pm25Median: percentile(sorted.map((point) => point.pm25), 0.5),
    pm25P95: percentile(sorted.map((point) => point.pm25), 0.95),
    distanceKm: round(sessionSummaries.reduce((sum, session) => sum + session.distanceKm, 0), 3),
    sessions: sessionSummaries,
  };
}

export function summarizeMobileSession(points: ReadonlyArray<MobileSensingPoint>): MobileSessionSummary {
  const sorted = [...points].sort(comparePoints);
  const first = sorted[0];
  const last = sorted.at(-1);
  const startedMs = first ? Date.parse(first.timestamp) : Number.NaN;
  const endedMs = last ? Date.parse(last.timestamp) : Number.NaN;

  return {
    sessionId: first?.sessionId ?? "unknown",
    source: first?.source ?? "generic",
    sourceId: first?.sourceId ?? "unknown",
    pointCount: sorted.length,
    startedAt: first?.timestamp ?? null,
    endedAt: last?.timestamp ?? null,
    latitudeMean: meanOptional(sorted.map((point) => point.latitude)),
    longitudeMean: meanOptional(sorted.map((point) => point.longitude)),
    pm25Mean: meanOptional(sorted.map((point) => point.pm25)),
    pm25Median: percentile(sorted.map((point) => point.pm25), 0.5),
    pm25P95: percentile(sorted.map((point) => point.pm25), 0.95),
    distanceKm: round(routeDistanceKm(sorted), 3),
    durationMinutes: Number.isFinite(startedMs) && Number.isFinite(endedMs) ? round((endedMs - startedMs) / MS_PER_MINUTE, 1) : null,
  };
}

export function findNearestReferenceMonitor(
  points: ReadonlyArray<MobileSensingPoint>,
  monitors: ReadonlyArray<ReferenceMonitor>,
): ReferenceMonitorMatch | null {
  const center = meanLocation(points);
  if (!center || monitors.length === 0) return null;
  return monitors
    .map((monitor) => ({ monitor, distanceKm: haversineKm(center.latitude, center.longitude, monitor.latitude, monitor.longitude) }))
    .sort((a, b) => a.distanceKm - b.distanceKm)[0] ?? null;
}

export function findReferenceMonitorsWithinRadius(
  points: ReadonlyArray<MobileSensingPoint>,
  monitors: ReadonlyArray<ReferenceMonitor>,
  radiusKm = 20,
): ReferenceMonitorMatch[] {
  const center = meanLocation(points);
  if (!center) return [];
  return monitors
    .map((monitor) => ({ monitor, distanceKm: haversineKm(center.latitude, center.longitude, monitor.latitude, monitor.longitude) }))
    .filter((match) => match.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

export function temporallyAdjustMobilePoints(
  points: ReadonlyArray<MobileSensingPoint>,
  reference: ReadonlyArray<ReferenceObservation>,
  aggregation: Exclude<MobileAggregation, "raw"> = "1hr",
): AdjustedMobilePoint[] {
  const referenceBuckets = new Map<string, number[]>();
  for (const observation of reference) {
    const bucket = floorTimestamp(observation.timestamp, aggregation);
    if (!bucket || !Number.isFinite(observation.pm25)) continue;
    const values = referenceBuckets.get(bucket);
    if (values) values.push(observation.pm25);
    else referenceBuckets.set(bucket, [observation.pm25]);
  }

  const periodMeans = new Map([...referenceBuckets.entries()].map(([key, values]) => [key, meanRequired(values)]));
  const referencePeriodMean = meanOptional([...periodMeans.values()]);
  if (referencePeriodMean === null || referencePeriodMean <= 0) return [];

  return points.flatMap((point) => {
    const bucket = floorTimestamp(point.timestamp, aggregation);
    const referencePm25 = bucket ? periodMeans.get(bucket) : undefined;
    if (referencePm25 === undefined || referencePm25 <= 0) return [];
    const adjustmentRatio = referencePm25 / referencePeriodMean;
    return [{
      ...point,
      referencePm25,
      referencePeriodMean,
      adjustmentRatio,
      adjustedPm25: point.pm25 / adjustmentRatio,
    }];
  });
}

export function buildMobileCalendar(points: ReadonlyArray<MobileSensingPoint>): MobileCalendarCell[] {
  const groups = new Map<string, MobileSensingPoint[]>();
  for (const point of points) {
    const date = point.timestamp.slice(0, 10);
    const group = groups.get(date);
    if (group) group.push(point);
    else groups.set(date, [point]);
  }
  const firstDate = [...groups.keys()].sort()[0];
  const firstMs = firstDate ? Date.parse(`${firstDate}T00:00:00.000Z`) : 0;

  return [...groups.entries()]
    .map(([date, group]) => {
      const ms = Date.parse(`${date}T00:00:00.000Z`);
      const pm25Mean = meanRequired(group.map((point) => point.pm25));
      return {
        date,
        dayOfWeek: new Date(ms).getUTCDay(),
        weekIndex: Math.floor((ms - firstMs) / MS_PER_DAY / 7),
        pm25Mean: round(pm25Mean, 3),
        sampleCount: group.reduce((sum, point) => sum + (point.sampleCount ?? 1), 0),
        aqiCategory: pm25AqiCategory(pm25Mean),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function summarizeDistribution(values: ReadonlyArray<number | null | undefined>): DistributionSummary {
  const finite = values.filter(isFiniteNumber).sort((a, b) => a - b);
  return {
    count: finite.length,
    min: finite[0] ?? null,
    q1: percentile(finite, 0.25),
    median: percentile(finite, 0.5),
    q3: percentile(finite, 0.75),
    max: finite.at(-1) ?? null,
    mean: meanOptional(finite),
    stdDev: stdDev(finite),
    missing: values.length - finite.length,
  };
}

export function buildHistogram(values: ReadonlyArray<number | null | undefined>, binCount = 12): HistogramBin[] {
  const finite = values.filter(isFiniteNumber);
  if (finite.length === 0) return [];
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (min === max) return [{ min, max, count: finite.length }];
  const width = (max - min) / Math.max(1, binCount);
  const bins = Array.from({ length: binCount }, (_, index) => ({
    min: min + index * width,
    max: index === binCount - 1 ? max : min + (index + 1) * width,
    count: 0,
  }));
  for (const value of finite) {
    const index = Math.min(binCount - 1, Math.floor((value - min) / width));
    bins[index].count += 1;
  }
  return bins;
}

export function buildRouteSegments(
  points: ReadonlyArray<MobileSensingPoint>,
  options: { targetDistanceKm?: number } = {},
): RouteSegmentSummary[] {
  const targetDistanceKm = options.targetDistanceKm ?? 0.25;
  const sessions = new Map<string, MobileSensingPoint[]>();
  for (const point of [...points].sort(comparePoints)) {
    const group = sessions.get(point.sessionId);
    if (group) group.push(point);
    else sessions.set(point.sessionId, [point]);
  }

  const segments: RouteSegmentSummary[] = [];
  for (const [sessionId, sessionPoints] of sessions) {
    let current: MobileSensingPoint[] = [];
    let currentDistance = 0;
    let segmentIndex = 1;
    for (const point of sessionPoints) {
      const previous = current.at(-1);
      if (previous) currentDistance += haversineKm(previous.latitude, previous.longitude, point.latitude, point.longitude);
      current.push(point);
      if (currentDistance >= targetDistanceKm && current.length >= 2) {
        segments.push(segmentFromPoints(sessionId, segmentIndex, current, currentDistance));
        segmentIndex += 1;
        current = [point];
        currentDistance = 0;
      }
    }
    if (current.length >= 2) {
      segments.push(segmentFromPoints(sessionId, segmentIndex, current, currentDistance));
    }
  }
  return segments;
}

export function pm25AqiCategory(pm25: number): Pm25AqiCategory {
  return PM25_AQI_BREAKS.find((entry) => pm25 <= entry.upper)?.category ?? "hazardous";
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((value) => value.trim() !== "")) rows.push(row);
  return rows;
}

function segmentFromPoints(
  sessionId: string,
  segmentIndex: number,
  points: MobileSensingPoint[],
  distanceKm: number,
): RouteSegmentSummary {
  const pm25 = points.map((point) => point.pm25);
  return {
    segmentId: `${sessionId}-${segmentIndex}`,
    sessionId,
    startedAt: points[0].timestamp,
    endedAt: points.at(-1)?.timestamp ?? points[0].timestamp,
    pointCount: points.length,
    distanceKm: round(distanceKm, 3),
    pm25Mean: round(meanRequired(pm25), 3),
    pm25Max: round(Math.max(...pm25), 3),
    latitudeMean: round(meanRequired(points.map((point) => point.latitude)), 6),
    longitudeMean: round(meanRequired(points.map((point) => point.longitude)), 6),
  };
}

function meanLocation(points: ReadonlyArray<MobileSensingPoint>): { latitude: number; longitude: number } | null {
  const lat = meanOptional(points.map((point) => point.latitude));
  const lon = meanOptional(points.map((point) => point.longitude));
  return lat === null || lon === null ? null : { latitude: lat, longitude: lon };
}

function routeDistanceKm(points: ReadonlyArray<MobileSensingPoint>): number {
  let distance = 0;
  for (let i = 1; i < points.length; i += 1) {
    distance += haversineKm(points[i - 1].latitude, points[i - 1].longitude, points[i].latitude, points[i].longitude);
  }
  return distance;
}

function inferredSpeedMetersPerSecond(previous: MobileSensingPoint, current: MobileSensingPoint): number {
  const elapsedSeconds = (Date.parse(current.timestamp) - Date.parse(previous.timestamp)) / 1000;
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return 0;
  return (haversineKm(previous.latitude, previous.longitude, current.latitude, current.longitude) * 1000) / elapsedSeconds;
}

function qcMessage(code: MobileQcIssue["code"]): string {
  switch (code) {
    case "gps-accuracy":
      return "GPS accuracy exceeded the configured threshold.";
    case "impossible-speed":
      return "Consecutive points imply movement faster than the configured threshold.";
    case "pm25-range":
      return "PM2.5 fell outside the configured physical range.";
    case "duplicate-timestamp":
      return "A session contained duplicate timestamps.";
    case "invalid-coordinate":
      return "Latitude or longitude was missing or outside valid bounds.";
  }
}

function floorTimestamp(timestamp: string, aggregation: MobileAggregation): string | null {
  const ms = Date.parse(timestamp);
  if (!Number.isFinite(ms)) return null;
  const width = aggregation === "1min" ? MS_PER_MINUTE : aggregation === "1hr" ? MS_PER_HOUR : MS_PER_DAY;
  return new Date(Math.floor(ms / width) * width).toISOString();
}

function parseTimestamp(value: string | undefined): string | null {
  const cleaned = cleanText(value);
  if (!cleaned) return null;
  const ms = Date.parse(cleaned);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function normalizeHeader(header: string): string {
  return header.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
}

function numeric(value: string | number | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanText(value: string | undefined): string {
  return String(value ?? "").trim();
}

function comparePoints(a: MobileSensingPoint, b: MobileSensingPoint): number {
  return a.timestamp.localeCompare(b.timestamp) || a.sessionId.localeCompare(b.sessionId);
}

function meanRequired(values: ReadonlyArray<number>): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function meanOptional(values: ReadonlyArray<number | null | undefined>): number | null {
  const finite = values.filter(isFiniteNumber);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

function percentile(values: ReadonlyArray<number | null | undefined>, p: number): number | null {
  const finite = values.filter(isFiniteNumber).sort((a, b) => a - b);
  if (!finite.length) return null;
  const index = (finite.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return finite[lower];
  const weight = index - lower;
  return finite[lower] * (1 - weight) + finite[upper] * weight;
}

function stdDev(values: ReadonlyArray<number>): number | null {
  if (values.length < 2) return null;
  const avg = meanRequired(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1));
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function toRadians(value: number): number {
  return value * Math.PI / 180;
}
