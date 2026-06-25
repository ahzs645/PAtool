/**
 * Typed adapter scaffolds for AirMonitor-style multi-source ingest.
 *
 * Each loader returns a uniform `MtsMonitor` shape. Concrete HTTP
 * fetchers are injected so worker code (Cloudflare Worker, Node, browser)
 * can plug in its own networking. The function bodies handle the parse,
 * normalisation, and validation steps shared across all sources.
 *
 * Sources implemented:
 *   - AIRSIS (mobile/temporary smoke monitors used by USFS)
 *   - WRCC   (Western Regional Climate Center temporary monitors)
 *   - AirNow (EPA real-time regulatory monitors)
 *   - EPA AQS (annual historical regulatory monitors)
 *   - Clarity-via-OpenAQ
 *
 * Each loader accepts a `fetcher: (url) => Promise<string>` and a
 * `parseCsv` hook so the same code runs in the worker and in tests.
 */

import type { MonitorMeta, MtsMonitor } from "./monitorPipeline";

export type MonitorRowFetcher = (url: string) => Promise<string>;

export type MonitorLoadOptions = {
  fetcher: MonitorRowFetcher;
  parseCsv?: (text: string) => Array<Record<string, string>>;
};

export type AirsisLoadInput = MonitorLoadOptions & {
  year: number;
  unitId?: string;
  baseUrl?: string;
};

export type WrccLoadInput = MonitorLoadOptions & {
  year: number;
  station: string;
  baseUrl?: string;
};

export type AirnowLoadInput = MonitorLoadOptions & {
  date: string; // ISO date
  baseUrl?: string;
};

/**
 * AQS PM2.5 parameter codes the user can choose between (Barkjohn et al. 2025):
 *   88101 FEM/FRM regulatory PM2.5 (used for NAAQS attainment)
 *   88500 total atmospheric PM2.5
 *   88501 PM2.5 raw data
 *   88502 acceptable PM2.5 AQI & speciation mass
 */
export const AQS_PM25_PARAMETER_CODES = [
  { code: "88101", label: "FEM/FRM regulatory (88101)" },
  { code: "88500", label: "Total atmospheric (88500)" },
  { code: "88501", label: "Raw data (88501)" },
  { code: "88502", label: "AQI & speciation mass (88502)" },
] as const;

export type AqsPm25ParameterCode = (typeof AQS_PM25_PARAMETER_CODES)[number]["code"];

export type EpaAqsLoadInput = MonitorLoadOptions & {
  year: number;
  parameter: "pm25" | "pm10" | "ozone" | "no2" | "co" | "so2";
  /** AQS PM2.5 parameter code (88101/88500/88501/88502); only used when parameter === "pm25". */
  pm25ParameterCode?: AqsPm25ParameterCode;
  baseUrl?: string;
};

export type ClarityLoadInput = MonitorLoadOptions & {
  countryCode?: string;
  baseUrl?: string;
};

const AIRSIS_BASE = "https://airfire-data-exports.s3.amazonaws.com/monitoring/v2";
const WRCC_BASE = "https://wrcc.dri.edu/cgi-bin/wea_daysum.pl";
const AIRNOW_BASE = "https://files.airnowtech.org/airnow";
const EPA_AQS_BASE = "https://aqs.epa.gov/aqsweb/airdata";
const CLARITY_BASE = "https://api.openaq.org/v3";

function defaultParseCsv(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cols = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = cols[i] ?? ""; });
    return row;
  });
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') { current += '"'; i += 1; continue; }
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === "," && !inQ) { out.push(current); current = ""; continue; }
    current += ch;
  }
  out.push(current);
  return out;
}

function intoMonitor(rows: Array<Record<string, string>>, meta: MonitorMeta): MtsMonitor {
  const datetime: string[] = [];
  const values: Array<number | null> = [];
  for (const row of rows) {
    const ts = row.timestamp ?? row.datetime ?? row.UTC ?? row.date ?? row.GMT;
    if (!ts) continue;
    // Empty CSV cells must become null, not 0 — Number("") returns 0, which
    // would silently turn missing observations into bogus zero readings.
    const raw = row.pm25 ?? row.PM25 ?? row.value ?? row.ConcRaw ?? row.Concentration;
    const val = raw === undefined || raw === null || raw.trim() === "" ? NaN : Number(raw);
    datetime.push(new Date(ts).toISOString());
    values.push(Number.isFinite(val) ? val : null);
  }
  return {
    meta: [meta],
    data: { datetime, data: { [meta.id]: values } },
  };
}

