/**
 * Browser-only export helpers shared across pages. Centralizes CSV escaping
 * and Blob download plumbing so individual pages don't need to reinvent
 * either every time they want to surface a "Download CSV" or "Save PNG"
 * button.
 */

export type CsvCell = string | number | boolean | null | undefined;
export type CsvRow = ReadonlyArray<CsvCell>;

function escapeCsvCell(cell: CsvCell): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "number") {
    return Number.isFinite(cell) ? String(cell) : "";
  }
  const stringCell = String(cell);
  if (/[",\n\r]/.test(stringCell)) {
    return `"${stringCell.replace(/"/g, '""')}"`;
  }
  return stringCell;
}

export function rowsToCsv(rows: ReadonlyArray<CsvRow>): string {
  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n");
}

export function objectsToCsv<T extends Record<string, CsvCell>>(
  rows: ReadonlyArray<T>,
  columns?: ReadonlyArray<keyof T>,
): string {
  if (rows.length === 0) {
    return columns ? columns.map((column) => escapeCsvCell(String(column))).join(",") : "";
  }
  const cols = columns ?? (Object.keys(rows[0]) as Array<keyof T>);
  const header = cols.map((column) => escapeCsvCell(String(column))).join(",");
  const body = rows.map((row) => cols.map((column) => escapeCsvCell(row[column])).join(","));
  return [header, ...body].join("\n");
}

function timestampSlug(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Append a timestamp before the extension to avoid filename collisions. */
export function suggestFilename(prefix: string, extension: string): string {
  const ext = extension.replace(/^\./, "");
  return `${prefix}-${timestampSlug()}.${ext}`;
}

function triggerDownload(href: string, filename: string): void {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

export function downloadCsv(filename: string, csv: string): void {
  // Lead with a UTF-8 BOM so Excel recognizes accented characters in
  // sensor labels and study-area names.
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    triggerDownload(url, filename);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function downloadJson(filename: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  try {
    triggerDownload(url, filename);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Save a canvas snapshot as PNG. Useful for "screenshot" buttons on chart
 * pages — pass the canvas the chart library renders to (ECharts exposes
 * `getDataURL()` separately; this helper covers MapLibre's `getCanvas()`
 * and any plain HTML canvas).
 */
export function downloadCanvasPng(filename: string, canvas: HTMLCanvasElement): Promise<void> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Canvas did not produce a PNG blob"));
        return;
      }
      const url = URL.createObjectURL(blob);
      try {
        triggerDownload(url, filename);
        resolve();
      } finally {
        URL.revokeObjectURL(url);
      }
    }, "image/png");
  });
}

export function downloadDataUrl(filename: string, dataUrl: string): void {
  triggerDownload(dataUrl, filename);
}
