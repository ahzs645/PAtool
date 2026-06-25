import { linearFit } from "./measurementError";
import type { WindDataPoint } from "./wind";

export type DirectionalBin = {
  directionDeg: number;
  label: string;
  count: number;
  frequency: number;
  mean: number;
  median: number;
  max: number;
};

export type PolarAnnulusCell = {
  directionDeg: number;
  speedBin: string;
  hourBin: string;
  count: number;
  mean: number;
};

export type PolarDiffCell = {
  directionDeg: number;
  speedBin: string;
  count: number;
  difference: number;
};

export type TrendPoint = {
  timestamp: string;
  observed: number;
  smooth: number;
};

export type DirectionalCluster = {
  id: string;
  label: string;
  count: number;
  meanDirection: number;
  meanSpeed: number;
  meanPm25: number;
};

const DIRECTION_LABELS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

export function pollutionRose(points: readonly WindDataPoint[], sectors = 16): DirectionalBin[] {
  const bins = Array.from({ length: sectors }, (_, index) => ({
    directionDeg: (index * 360) / sectors,
    label: DIRECTION_LABELS[Math.round((index / sectors) * DIRECTION_LABELS.length) % DIRECTION_LABELS.length],
    values: [] as number[],
  }));
  for (const point of points) {
    if (!valid(point)) continue;
    const index = Math.round(point.windDirection / (360 / sectors)) % sectors;
    bins[index].values.push(point.pm25);
  }
  return bins.map((bin) => summarizeBin(bin, points.length));
}

export function polarFrequency(points: readonly WindDataPoint[], threshold: number): DirectionalBin[] {
  return pollutionRose(points.filter((point) => point.pm25 >= threshold));
}

export function polarAnnulus(points: readonly WindDataPoint[]): PolarAnnulusCell[] {
  return groupedPolarCells(points, speedBin).flatMap((speedCell) => (
    groupedPolarCells(
      points.filter((point) => speedBin(point) === speedCell.group),
      (point) => hourBin(new Date(point.timestamp).getUTCHours()),
    )
      .filter((hourCell) => hourCell.directionDeg === speedCell.directionDeg)
      .map((hourCell) => ({
        directionDeg: speedCell.directionDeg,
        speedBin: speedCell.group,
        hourBin: hourCell.group,
        count: hourCell.count,
        mean: hourCell.mean,
      }))
  ));
}

export function polarDiff(baseline: readonly WindDataPoint[], comparison: readonly WindDataPoint[]): PolarDiffCell[] {
  const base = groupedPolarCells(baseline, speedBin);
  const comp = groupedPolarCells(comparison, speedBin);
  const byKey = new Map(base.map((cell) => [`${cell.directionDeg}:${cell.group}`, cell]));
  return comp.map((cell) => {
    const other = byKey.get(`${cell.directionDeg}:${cell.group}`);
    return {
      directionDeg: cell.directionDeg,
      speedBin: cell.group,
      count: cell.count,
      difference: round(cell.mean - (other?.mean ?? 0)),
    };
  });
}

export function polarCluster(points: readonly WindDataPoint[]): DirectionalCluster[] {
  const quadrants = [
    { id: "upwind", label: "N/E quadrant", min: 315, max: 90 },
    { id: "downwind-east", label: "E/S quadrant", min: 90, max: 180 },
    { id: "downwind-west", label: "S/W quadrant", min: 180, max: 270 },
    { id: "crosswind", label: "W/N quadrant", min: 270, max: 315 },
  ];
  return quadrants.map((quad) => {
    const rows = points.filter((point) => {
      if (!valid(point)) return false;
      return quad.min > quad.max
        ? point.windDirection >= quad.min || point.windDirection < quad.max
        : point.windDirection >= quad.min && point.windDirection < quad.max;
    });
    return {
      id: quad.id,
      label: quad.label,
      count: rows.length,
      meanDirection: round(meanCircular(rows.map((row) => row.windDirection))),
      meanSpeed: round(mean(rows.map((row) => row.windSpeed))),
      meanPm25: round(mean(rows.map((row) => row.pm25))),
    };
  });
}

