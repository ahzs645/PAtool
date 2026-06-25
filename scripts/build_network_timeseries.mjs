#!/usr/bin/env node
/**
 * Build a NetworkTimeSeries fixture (shared/src/networkTimeSeries.ts) from a
 * directory of PurpleAir daily/hourly export CSVs. Each CSV row carries a
 * timestamp, sensor_number, latitude, longitude and pm2.5_cf_1 (+ humidity);
 * rows are EPA AirNow Fire & Smoke Map (Equation 1) corrected, bucketed to the
 * requested interval, then pivoted onto a shared timestamp axis.
 *
 * Usage: node scripts/build_network_timeseries.mjs <inputDir> <outputJson> [day|hour]
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const [inputDir, outputPath, bucketArg] = process.argv.slice(2);
if (!inputDir || !outputPath) {
  console.error("Usage: build_network_timeseries.mjs <inputDir> <outputJson> [day|hour]");
  process.exit(1);
}
const bucket = bucketArg === "hour" ? "hour" : "day";

// EPA AirNow Fire & Smoke Map US-wide correction (Equation 1), ported from
// shared/src/domain.ts so this script stays dependency-free.
function airnowFsmap(pa, rh) {
  const h = Number.isFinite(rh) ? rh : 0;
  if (pa < 30) return Math.max(0, 0.524 * pa - 0.0862 * h + 5.75);
  if (pa < 50) { const f = pa / 20 - 3 / 2; const s = 0.786 * f + 0.524 * (1 - f); return Math.max(0, s * pa - 0.0862 * h + 5.75); }
  if (pa < 210) return Math.max(0, 0.786 * pa - 0.0862 * h + 5.75);
  if (pa < 260) { const f = pa / 50 - 21 / 5; const s = 0.69 * f + 0.786 * (1 - f); return Math.max(0, s * pa - 0.0862 * h * (1 - f) + 2.966 * f + 5.75 * (1 - f) + 8.84e-4 * pa ** 2 * f); }
  return Math.max(0, 2.966 + 0.69 * pa + 8.84e-4 * pa ** 2);
}

function splitCsvLine(line) {
  const out = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 1; continue; }
    if (c === '"') { q = !q; continue; }
    if (c === "," && !q) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

function bucketTimestamp(ts) {
  const t = Date.parse(ts.replace(" ", "T"));
  if (Number.isNaN(t)) return null;
  const iso = new Date(t).toISOString();
  return bucket === "hour" ? `${iso.slice(0, 13)}:00:00Z` : `${iso.slice(0, 10)}T00:00:00Z`;
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (entry.toLowerCase().endsWith(".csv")) yield p;
  }
}

const timestampSet = new Set();
const sites = new Map(); // id -> { lat, lon, sums: Map<ts, {sum,count}> }
let rowCount = 0;

for (const file of walk(inputDir)) {
  const text = readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) continue;
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const col = (name) => header.indexOf(name);
  const iTs = col("time_stamp");
  const iSn = col("sensor_number");
  const iLat = col("latitude");
  const iLon = col("longitude");
  const iPm = col("pm2.5_cf_1");
  const iRh = col("humidity");
  if (iTs < 0 || iSn < 0 || iPm < 0) continue;
  for (let li = 1; li < lines.length; li += 1) {
    const cells = splitCsvLine(lines[li]);
    const ts = bucketTimestamp(cells[iTs] ?? "");
    const sn = (cells[iSn] ?? "").trim();
    const lat = Number(cells[iLat]);
    const lon = Number(cells[iLon]);
    const pm = Number(cells[iPm]);
    const rh = iRh >= 0 ? Number(cells[iRh]) : NaN;
    if (!ts || !sn || !Number.isFinite(pm)) continue;
    if (pm < 0 || pm > 2000) continue; // drop implausible CF=1 readings (sensor faults)
    timestampSet.add(ts);
    let site = sites.get(sn);
    if (!site) { site = { lat: NaN, lon: NaN, sums: new Map() }; sites.set(sn, site); }
    if (Number.isFinite(lat) && Number.isFinite(lon)) { site.lat = lat; site.lon = lon; }
    const corrected = airnowFsmap(pm, rh);
    const cell = site.sums.get(ts) ?? { sum: 0, count: 0 };
    cell.sum += corrected; cell.count += 1; site.sums.set(ts, cell);
    rowCount += 1;
  }
}

const timestamps = [...timestampSet].sort((a, b) => Date.parse(a) - Date.parse(b));
const indexOf = new Map(timestamps.map((ts, i) => [ts, i]));
const siteList = [...sites.entries()]
  .filter(([, s]) => Number.isFinite(s.lat) && Number.isFinite(s.lon))
  .map(([id, s]) => {
    const values = new Array(timestamps.length).fill(null);
    for (const [ts, cell] of s.sums) {
      const i = indexOf.get(ts);
      if (i !== undefined && cell.count > 0) values[i] = Number((cell.sum / cell.count).toFixed(1));
    }
    return { id, label: `PurpleAir ${id}`, latitude: Number(s.lat.toFixed(5)), longitude: Number(s.lon.toFixed(5)), values };
  })
  .sort((a, b) => a.id.localeCompare(b.id));

const out = { pollutant: "pm2.5", unit: "ug/m3", source: "PurpleAir network (EPA AirNow F&SM corrected)", timestamps, sites: siteList };
writeFileSync(outputPath, JSON.stringify(out));
console.log(`Read ${rowCount} rows -> ${siteList.length} sites x ${timestamps.length} timestamps`);
console.log(`Wrote ${outputPath} (${(statSync(outputPath).size / 1024).toFixed(0)} KB)`);
