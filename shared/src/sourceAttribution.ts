import type { SentinelAggregatedRecord } from "./timeAggregation";

export type SourceDirectionStatistic = "mean" | "median" | "max" | "frequency";

export type SourceDirectionBin = {
  direction: string;
  directionDeg: number;
  speedBin: string;
  count: number;
  value: number;
};

const DIRECTIONS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const SPEED_BINS = [
  { label: "0-1", min: 0, max: 1 },
  { label: "1-2", min: 1, max: 2 },
  { label: "2-4", min: 2, max: 4 },
  { label: "4-6", min: 4, max: 6 },
  { label: "6+", min: 6, max: Infinity },
];

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function valueFor(values: number[], statistic: SourceDirectionStatistic): number {
  if (statistic === "frequency") return values.length;
  if (!values.length) return 0;
  if (statistic === "max") return Math.max(...values);
  if (statistic === "median") return median(values) ?? 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function buildSourceDirectionBins(
  records: readonly SentinelAggregatedRecord[],
  options: { statistic?: SourceDirectionStatistic; minWindSpeed?: number; maxWindSpeed?: number } = {},
): SourceDirectionBin[] {
  const statistic = options.statistic ?? "median";
  const sectorSize = 360 / DIRECTIONS.length;
  const buckets = new Map<string, number[]>();

  for (const record of records) {
    if (record.windDirection === null || record.windSpeed === null || record.signal === null) continue;
    const windSpeed = record.windSpeed;
    const windDirection = record.windDirection;
    const signal = record.signal;
    if (options.minWindSpeed !== undefined && windSpeed < options.minWindSpeed) continue;
    if (options.maxWindSpeed !== undefined && windSpeed > options.maxWindSpeed) continue;
    const directionIndex = Math.round(windDirection / sectorSize) % DIRECTIONS.length;
    const speedBin = SPEED_BINS.find((bin) => windSpeed >= bin.min && windSpeed < bin.max);
    if (!speedBin) continue;
    const key = `${directionIndex}::${speedBin.label}`;
    buckets.set(key, [...(buckets.get(key) ?? []), signal]);
  }

  const result: SourceDirectionBin[] = [];
  DIRECTIONS.forEach((direction, directionIndex) => {
    SPEED_BINS.forEach((speedBin) => {
      const values = buckets.get(`${directionIndex}::${speedBin.label}`) ?? [];
      result.push({
        direction,
        directionDeg: directionIndex * sectorSize,
        speedBin: speedBin.label,
        count: values.length,
        value: Number(valueFor(values, statistic).toFixed(3)),
      });
    });
  });
  return result;
}
