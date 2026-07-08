// =============================================================================
// shared/src/purpleairCsvImport.ts
//
// Parse user-uploaded PurpleAir daily/hourly export CSVs into PAtool's runtime
// models so the whole app can run on a user's own network instead of the demo
// fixtures. Pure and dependency-free (no DOM/File APIs) so it is unit-testable
// and reusable; the browser layer only reads File -> text and hands it here.
//
// Expected columns (header row, order-independent):
//   time_stamp, sensor_number, latitude, longitude, pm2.5_cf_1,
//   humidity, temperature, pressure, pm1.0_cf_1, pm10.0_cf_1
//
// These exports carry a single combined pm2.5_cf_1 per sensor-hour (no A/B
// channels), so both PAT channels are filled with the same value; a warning
// documents that channel-agreement diagnostics will therefore look identical.
// =============================================================================

import { applyPurpleAirCorrection, type PasCollection, type PasRecord, type PatPoint, type PatSeries } from "./domain";
import { buildNetworkTimeSeries, type NetworkMeasurementRow, type NetworkTimeSeries } from "./networkTimeSeries";

export type PurpleAirCsvFile = { name: string; text: string };

export type PurpleAirImportSummary = {
  fileCount: number;
  rowCount: number;
  droppedRows: number;
  sensorCount: number;
  pointCount: number;
  start: string | null;
  end: string | null;
};

export type PurpleAirImportResult = {
  collection: PasCollection;
  series: PatSeries[];
  network: NetworkTimeSeries;
  summary: PurpleAirImportSummary;
  warnings: string[];
};

/** Split one CSV line, honouring double-quoted fields and escaped quotes. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"' && line[i + 1] === '"') {
      cur += '"';
      i += 1;
      continue;
    }
    if (c === '"') {
      quoted = !quoted;
      continue;
    }
    if (c === "," && !quoted) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

function normalizeTimestamp(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  // PurpleAir exports use e.g. "2022-11-17 00:00:00+00:00"; make it ISO-parseable.
  const t = Date.parse(value.includes("T") ? value : value.replace(" ", "T"));
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString().replace(/\.000Z$/, "Z");
}

function num(cell: string | undefined): number | null {
  if (cell === undefined) return null;
  const trimmed = cell.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return Number((values.reduce((s, v) => s + v, 0) / values.length).toFixed(3));
}

/** Mean of the last `count` finite pm2.5 values in an ascending series. */
function trailingMean(points: PatPoint[], count: number): number | null {
  const slice = points.slice(Math.max(0, points.length - count));
  return mean(slice.map((p) => p.pm25A).filter((v): v is number => v !== null));
}