/** R: `airsis_loadAnnual()` */
export async function airsisLoadAnnual(input: AirsisLoadInput): Promise<MtsMonitor> {
  const parse = input.parseCsv ?? defaultParseCsv;
  const base = input.baseUrl ?? AIRSIS_BASE;
  const unit = input.unitId ?? "all";
  const url = `${base}/airsis_${unit}_${input.year}.csv`;
  const text = await input.fetcher(url);
  const rows = parse(text);
  return intoMonitor(rows, {
    id: `airsis-${unit}-${input.year}`,
    label: `AIRSIS ${unit}`,
    parameter: "pm25",
    units: "ug/m3",
    agencyName: "USFS AirFire AIRSIS archive",
  });
}

/** R: `wrcc_loadAnnual()` */
export async function wrccLoadAnnual(input: WrccLoadInput): Promise<MtsMonitor> {
  const parse = input.parseCsv ?? defaultParseCsv;
  const base = input.baseUrl ?? WRCC_BASE;
  const url = `${base}?stn=${input.station}&yr=${input.year}`;
  const text = await input.fetcher(url);
  const rows = parse(text);
  return intoMonitor(rows, {
    id: `wrcc-${input.station}-${input.year}`,
    label: `WRCC ${input.station}`,
    parameter: "pm25",
    units: "ug/m3",
    agencyName: "Western Regional Climate Center",
  });
}

/** R: `airnow_loadDaily()` */
export async function airnowLoadDaily(input: AirnowLoadInput): Promise<MtsMonitor> {
  const parse = input.parseCsv ?? defaultParseCsv;
  const base = input.baseUrl ?? AIRNOW_BASE;
  const day = input.date.replace(/-/g, "");
  const url = `${base}/${day.slice(0, 4)}/${day}/HourlyData_${day}.dat`;
  const text = await input.fetcher(url);
  const rows = parse(text);
  return intoMonitor(rows, {
    id: `airnow-${input.date}`,
    label: `AirNow ${input.date}`,
    parameter: "pm25",
    units: "ug/m3",
    agencyName: "AirNow / US EPA",
  });
}

/** R: `epa_aqs_loadAnnual()` */
export async function epaAqsLoadAnnual(input: EpaAqsLoadInput): Promise<MtsMonitor> {
  const parse = input.parseCsv ?? defaultParseCsv;
  const base = input.baseUrl ?? EPA_AQS_BASE;
  const code = input.parameter === "pm25" ? input.pm25ParameterCode ?? "88101" : undefined;
  const suffix = code ? `-${code}` : "";
  const url = `${base}/hourly_${input.parameter}${code ? `_${code}` : ""}_${input.year}.zip`;
  const text = await input.fetcher(url);
  const rows = parse(text);
  return intoMonitor(rows, {
    id: `epa-aqs-${input.parameter}${suffix}-${input.year}`,
    label: `EPA AQS ${input.parameter}${code ? ` ${code}` : ""} ${input.year}`,
    parameter: input.parameter,
    units: input.parameter === "ozone" ? "ppm" : "ug/m3",
    agencyName: "US EPA AQS",
  });
}

/** R: `clarity_loadLatest()` (via OpenAQ v3 measurements). */
export async function clarityLoadLatest(input: ClarityLoadInput): Promise<MtsMonitor> {
  const parse = input.parseCsv ?? defaultParseCsv;
  const base = input.baseUrl ?? CLARITY_BASE;
  const url = `${base}/measurements?parameter=pm25&provider=clarity${input.countryCode ? `&country=${input.countryCode}` : ""}`;
  const text = await input.fetcher(url);
  let rows: Array<Record<string, string>>;
  try {
    const json = JSON.parse(text) as { results?: Array<Record<string, string>> };
    rows = (json.results ?? []).map((r) => ({
      timestamp: String((r as Record<string, unknown>).datetime ?? ""),
      pm25: String((r as Record<string, unknown>).value ?? ""),
    }));
  } catch {
    rows = parse(text);
  }
  return intoMonitor(rows, {
    id: `clarity-${input.countryCode ?? "global"}`,
    label: `Clarity ${input.countryCode ?? "global"}`,
    parameter: "pm25",
    units: "ug/m3",
    agencyName: "Clarity (via OpenAQ)",
  });
}

export const LOADER_REGISTRY = {
  airsis: airsisLoadAnnual,
  wrcc: wrccLoadAnnual,
  airnow: airnowLoadDaily,
  epaAqs: epaAqsLoadAnnual,
  clarity: clarityLoadLatest,
} as const;
