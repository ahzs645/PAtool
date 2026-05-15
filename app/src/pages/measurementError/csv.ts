import type { MeasurementPair } from "@patool/shared";

import type { ExampleDataset } from "./examples";

export type CsvRow = Record<string, string>;

export type UploadedMeasurementFile = {
  name: string;
  rows: CsvRow[];
  columns: string[];
};

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === "\"" && quoted && next === "\"") {
      cell += "\"";
      i += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }

  cells.push(cell);
  return cells;
}

export function parseCsv(text: string): CsvRow[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0] ?? "").map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row: CsvRow = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    return row;
  });
}

export async function loadCsv(path: string): Promise<CsvRow[]> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Unable to load ${path}`);
  return parseCsv(await response.text());
}

export async function readUploadedCsv(file: File): Promise<UploadedMeasurementFile> {
  const text = await file.text();
  const rows = parseCsv(text);
  return {
    name: file.name,
    rows,
    columns: Object.keys(rows[0] ?? {}),
  };
}

export function rowsToPairs(rows: CsvRow[], columns: Pick<ExampleDataset, "reference" | "sensor"> & { time?: string }): MeasurementPair[] {
  return rows.map((row) => ({
    time: columns.time ? row[columns.time] : row.Timestamp,
    reference: Number(row[columns.reference]),
    sensor: Number(row[columns.sensor]),
  }));
}

export function inferMeasurementColumns(columns: string[]) {
  const lower = columns.map((column) => column.toLowerCase());
  const time = columns[lower.findIndex((column) => column.includes("time") || column.includes("date"))] ?? columns[0] ?? "";
  const reference = columns[lower.findIndex((column) => column.includes("ref") || column.includes("fidas") || column.includes("bam") || column.includes("t500") || column.includes("49i"))] ?? columns[1] ?? "";
  const sensor = columns.find((column) => column !== time && column !== reference && Number.isNaN(Number(column))) ?? columns[2] ?? reference;

  return { time, reference, sensor };
}
