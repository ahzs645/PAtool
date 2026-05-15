import type { SentinelAggregatedRecord } from "./timeAggregation";

export type SentinelVariableStat = {
  variable: string;
  mean: number | null;
  std: number | null;
  median: number | null;
  max: number | null;
  min: number | null;
  count: number;
  completeness: number;
};

export type SentinelSensorSummary = {
  sensorId: string;
  startTime: string | null;
  endTime: string | null;
  latitude: number | null;
  longitude: number | null;
  count: number;
  qaFlags: string[];
  canisters: string[];
};

export type SentinelCollocationRow = {
  variable: string;
  sensorA: SentinelVariableStat;
  sensorB: SentinelVariableStat;
  meanDelta: number | null;
  medianDelta: number | null;
};

export type SentinelHtmlReportInput = {
  title?: string;
  generatedAt?: string;
  sensorId?: string;
  sensorSummaries: readonly SentinelSensorSummary[];
  qaTable: readonly SentinelVariableStat[];
  collocationTable?: readonly SentinelCollocationRow[];
};

const VARIABLE_ACCESSORS = {
  signal: (record: SentinelAggregatedRecord) => record.signal,
  windSpeed: (record: SentinelAggregatedRecord) => record.windSpeed,
  windDirection: (record: SentinelAggregatedRecord) => record.windDirection,
  temperature: (record: SentinelAggregatedRecord) => record.temperature,
  humidity: (record: SentinelAggregatedRecord) => record.humidity,
} as const;

function round(value: number | null, digits = 3): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function stats(variable: string, values: Array<number | null>, expectedCount: number): SentinelVariableStat {
  const present = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value)).sort((a, b) => a - b);
  if (present.length === 0) {
    return { variable, mean: null, std: null, median: null, max: null, min: null, count: 0, completeness: 0 };
  }
  const mean = present.reduce((sum, value) => sum + value, 0) / present.length;
  const variance = present.length < 2 ? null : present.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (present.length - 1);
  const middle = Math.floor(present.length / 2);
  const median = present.length % 2 === 0 ? (present[middle - 1] + present[middle]) / 2 : present[middle];
  return {
    variable,
    mean: round(mean),
    std: round(variance === null ? null : Math.sqrt(variance)),
    median: round(median),
    max: round(present[present.length - 1]),
    min: round(present[0]),
    count: present.length,
    completeness: round((present.length / Math.max(1, expectedCount)) * 100, 1) ?? 0,
  };
}

export function summarizeSentinelSensors(records: readonly SentinelAggregatedRecord[]): SentinelSensorSummary[] {
  const bySensor = new Map<string, SentinelAggregatedRecord[]>();
  for (const record of records) bySensor.set(record.sensorId, [...(bySensor.get(record.sensorId) ?? []), record]);

  return [...bySensor.entries()].map(([sensorId, rows]) => {
    const sorted = [...rows].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return {
      sensorId,
      startTime: sorted[0]?.timestamp ?? null,
      endTime: sorted[sorted.length - 1]?.timestamp ?? null,
      latitude: sorted.find((row) => row.latitude !== null)?.latitude ?? null,
      longitude: sorted.find((row) => row.longitude !== null)?.longitude ?? null,
      count: sorted.length,
      qaFlags: [...new Set(sorted.flatMap((row) => row.qaFlags))],
      canisters: [...new Set(sorted.map((row) => row.canister).filter((value): value is string => Boolean(value)))],
    };
  });
}

export function buildSentinelQaTable(
  records: readonly SentinelAggregatedRecord[],
  options: { expectedCount?: number } = {},
): SentinelVariableStat[] {
  const expectedCount = options.expectedCount ?? records.length;
  return Object.entries(VARIABLE_ACCESSORS).map(([variable, accessor]) =>
    stats(variable, records.map(accessor), expectedCount),
  );
}

export function buildSentinelCollocationTable(
  sensorARecords: readonly SentinelAggregatedRecord[],
  sensorBRecords: readonly SentinelAggregatedRecord[],
): SentinelCollocationRow[] {
  const expectedCount = Math.max(sensorARecords.length, sensorBRecords.length, 1);
  return Object.keys(VARIABLE_ACCESSORS).map((variable) => {
    const accessor = VARIABLE_ACCESSORS[variable as keyof typeof VARIABLE_ACCESSORS];
    const sensorA = stats(variable, sensorARecords.map(accessor), expectedCount);
    const sensorB = stats(variable, sensorBRecords.map(accessor), expectedCount);
    return {
      variable,
      sensorA,
      sensorB,
      meanDelta: sensorA.mean === null || sensorB.mean === null ? null : round(sensorA.mean - sensorB.mean),
      medianDelta: sensorA.median === null || sensorB.median === null ? null : round(sensorA.median - sensorB.median),
    };
  });
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function display(value: number | string | null | undefined): string {
  if (typeof value === "number") return Number.isFinite(value) ? value.toFixed(2) : "-";
  return value ? String(value) : "-";
}

function table(headers: string[], rows: unknown[][]): string {
  return `<table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(display(cell as string | number | null | undefined))}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

export function renderSentinelQaReportHtml(input: SentinelHtmlReportInput): string {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const summaryRows = input.sensorSummaries.map((summary) => [
    summary.sensorId,
    summary.startTime,
    summary.endTime,
    summary.count,
    summary.qaFlags.join(", ") || "None",
    summary.canisters.join(", ") || "-",
  ]);
  const qaRows = input.qaTable.map((row) => [
    row.variable,
    row.mean,
    row.std,
    row.median,
    row.min,
    row.max,
    row.count,
    `${row.completeness.toFixed(1)}%`,
  ]);
  const collocationRows = (input.collocationTable ?? []).map((row) => [
    row.variable,
    row.sensorA.mean,
    row.sensorB.mean,
    row.meanDelta,
    row.sensorA.median,
    row.sensorB.median,
    row.medianDelta,
  ]);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(input.title ?? "SENTINEL QA report")}</title>
<style>
body{font-family:Inter,Arial,sans-serif;margin:32px;color:#172033;line-height:1.45}
h1{font-size:24px;margin:0 0 4px} h2{font-size:16px;margin:28px 0 10px}
.meta{color:#667085;font-size:13px;margin-bottom:18px}
table{border-collapse:collapse;width:100%;font-size:12px;margin-bottom:18px}
th,td{border:1px solid #d9dee8;padding:7px 8px;text-align:left}
th{background:#f4f6fa;color:#495166}
</style>
</head>
<body>
<h1>${escapeHtml(input.title ?? "SENTINEL QA report")}</h1>
<div class="meta">Generated ${escapeHtml(generatedAt)}${input.sensorId ? ` for ${escapeHtml(input.sensorId)}` : ""}</div>
<h2>Sensor Check Summary</h2>
${table(["Sensor", "Start", "End", "5-min bins", "QA flags", "Canisters"], summaryRows)}
<h2>Single-Node QA Table</h2>
${table(["Variable", "Mean", "SD", "Median", "Min", "Max", "Count", "% Complete"], qaRows)}
${collocationRows.length ? `<h2>Collocated-Node Comparison</h2>${table(["Variable", "A mean", "B mean", "Mean delta", "A median", "B median", "Median delta"], collocationRows)}` : ""}
</body>
</html>`;
}
