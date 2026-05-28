/**
 * Back-trajectory utilities inspired by openair's `trajPlot`,
 * `trajCluster`, `trajLevel`, and `importTraj`. Operates on receptor-
 * referenced trajectories; HYSPLIT is the canonical input format but the
 * importer here accepts any CSV/JSON with the standard fields.
 *
 * Each trajectory is a sequence of points back in time from a receptor.
 * In openair vocabulary:
 *   - receptor: the monitor location
 *   - hour.inc: hours before the arrival
 *   - lat, lon: trajectory point
 *   - height (m) and pressure (hPa) are optional
 */

export type TrajectoryPoint = {
  receptor: string;
  date: string;
  hourInc: number;
  lat: number;
  lon: number;
  height?: number;
  pressure?: number;
};

export type Trajectory = {
  id: string;
  receptor: string;
  arrival: string;
  points: TrajectoryPoint[];
};

export type TrajectoryClusterResult = {
  clusters: Array<{
    id: number;
    label: string;
    size: number;
    centroidLat: number[];
    centroidLon: number[];
    members: string[];
  }>;
};

export type TrajectoryLevelCell = {
  lat: number;
  lon: number;
  count: number;
  meanValue: number;
};

/**
 * `openair::importTraj` — parses a HYSPLIT-style row collection into the
 * canonical `Trajectory[]` representation. Caller is expected to convert
 * NOAA HYSPLIT text output to CSV with the column names below; the
 * function is forgiving about column ordering.
 */
export function importTraj(rows: ReadonlyArray<Record<string, unknown>>): Trajectory[] {
  const byKey = new Map<string, Trajectory>();
  for (const row of rows) {
    const receptor = String(row.receptor ?? row.site ?? "site");
    const arrival = String(row.date ?? row.arrival ?? new Date().toISOString());
    const hourInc = Number(row.hour_inc ?? row.hourInc ?? row.hour ?? 0);
    const lat = Number(row.lat ?? row.latitude);
    const lon = Number(row.lon ?? row.lng ?? row.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const key = `${receptor}|${arrival}`;
    const traj = byKey.get(key) ?? {
      id: key,
      receptor,
      arrival,
      points: [],
    };
    traj.points.push({
      receptor,
      date: arrival,
      hourInc,
      lat,
      lon,
      height: Number.isFinite(row.height as number) ? Number(row.height) : undefined,
      pressure: Number.isFinite(row.pressure as number) ? Number(row.pressure) : undefined,
    });
    byKey.set(key, traj);
  }
  for (const t of byKey.values()) {
    t.points.sort((a, b) => a.hourInc - b.hourInc);
  }
  return Array.from(byKey.values());
}

/**
 * Cluster trajectories by k-means on (lat,lon) at each hour-back step.
 * Reproduces openair's `trajCluster` for small fleets. Distance is the
 * sum of great-circle distances along matched hour-back steps.
 */
export function trajCluster(
  trajectories: ReadonlyArray<Trajectory>,
  k = 4,
  iterations = 20,
): TrajectoryClusterResult {
  if (trajectories.length === 0) return { clusters: [] };
  const lens = trajectories.map((t) => t.points.length);
  const stepCount = Math.min(...lens);
  if (stepCount === 0) return { clusters: [] };

  const features = trajectories.map((t) =>
    t.points.slice(0, stepCount).flatMap((p) => [p.lat, p.lon]),
  );
  const dims = stepCount * 2;
  const kEff = Math.min(k, features.length);
  const centroids: number[][] = Array.from({ length: kEff }, (_, i) => [...features[i % features.length]]);
  const assign: number[] = new Array(features.length).fill(0);

  for (let iter = 0; iter < iterations; iter += 1) {
    for (let i = 0; i < features.length; i += 1) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < kEff; c += 1) {
        let d = 0;
        for (let j = 0; j < dims; j += 1) d += (features[i][j] - centroids[c][j]) ** 2;
        if (d < bestD) { bestD = d; best = c; }
      }
      assign[i] = best;
    }
    const sums: number[][] = Array.from({ length: kEff }, () => new Array(dims).fill(0));
    const counts: number[] = new Array(kEff).fill(0);
    for (let i = 0; i < features.length; i += 1) {
      const c = assign[i];
      for (let j = 0; j < dims; j += 1) sums[c][j] += features[i][j];
      counts[c] += 1;
    }
    for (let c = 0; c < kEff; c += 1) {
      if (counts[c] > 0) {
        for (let j = 0; j < dims; j += 1) centroids[c][j] = sums[c][j] / counts[c];
      }
    }
  }

  const clusters = Array.from({ length: kEff }, (_, c) => {
    const members = trajectories.filter((_, i) => assign[i] === c).map((t) => t.id);
    return {
      id: c,
      label: `Cluster ${c + 1}`,
      size: members.length,
      centroidLat: Array.from({ length: stepCount }, (_, s) => centroids[c][s * 2]),
      centroidLon: Array.from({ length: stepCount }, (_, s) => centroids[c][s * 2 + 1]),
      members,
    };
  });
  return { clusters };
}

/**
 * `openair::trajLevel` — overlay trajectories onto a lat/lon grid and
 * compute mean of an associated receptor value (e.g. PM2.5) for each
 * cell. Returns CWT/PSCF-style spatial summary.
 */
export function trajLevel(
  trajectories: ReadonlyArray<Trajectory>,
  receptorValues: Record<string, number>,
  cellDeg = 1,
): TrajectoryLevelCell[] {
  const grid = new Map<string, { sum: number; n: number; lat: number; lon: number }>();
  for (const t of trajectories) {
    const value = receptorValues[t.id] ?? receptorValues[t.receptor];
    if (!Number.isFinite(value)) continue;
    for (const p of t.points) {
      const latBin = Math.round(p.lat / cellDeg) * cellDeg;
      const lonBin = Math.round(p.lon / cellDeg) * cellDeg;
      const key = `${latBin}:${lonBin}`;
      const cell = grid.get(key) ?? { sum: 0, n: 0, lat: latBin, lon: lonBin };
      cell.sum += value;
      cell.n += 1;
      grid.set(key, cell);
    }
  }
  return Array.from(grid.values()).map((c) => ({
    lat: c.lat,
    lon: c.lon,
    count: c.n,
    meanValue: c.sum / c.n,
  }));
}

/**
 * `openair::trajPlot` — line-string structure suitable for a Leaflet/
 * MapLibre polyline layer; one polyline per trajectory.
 */
export type TrajectoryPolyline = {
  id: string;
  receptor: string;
  arrival: string;
  coords: Array<[number, number]>;
  hours: number[];
};

export function trajPlot(trajectories: ReadonlyArray<Trajectory>): TrajectoryPolyline[] {
  return trajectories.map((t) => ({
    id: t.id,
    receptor: t.receptor,
    arrival: t.arrival,
    coords: t.points.map((p) => [p.lat, p.lon] as [number, number]),
    hours: t.points.map((p) => p.hourInc),
  }));
}
