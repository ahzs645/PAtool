import type { MobileSensingPoint, PasCollection, PasRecord, PatSeries, ReferenceMonitor, ReferenceObservation } from "@patool/shared";

export function pasCollectionToReferenceMonitors(collection: PasCollection): ReferenceMonitor[] {
  return collection.records
    .filter(hasUsableLocation)
    .flatMap((record): ReferenceMonitor[] => {
      const pm25 = pm25FromPas(record);
      if (pm25 === null) return [];
      return [{
        id: record.id,
        name: record.label || `Sensor ${record.id}`,
        latitude: record.latitude,
        longitude: record.longitude,
        source: collection.source === "live" ? "Live network" : `${collection.source} network`,
        pm25,
      }];
    })
    .sort((a, b) => (b.pm25 ?? -Infinity) - (a.pm25 ?? -Infinity));
}

export function patSeriesToReferenceObservations(series: PatSeries): ReferenceObservation[] {
  return series.points.flatMap((point): ReferenceObservation[] => {
    const pm25 = meanPm25(point.pm25A, point.pm25B);
    if (pm25 === null) return [];
    return [{ timestamp: point.timestamp, pm25, monitorId: series.meta.sensorId }];
  });
}

export function buildSnapshotReferenceObservations(
  points: ReadonlyArray<MobileSensingPoint>,
  monitor: ReferenceMonitor | null,
): ReferenceObservation[] {
  if (!monitor || typeof monitor.pm25 !== "number" || !Number.isFinite(monitor.pm25)) return [];
  const monitorPm25 = monitor.pm25;
  const buckets = new Set(points.map((point) => point.timestamp.slice(0, 13)));
  return [...buckets].sort().map((bucket, index) => ({
    timestamp: `${bucket}:00:00.000Z`,
    monitorId: monitor.id,
    pm25: Math.max(0, monitorPm25 + Math.sin(index * 1.7) * Math.max(1, monitorPm25 * 0.08)),
  }));
}

export function hasTemporalOverlap(
  points: ReadonlyArray<MobileSensingPoint>,
  observations: ReadonlyArray<ReferenceObservation>,
): boolean {
  if (!points.length || !observations.length) return false;
  const pointBuckets = new Set(points.map((point) => point.timestamp.slice(0, 13)));
  return observations.some((observation) => pointBuckets.has(observation.timestamp.slice(0, 13)));
}

function hasUsableLocation(record: PasRecord): boolean {
  return Number.isFinite(record.latitude)
    && Number.isFinite(record.longitude)
    && record.locationType !== "inside";
}

function pm25FromPas(record: PasRecord): number | null {
  return numeric(record.pm25_1hr)
    ?? numeric(record.pm25Current)
    ?? numeric(record.pm25_1day)
    ?? numeric(record.pm25_10min)
    ?? null;
}

function meanPm25(a: number | null, b: number | null): number | null {
  if (a !== null && b !== null) return (a + b) / 2;
  return a ?? b;
}

function numeric(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
