import type { AirFuseLayerConfig, ValidationResult } from "./types";

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (quoted && next === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
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
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

export function finiteNumber(value: string | undefined): number | null {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function calculateValidation(rows: string[][], layer: AirFuseLayerConfig): ValidationResult | null {
  if (!layer.observedColumn || !layer.predictedColumn || rows.length < 2) return null;

  const header = rows[0];
  const observedIndex = header.indexOf(layer.observedColumn);
  const predictedIndex = header.indexOf(layer.predictedColumn);
  if (observedIndex === -1 || predictedIndex === -1) return null;

  const allPoints: Array<[number, number]> = [];
  let sq = 0;
  let abs = 0;
  let bias = 0;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  let sumY2 = 0;
  let maxAxis = 1;

  for (const row of rows.slice(1)) {
    const observed = finiteNumber(row[observedIndex]);
    const predicted = finiteNumber(row[predictedIndex]);
    if (observed === null || predicted === null) continue;

    const error = predicted - observed;
    allPoints.push([observed, predicted]);
    sq += error * error;
    abs += Math.abs(error);
    bias += error;
    sumX += observed;
    sumY += predicted;
    sumXY += observed * predicted;
    sumX2 += observed * observed;
    sumY2 += predicted * predicted;
    maxAxis = Math.max(maxAxis, observed, predicted);
  }

  const n = allPoints.length;
  if (!n) return null;

  const denominator = n * sumX2 - sumX * sumX;
  const slope = denominator === 0 ? 0 : (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;
  const rDenominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  const r = rDenominator === 0 ? 0 : (n * sumXY - sumX * sumY) / rDenominator;
  const stride = Math.max(1, Math.ceil(allPoints.length / 2500));

  return {
    observedColumn: layer.observedColumn,
    predictedColumn: layer.predictedColumn,
    n,
    rmse: Math.sqrt(sq / n),
    mae: abs / n,
    bias: bias / n,
    r,
    slope,
    intercept,
    maxAxis: Math.ceil(maxAxis * 1.05),
    points: allPoints.filter((_, index) => index % stride === 0),
  };
}