/**
 * @equation theil-sen
 * @title Theil-Sen robust trend
 * @category Meteorology
 * @latex \hat{\beta} = \mathrm{median}\left\{\dfrac{y_j - y_i}{t_j - t_i} : i < j\right\}, \quad \hat{\alpha} = \mathrm{median}\{y_k - \hat{\beta}\, t_k\}
 * @var y | series value
 * @var t | time (days)
 * @cite Theil 1950; Sen 1968
 */
export function theilSenTrend(points: ReadonlyArray<{ timestamp: string; value: number }>): { slopePerDay: number; intercept: number; n: number } {
  const rows = points
    .map((point) => ({ x: new Date(point.timestamp).getTime() / 86_400_000, y: point.value }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  const slopes: number[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const dx = rows[j].x - rows[i].x;
      if (dx !== 0) slopes.push((rows[j].y - rows[i].y) / dx);
    }
  }
  const slope = median(slopes);
  const intercept = median(rows.map((row) => row.y - slope * row.x));
  return { slopePerDay: round(slope, 6), intercept: round(intercept, 6), n: rows.length };
}

export function smoothTrend(points: ReadonlyArray<{ timestamp: string; value: number }>, window = 7): TrendPoint[] {
  const rows = [...points]
    .filter((point) => Number.isFinite(point.value))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return rows.map((row, index) => {
    const start = Math.max(0, index - Math.floor(window / 2));
    const end = Math.min(rows.length, start + window);
    return {
      timestamp: row.timestamp,
      observed: row.value,
      smooth: round(mean(rows.slice(start, end).map((item) => item.value))),
    };
  });
}

export function directionalModStats(reference: readonly WindDataPoint[], sensor: readonly WindDataPoint[]) {
  const pairs = reference.slice(0, Math.min(reference.length, sensor.length)).map((row, index) => ({
    reference: row.pm25,
    sensor: sensor[index].pm25,
    time: row.timestamp,
  }));
  return linearFit(pairs);
}

function groupedPolarCells(points: readonly WindDataPoint[], groupFn: (point: WindDataPoint) => string) {
  const groups = new Map<string, { directionDeg: number; group: string; values: number[] }>();
  for (const point of points) {
    if (!valid(point)) continue;
    const directionDeg = Math.round(point.windDirection / 30) * 30 % 360;
    const group = groupFn(point);
    const key = `${directionDeg}:${group}`;
    const bucket = groups.get(key) ?? { directionDeg, group, values: [] };
    bucket.values.push(point.pm25);
    groups.set(key, bucket);
  }
  return [...groups.values()].map((bucket) => ({
    directionDeg: bucket.directionDeg,
    group: bucket.group,
    count: bucket.values.length,
    mean: round(mean(bucket.values)),
  }));
}

function summarizeBin(bin: { directionDeg: number; label: string; values: number[] }, total: number): DirectionalBin {
  return {
    directionDeg: bin.directionDeg,
    label: bin.label,
    count: bin.values.length,
    frequency: total ? round(bin.values.length / total, 4) : 0,
    mean: round(mean(bin.values)),
    median: round(median(bin.values)),
    max: bin.values.length ? Math.max(...bin.values) : 0,
  };
}

function speedBin(point: WindDataPoint): string {
  if (point.windSpeed < 2) return "0-2";
  if (point.windSpeed < 4) return "2-4";
  if (point.windSpeed < 6) return "4-6";
  if (point.windSpeed < 10) return "6-10";
  return "10+";
}

function hourBin(hour: number): string {
  if (hour < 6) return "night";
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

function valid(point: WindDataPoint): boolean {
  return Number.isFinite(point.windDirection) && Number.isFinite(point.windSpeed) && Number.isFinite(point.pm25);
}

function mean(values: readonly number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * @equation circular-mean
 * @title Circular mean (wind direction)
 * @category Meteorology
 * @latex \bar{\theta} = \operatorname{atan2}\!\left(\tfrac{1}{n}\sum \sin\theta_i,\ \tfrac{1}{n}\sum \cos\theta_i\right) \bmod 360^{\circ}
 * @var \theta_i | wind direction (degrees)
 * @cite Mardia & Jupp, Directional Statistics
 */
function meanCircular(values: readonly number[]): number {
  if (!values.length) return 0;
  const radians = values.map((value) => (value * Math.PI) / 180);
  const x = mean(radians.map(Math.cos));
  const y = mean(radians.map(Math.sin));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function round(value: number, digits = 3): number {
  return Number(value.toFixed(digits));
}
