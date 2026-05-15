import { distanceMeters, nearestSite, type GeoPoint } from "./geo";
import { linearFit, type LinearFit } from "./measurementError";

export type NeighborMeasurement = GeoPoint & {
  id: string;
  timestamp: string;
  value: number | null;
  flagged?: boolean;
};

export type NeighborComparisonOptions = {
  maxDistanceMeters?: number;
  timeBucket?: "exact" | "hour" | "day";
  includeFlagged?: boolean;
  maxAbsoluteDifference?: number;
  maxSymmetricPercentDifference?: number;
  minRSquared?: number;
};

export type NeighborPair = {
  timestamp: string;
  referenceId: string;
  sensorId: string;
  referenceValue: number;
  sensorValue: number;
  distanceMeters: number;
  referenceLongitude: number;
  referenceLatitude: number;
  sensorLongitude: number;
  sensorLatitude: number;
  flags: string[];
};

export type NeighborPairStatistics = LinearFit & {
  referenceId: string;
  sensorId: string;
  distanceMeters: number;
  nrmse: number | null;
};

const DEFAULT_MAX_DISTANCE_METERS = 5_000;

function timeKey(timestamp: string, bucket: NeighborComparisonOptions["timeBucket"]): string {
  if (bucket === "day") return timestamp.slice(0, 10);
  if (bucket === "hour") return timestamp.slice(0, 13);
  return timestamp;
}

function finiteValue(row: NeighborMeasurement): row is NeighborMeasurement & { value: number } {
  return typeof row.value === "number" && Number.isFinite(row.value);
}

function symmetricPercentDifference(a: number, b: number): number {
  const denominator = Math.abs(a + b);
  return denominator === 0 ? 0 : (200 * Math.abs(a - b)) / denominator;
}

function groupByTime(rows: readonly NeighborMeasurement[], bucket: NeighborComparisonOptions["timeBucket"]): Map<string, Array<NeighborMeasurement & { value: number }>> {
  const groups = new Map<string, Array<NeighborMeasurement & { value: number }>>();
  for (const row of rows) {
    if (!finiteValue(row)) continue;
    const key = timeKey(row.timestamp, bucket);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

export function compareNeighborMeasurements(
  references: readonly NeighborMeasurement[],
  sensors: readonly NeighborMeasurement[],
  options: NeighborComparisonOptions = {},
): NeighborPair[] {
  const maxDistance = options.maxDistanceMeters ?? DEFAULT_MAX_DISTANCE_METERS;
  const bucket = options.timeBucket ?? "hour";
  const referencesByTime = groupByTime(references, bucket);
  const sensorsByTime = groupByTime(sensors, bucket);
  const pairs: NeighborPair[] = [];

  for (const [key, referenceRows] of referencesByTime) {
    const sensorRows = sensorsByTime.get(key) ?? [];
    if (sensorRows.length === 0) continue;
    for (const reference of referenceRows) {
      const nearest = nearestSite(reference, sensorRows);
      if (!nearest || nearest.distanceMeters > maxDistance) continue;
      if (!options.includeFlagged && (reference.flagged || nearest.site.flagged)) continue;

      const flags: string[] = [];
      const absoluteDifference = Math.abs(reference.value - nearest.site.value);
      if (
        typeof options.maxAbsoluteDifference === "number"
        && absoluteDifference > options.maxAbsoluteDifference
      ) {
        flags.push("neighbor-absolute-difference");
      }
      if (
        typeof options.maxSymmetricPercentDifference === "number"
        && symmetricPercentDifference(reference.value, nearest.site.value) > options.maxSymmetricPercentDifference
      ) {
        flags.push("neighbor-percent-difference");
      }

      pairs.push({
        timestamp: key,
        referenceId: reference.id,
        sensorId: nearest.site.id,
        referenceValue: reference.value,
        sensorValue: nearest.site.value,
        distanceMeters: nearest.distanceMeters,
        referenceLongitude: reference.longitude,
        referenceLatitude: reference.latitude,
        sensorLongitude: nearest.site.longitude,
        sensorLatitude: nearest.site.latitude,
        flags,
      });
    }
  }

  if (typeof options.minRSquared === "number") {
    const lowFitKeys = new Set(
      neighborPairStatistics(pairs)
        .filter((row) => row.r2 < options.minRSquared!)
        .map((row) => `${row.referenceId}\u0000${row.sensorId}`),
    );
    for (const pair of pairs) {
      if (lowFitKeys.has(`${pair.referenceId}\u0000${pair.sensorId}`)) {
        pair.flags.push("neighbor-low-r2");
      }
    }
  }

  return pairs.sort((a, b) => a.timestamp.localeCompare(b.timestamp)
    || a.referenceId.localeCompare(b.referenceId)
    || a.sensorId.localeCompare(b.sensorId));
}

export function neighborPairStatistics(pairs: readonly NeighborPair[]): NeighborPairStatistics[] {
  const groups = new Map<string, NeighborPair[]>();
  for (const pair of pairs) {
    const key = `${pair.referenceId}\u0000${pair.sensorId}`;
    const group = groups.get(key);
    if (group) group.push(pair);
    else groups.set(key, [pair]);
  }

  return [...groups.values()]
    .map((group) => {
      const first = group[0];
      const fit = linearFit(group.map((pair) => ({
        reference: pair.referenceValue,
        sensor: pair.sensorValue,
        time: pair.timestamp,
      })));
      const referenceMean = group.reduce((sum, pair) => sum + pair.referenceValue, 0) / group.length;
      return {
        referenceId: first.referenceId,
        sensorId: first.sensorId,
        distanceMeters: distanceMeters(
          { longitude: first.referenceLongitude, latitude: first.referenceLatitude },
          { longitude: first.sensorLongitude, latitude: first.sensorLatitude },
        ),
        ...fit,
        nrmse: referenceMean !== 0 ? (fit.rmse / referenceMean) * 100 : null,
      };
    })
    .sort((a, b) => b.n - a.n || a.referenceId.localeCompare(b.referenceId));
}
