import type { MeasurementRow } from "./standardAggregation";

export type StandardTableParseResult = {
  rows: MeasurementRow[];
  warnings: string[];
  columns: string[];
};

export type StandardTableOptions = {
  delimiter?: string;
  valueColumn?: string;
};

function splitLine(line: string, delimiter: string): string[] {
  return line.split(delimiter).map((value) => value.trim());
}

function columnIndex(columns: readonly string[], candidates: readonly string[]): number {
  const lower = columns.map((column) => column.toLowerCase());
  for (const candidate of candidates) {
    const index = lower.indexOf(candidate.toLowerCase());
    if (index >= 0) return index;
  }
  return -1;
}

function parseNumber(value: string): number | null {
  if (value === "" || value.toUpperCase() === "NA" || value.toUpperCase() === "NAN") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseStandardMeasurementTable(
  text: string,
  options: StandardTableOptions = {},
): StandardTableParseResult {
  const delimiter = options.delimiter ?? (text.includes("\t") ? "\t" : ",");
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0 && !line.startsWith("#"));
  const headerIndex = lines.findIndex((line) => line.toLowerCase().includes("timestamp"));
  if (headerIndex < 0) {
    return { rows: [], warnings: ["No timestamp header found."], columns: [] };
  }

  const columns = splitLine(lines[headerIndex], delimiter);
  const timestampIndex = columnIndex(columns, ["timestamp(UTC)", "timestamp", "time"]);
  const idIndex = columnIndex(columns, ["id(-)", "id", "site_id"]);
  const longitudeIndex = columnIndex(columns, ["longitude(deg)", "longitude", "lon"]);
  const latitudeIndex = columnIndex(columns, ["latitude(deg)", "latitude", "lat"]);
  const flaggedIndex = columnIndex(columns, ["flagged(-)", "flagged", "flag"]);
  const valueIndex = options.valueColumn
    ? columnIndex(columns, [options.valueColumn])
    : columns.findIndex((column, index) => (
      index !== timestampIndex
      && index !== idIndex
      && index !== longitudeIndex
      && index !== latitudeIndex
      && index !== flaggedIndex
      && !["note(-)", "note", "elevation(m)", "count(-)"].includes(column.toLowerCase())
    ));

  const warnings: string[] = [];
  if (timestampIndex < 0) warnings.push("Missing timestamp column.");
  if (idIndex < 0) warnings.push("Missing id column.");
  if (valueIndex < 0) warnings.push("Missing value column.");
  if (warnings.length > 0) return { rows: [], warnings, columns };

  const rows: MeasurementRow[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    const cells = splitLine(line, delimiter);
    const timestamp = cells[timestampIndex];
    const id = cells[idIndex];
    if (!timestamp || !id) {
      warnings.push(`Skipped row with missing timestamp or id: ${line.slice(0, 80)}`);
      continue;
    }
    const longitude = longitudeIndex >= 0 ? parseNumber(cells[longitudeIndex]) : null;
    const latitude = latitudeIndex >= 0 ? parseNumber(cells[latitudeIndex]) : null;
    rows.push({
      id,
      timestamp,
      value: parseNumber(cells[valueIndex]),
      longitude: longitude ?? undefined,
      latitude: latitude ?? undefined,
      flagged: flaggedIndex >= 0 ? cells[flaggedIndex] !== "0" && cells[flaggedIndex] !== "" : false,
    });
  }

  rows.sort((a, b) => a.id.localeCompare(b.id) || a.timestamp.localeCompare(b.timestamp));
  return { rows, warnings, columns };
}
