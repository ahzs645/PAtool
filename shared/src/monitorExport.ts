import type { MonitorMatrix } from "./monitorMatrix";

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}

function csvRow(values: ReadonlyArray<unknown>): string {
  return values.map(csvCell).join(",");
}

export function monitorMatrixToCsvBundle(matrix: MonitorMatrix): string {
  const lines: string[] = [
    "Metadata",
    csvRow(["column", "sensorId", "label", "timezone", "latitude", "longitude"]),
    ...matrix.meta.map((meta, index) => csvRow([
      index + 1,
      meta.sensorId,
      meta.label,
      meta.timezone,
      meta.latitude ?? "",
      meta.longitude ?? "",
    ])),
    "",
    "Data",
    csvRow(["timestamp", ...matrix.meta.map((meta) => meta.sensorId)]),
    ...matrix.timestamps.map((timestamp, rowIndex) => csvRow([
      timestamp,
      ...matrix.values[rowIndex],
    ])),
  ];

  return `${lines.join("\n")}\n`;
}
