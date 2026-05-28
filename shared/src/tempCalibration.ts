/**
 * Temperature-corrected dual-variable calibration ported from ASNAT's
 * temperature-corrected scatter / AQI engine.
 *
 * Fits a polynomial (or simple GAM-like additive) model that predicts
 * reference PM₂.₅ from sensor PM₂.₅ and a second variable, typically
 * temperature. Three orders supported: linear, quadratic, cubic. Each
 * order is fit via ordinary least squares on the design matrix [1, x, T,
 * x², T², xT, x³, T³, x²T, xT²] (truncated to the selected order).
 *
 * No external math libraries; the normal-equations solve uses a small
 * Gauss-Jordan elimination — fine for 4–10 features.
 */

export type TempCalibrationOrder = "linear" | "quadratic" | "cubic";

export type TempCalibrationFit = {
  order: TempCalibrationOrder;
  coefficients: number[];
  featureNames: string[];
  r2: number;
  rmse: number;
  residuals: number[];
  /** Predict a single (sensor, temperature) pair. */
  predict: (sensor: number, temp: number) => number;
};

export type TempCalibrationRow = {
  sensor: number;
  temperature: number;
  reference: number;
};

function designRow(order: TempCalibrationOrder, x: number, t: number): { row: number[]; names: string[] } {
  const row = [1, x, t];
  const names = ["intercept", "sensor", "temp"];
  if (order === "quadratic" || order === "cubic") {
    row.push(x * x, t * t, x * t);
    names.push("sensor²", "temp²", "sensor·temp");
  }
  if (order === "cubic") {
    row.push(x * x * x, t * t * t, x * x * t, x * t * t);
    names.push("sensor³", "temp³", "sensor²·temp", "sensor·temp²");
  }
  return { row, names };
}

export function fitTempCalibration(
  rows: ReadonlyArray<TempCalibrationRow>,
  order: TempCalibrationOrder = "linear",
): TempCalibrationFit {
  const usable = rows.filter(
    (r) => Number.isFinite(r.sensor) && Number.isFinite(r.temperature) && Number.isFinite(r.reference),
  );
  if (usable.length === 0) {
    return emptyFit(order);
  }
  const { row: rowExample, names } = designRow(order, 0, 0);
  const k = rowExample.length;
  const xt: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
  const xty: number[] = new Array(k).fill(0);
  for (const r of usable) {
    const { row } = designRow(order, r.sensor, r.temperature);
    for (let i = 0; i < k; i += 1) {
      xty[i] += row[i] * r.reference;
      for (let j = 0; j < k; j += 1) xt[i][j] += row[i] * row[j];
    }
  }
  const coeff = solveLinear(xt, xty);
  const meanY = usable.reduce((s, r) => s + r.reference, 0) / usable.length;
  let ssRes = 0;
  let ssTot = 0;
  const residuals: number[] = [];
  for (const r of usable) {
    const { row } = designRow(order, r.sensor, r.temperature);
    const pred = row.reduce((s, v, i) => s + v * coeff[i], 0);
    const e = r.reference - pred;
    residuals.push(e);
    ssRes += e * e;
    ssTot += (r.reference - meanY) ** 2;
  }
  return {
    order,
    coefficients: coeff,
    featureNames: names,
    r2: ssTot === 0 ? 1 : 1 - ssRes / ssTot,
    rmse: Math.sqrt(ssRes / usable.length),
    residuals,
    predict(sensor: number, temp: number) {
      const { row } = designRow(order, sensor, temp);
      return row.reduce((s, v, i) => s + v * coeff[i], 0);
    },
  };
}

function solveLinear(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m: number[][] = a.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i += 1) {
    let pivot = i;
    for (let k = i + 1; k < n; k += 1) {
      if (Math.abs(m[k][i]) > Math.abs(m[pivot][i])) pivot = k;
    }
    [m[i], m[pivot]] = [m[pivot], m[i]];
    const p = m[i][i] || 1e-12;
    for (let k = i; k <= n; k += 1) m[i][k] /= p;
    for (let k = 0; k < n; k += 1) {
      if (k === i) continue;
      const factor = m[k][i];
      for (let j = i; j <= n; j += 1) m[k][j] -= factor * m[i][j];
    }
  }
  return m.map((row) => row[n]);
}

function emptyFit(order: TempCalibrationOrder): TempCalibrationFit {
  const k = order === "linear" ? 3 : order === "quadratic" ? 6 : 10;
  const names = designRow(order, 0, 0).names;
  return {
    order,
    coefficients: new Array(k).fill(0),
    featureNames: names,
    r2: 0,
    rmse: 0,
    residuals: [],
    predict: () => 0,
  };
}
