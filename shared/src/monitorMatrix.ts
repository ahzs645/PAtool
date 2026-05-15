import type { PatSeries } from "./domain";

export type MonitorMatrixMeta = {
  sensorId: string;
  label: string;
  timezone: string;
  latitude?: number;
  longitude?: number;
};

export type MonitorMatrix = {
  meta: MonitorMatrixMeta[];
  timestamps: string[];
  values: Array<Array<number | null>>;
};

function pointPm25(point: PatSeries["points"][number]): number | null {
  const a = point.pm25A;
  const b = point.pm25B;
  if (a === null && b === null) return null;
  if (a === null || a === undefined) return b ?? null;
  if (b === null || b === undefined) return a ?? null;
  return (a + b) / 2;
}

export function buildMonitorMatrix(seriesList: ReadonlyArray<PatSeries>): MonitorMatrix {
  const timestamps = Array.from(new Set(seriesList.flatMap((series) => series.points.map((point) => point.timestamp))))
    .sort();
  const rowByTimestamp = new Map(timestamps.map((timestamp, index) => [timestamp, index]));

  const values = timestamps.map(() => Array<number | null>(seriesList.length).fill(null));
  seriesList.forEach((series, columnIndex) => {
    for (const point of series.points) {
      const rowIndex = rowByTimestamp.get(point.timestamp);
      if (rowIndex === undefined) continue;
      values[rowIndex][columnIndex] = pointPm25(point);
    }
  });

  return {
    meta: seriesList.map((series) => ({ ...series.meta })),
    timestamps,
    values,
  };
}