function lastFinite(points: PatPoint[], key: "humidity" | "temperature" | "pressure"): number | null {
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const v = points[i][key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

type RawRow = {
  sensorId: string;
  timestamp: string;
  latitude: number | null;
  longitude: number | null;
  pm25Cf1: number;
  humidity: number | null;
  temperature: number | null;
  pressure: number | null;
};

function parseRows(files: readonly PurpleAirCsvFile[]): { rows: RawRow[]; droppedRows: number; skippedFiles: string[] } {
  const rows: RawRow[] = [];
  let droppedRows = 0;
  const skippedFiles: string[] = [];

  for (const file of files) {
    const lines = file.text.split(/\r?\n/).filter((l) => l.trim() !== "");
    if (lines.length < 2) {
      skippedFiles.push(file.name);
      continue;
    }
    const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
    const col = (name: string) => header.indexOf(name);
    const iTs = col("time_stamp");
    const iSn = col("sensor_number");
    const iLat = col("latitude");
    const iLon = col("longitude");
    const iPm = col("pm2.5_cf_1");
    const iRh = col("humidity");
    const iT = col("temperature");
    const iP = col("pressure");
    if (iTs < 0 || iSn < 0 || iPm < 0) {
      skippedFiles.push(file.name);
      continue;
    }
    for (let li = 1; li < lines.length; li += 1) {
      const cells = splitCsvLine(lines[li]);
      const ts = normalizeTimestamp(cells[iTs] ?? "");
      const sensorId = (cells[iSn] ?? "").trim();
      const pm25Cf1 = num(cells[iPm]);
      if (!ts || !sensorId || pm25Cf1 === null || pm25Cf1 < 0 || pm25Cf1 > 2000) {
        droppedRows += 1;
        continue;
      }
      rows.push({
        sensorId,
        timestamp: ts,
        latitude: iLat >= 0 ? num(cells[iLat]) : null,
        longitude: iLon >= 0 ? num(cells[iLon]) : null,
        pm25Cf1,
        humidity: iRh >= 0 ? num(cells[iRh]) : null,
        temperature: iT >= 0 ? num(cells[iT]) : null,
        pressure: iP >= 0 ? num(cells[iP]) : null,
      });
    }
  }
  return { rows, droppedRows, skippedFiles };
}

/**
 * Parse uploaded PurpleAir CSV exports into a PasCollection, per-sensor
 * PatSeries, and a daily NetworkTimeSeries (EPA AirNow F&SM corrected) for the
 * map. Throws if no usable rows are found.
 */
export function importPurpleAirCsv(
  files: readonly PurpleAirCsvFile[],
  options: { generatedAt?: string } = {},
): PurpleAirImportResult {
  const { rows, droppedRows, skippedFiles } = parseRows(files);
  if (rows.length === 0) {
    throw new Error("No usable PurpleAir rows found. Expected columns time_stamp, sensor_number and pm2.5_cf_1.");
  }

  // Group rows by sensor, tracking last-seen coordinates.
  const bySensor = new Map<string, { rows: RawRow[]; lat: number | null; lon: number | null }>();
  for (const row of rows) {
    let entry = bySensor.get(row.sensorId);
    if (!entry) {
      entry = { rows: [], lat: null, lon: null };
      bySensor.set(row.sensorId, entry);
    }
    entry.rows.push(row);
    if (row.latitude !== null && row.longitude !== null) {
      entry.lat = row.latitude;
      entry.lon = row.longitude;
    }
  }

  const generatedAt = options.generatedAt ?? "1970-01-01T00:00:00Z";
  const series: PatSeries[] = [];
  const records: PasRecord[] = [];
  const sensorsWithoutCoords: string[] = [];
  let pointCount = 0;
  let minTs: string | null = null;
  let maxTs: string | null = null;

  for (const [sensorId, entry] of [...bySensor.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (entry.lat === null || entry.lon === null) {
      sensorsWithoutCoords.push(sensorId);
      continue;
    }
    const label = `PurpleAir ${sensorId}`;
    const sorted = [...entry.rows].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    const points: PatPoint[] = sorted.map((r) => ({
      timestamp: r.timestamp,
      // Single combined value -> both channels identical (documented in warnings).
      pm25A: r.pm25Cf1,
      pm25B: r.pm25Cf1,
      pm25Cf1A: r.pm25Cf1,
      pm25Cf1B: r.pm25Cf1,
      humidity: r.humidity,
      temperature: r.temperature,
      pressure: r.pressure,
    }));
    pointCount += points.length;
    if (points.length) {
      if (minTs === null || points[0].timestamp < minTs) minTs = points[0].timestamp;
      const last = points[points.length - 1].timestamp;
      if (maxTs === null || last > maxTs) maxTs = last;
    }

    series.push({
      meta: { sensorId, label, timezone: "UTC", latitude: entry.lat, longitude: entry.lon },
      points,
    });

    records.push({
      id: sensorId,
      label,
      latitude: entry.lat,
      longitude: entry.lon,
      timezone: "UTC",
      locationType: "outside",
      pm25Current: points.at(-1)?.pm25A ?? null,
      pm25_10min: points.at(-1)?.pm25A ?? null,
      pm25_30min: points.at(-1)?.pm25A ?? null,
      pm25_1hr: points.at(-1)?.pm25A ?? null,
      pm25_6hr: trailingMean(points, 6),
      pm25_1day: trailingMean(points, 24),
      pm25_1week: trailingMean(points, 24 * 7),
      pm25Cf1: points.at(-1)?.pm25A ?? null,
      humidity: lastFinite(points, "humidity"),
      temperature: lastFinite(points, "temperature"),
      pressure: lastFinite(points, "pressure"),
    });
  }

  if (records.length === 0) {
    throw new Error("No sensors with usable coordinates were found in the uploaded files.");
  }

  const collection: PasCollection = { generatedAt, source: "local", records };

  // Network time-lapse: EPA AirNow F&SM (Eq. 1) corrected, daily-bucketed.
  const networkRows: NetworkMeasurementRow[] = rows
    .filter((r) => r.latitude !== null && r.longitude !== null)
    .map((r) => {
      const corrected = applyPurpleAirCorrection({
        pm25: r.pm25Cf1,
        humidity: r.humidity,
        inputBasis: "cf_1",
        profileId: "epa-airnow-fsmap-cf1",
      });
      return {
        sensorId: r.sensorId,
        timestamp: r.timestamp,
        latitude: r.latitude as number,
        longitude: r.longitude as number,
        value: corrected?.pm25Corrected ?? r.pm25Cf1,
        label: `PurpleAir ${r.sensorId}`,
      };
    });
  const network = buildNetworkTimeSeries(networkRows, { bucket: "day", pollutant: "pm2.5", unit: "ug/m3" });

  const warnings: string[] = [
    "These exports carry a single combined PM2.5 per sensor-hour, so A/B channel-agreement diagnostics show identical channels.",
  ];
  if (skippedFiles.length) {
    warnings.push(`Skipped ${skippedFiles.length} file(s) without a recognizable PurpleAir header.`);
  }
  if (droppedRows) {
    warnings.push(`Dropped ${droppedRows} row(s) with a missing timestamp/sensor or an implausible PM2.5 value.`);
  }
  if (sensorsWithoutCoords.length) {
    warnings.push(`Excluded ${sensorsWithoutCoords.length} sensor(s) that never reported coordinates.`);
  }

  return {
    collection,
    series,
    network,
    summary: {
      fileCount: files.length,
      rowCount: rows.length,
      droppedRows,
      sensorCount: records.length,
      pointCount,
      start: minTs,
      end: maxTs,
    },
    warnings,
  };
}
