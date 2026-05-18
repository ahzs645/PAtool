// ---------------------------------------------------------------------------
// hysplitTrajectory — pure-TS analogue of the openair trajectory suite:
//   - parseHysplitTdump    : parser for HYSPLIT `tdump` back-trajectory text
//   - clusterTrajectories  : k-means on great-circle distances of resampled
//                            trajectory points (trajCluster analogue)
//   - trajectoryLevel      : bin a pollutant time-series by trajectory
//                            passage through a lat/lon grid (trajLevel)
//
// The HYSPLIT tdump format ships with one header section (run metadata,
// vertical-motion flag, starting locations) followed by one trajectory row
// per timestep with fields:
//   traj-num grid-num year month day hour minute fc-hour age-hour lat lon
//   height pressure [optional diagnostic columns…]
// We parse the canonical 12 columns plus any diagnostics, ignoring the
// header.
// ---------------------------------------------------------------------------

export type TrajectoryPoint = {
  trajectoryId: number;
  ageHours: number;
  timestamp: string;     // ISO UTC
  latitude: number;
  longitude: number;
  height: number;        // metres AGL
  pressure?: number;
};

export type HysplitTrajectory = {
  id: number;
  startTimestamp: string;
  startLatitude: number;
  startLongitude: number;
  points: TrajectoryPoint[];
};

export function parseHysplitTdump(text: string): HysplitTrajectory[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length === 0) return [];

  // Header parsing — we just want to skip until we reach the start-locations
  // marker.  The first numeric line tells us how many grid records to skip,
  // and the line preceding the "PRESSURE" or "AIR_TEMP" trajectory keyword
  // gives the count of starting locations.
  let cursor = 0;
  while (cursor < lines.length) {
    const tokens = lines[cursor].split(/\s+/);
    if (tokens.length >= 1 && /^\d+$/.test(tokens[0])) {
      cursor += 1;
      const gridCount = Number(tokens[0]);
      cursor += gridCount;          // skip grid records
      break;
    }
    cursor += 1;
  }
  // Trajectory start-block: header gives starting-location count, then that
  // many starting-location lines, then the diagnostic-variable header.
  if (cursor >= lines.length) return [];
  const startCountTokens = lines[cursor].split(/\s+/);
  const startCount = Number(startCountTokens[0]) || 1;
  cursor += 1;
  const starts: Array<{ year: number; month: number; day: number; hour: number; lat: number; lon: number; alt: number }> = [];
  for (let i = 0; i < startCount && cursor < lines.length; i += 1, cursor += 1) {
    const t = lines[cursor].split(/\s+/);
    starts.push({
      year: 2000 + Number(t[0]),
      month: Number(t[1]),
      day: Number(t[2]),
      hour: Number(t[3]),
      lat: Number(t[4]),
      lon: Number(t[5]),
      alt: Number(t[6]),
    });
  }
  // Variable-name header (skip a single line).
  if (cursor < lines.length) cursor += 1;

  const trajectories = new Map<number, HysplitTrajectory>();
  for (; cursor < lines.length; cursor += 1) {
    const t = lines[cursor].split(/\s+/);
    if (t.length < 12) continue;
    const trajectoryId = Number(t[0]);
    const year = 2000 + Number(t[2]);
    const month = Number(t[3]);
    const day = Number(t[4]);
    const hour = Number(t[5]);
    const minute = Number(t[6]);
    const ageHours = Number(t[8]);
    const latitude = Number(t[9]);
    const longitude = Number(t[10]);
    const height = Number(t[11]);
    const pressure = t.length > 12 ? Number(t[12]) : undefined;

    const timestamp = new Date(Date.UTC(year, month - 1, day, hour, minute)).toISOString();
    let trajectory = trajectories.get(trajectoryId);
    if (!trajectory) {
      const start = starts[trajectoryId - 1] ?? starts[0];
      trajectory = {
        id: trajectoryId,
        startTimestamp: start
          ? new Date(Date.UTC(start.year, start.month - 1, start.day, start.hour)).toISOString()
          : timestamp,
        startLatitude: start?.lat ?? latitude,
        startLongitude: start?.lon ?? longitude,
        points: [],
      };
      trajectories.set(trajectoryId, trajectory);
    }
    trajectory.points.push({
      trajectoryId,
      ageHours,
      timestamp,
      latitude,
      longitude,
      height,
      pressure,
    });
  }
  return [...trajectories.values()].sort((a, b) => a.id - b.id);
}

// ---------------------------------------------------------------------------
// k-means clustering of trajectories
// ---------------------------------------------------------------------------

export type TrajectoryCluster = {
  clusterId: number;
  centroidLatitudes: number[];     // length = sampleCount
  centroidLongitudes: number[];
  trajectoryIds: number[];
};

export type TrajectoryClusterOptions = {
  k: number;
  sampleCount?: number;            // resample each trajectory to this length
  maxIterations?: number;
  seed?: number;
};

export function clusterTrajectories(
  trajectories: readonly HysplitTrajectory[],
  options: TrajectoryClusterOptions,
): TrajectoryCluster[] {
  const { k } = options;
  if (k <= 0 || trajectories.length === 0) return [];
  const sampleCount = options.sampleCount ?? 12;
  const maxIterations = options.maxIterations ?? 50;
  const seed = options.seed ?? 42;
  const rng = mulberry32(seed);

  // Resample each trajectory to `sampleCount` evenly-spaced points by age.
  const resampled = trajectories.map((trajectory) => resampleTrajectory(trajectory, sampleCount));
  const dims = sampleCount * 2;

  // k-means++ seeding: pick the first centroid uniformly at random, then
  // pick each subsequent centroid with probability ∝ d²(x, nearest centroid).
  // This avoids the degenerate case where two centroids land on identical
  // trajectories and one cluster ends up empty.
  const centroids: number[][] = [];
  const firstIdx = Math.floor(rng() * resampled.length);
  centroids.push([...resampled[firstIdx]]);
  while (centroids.length < k && centroids.length < resampled.length) {
    const distances = resampled.map((row) => {
      let best = Number.POSITIVE_INFINITY;
      for (const centroid of centroids) {
        const d = trajectoryDistance(row, centroid);
        if (d < best) best = d;
      }
      return best;
    });
    const total = distances.reduce((sum, d) => sum + d, 0);
    if (total === 0) break;
    let pick = rng() * total;
    let chosen = 0;
    for (let i = 0; i < distances.length; i += 1) {
      pick -= distances[i];
      if (pick <= 0) { chosen = i; break; }
    }
    centroids.push([...resampled[chosen]]);
  }
  // Pad with random picks if we still need more centroids than unique points.
  while (centroids.length < k) {
    centroids.push([...resampled[Math.floor(rng() * resampled.length)]]);
  }

  const assignments = new Array<number>(resampled.length).fill(0);
  for (let iter = 0; iter < maxIterations; iter += 1) {
    let changed = false;
    for (let i = 0; i < resampled.length; i += 1) {
      let bestCluster = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let c = 0; c < centroids.length; c += 1) {
        const distance = trajectoryDistance(resampled[i], centroids[c]);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestCluster = c;
        }
      }
      if (assignments[i] !== bestCluster) {
        assignments[i] = bestCluster;
        changed = true;
      }
    }
    if (!changed) break;
    // Recompute centroids
    for (let c = 0; c < centroids.length; c += 1) {
      const members = resampled.filter((_, idx) => assignments[idx] === c);
      if (members.length === 0) continue;
      for (let d = 0; d < dims; d += 1) {
        centroids[c][d] = members.reduce((sum, row) => sum + row[d], 0) / members.length;
      }
    }
  }

  return centroids.map((centroid, clusterIdx) => ({
    clusterId: clusterIdx,
    centroidLatitudes: Array.from({ length: sampleCount }, (_, i) => centroid[i * 2]),
    centroidLongitudes: Array.from({ length: sampleCount }, (_, i) => centroid[i * 2 + 1]),
    trajectoryIds: trajectories
      .filter((_, idx) => assignments[idx] === clusterIdx)
      .map((trajectory) => trajectory.id),
  }));
}

function resampleTrajectory(trajectory: HysplitTrajectory, sampleCount: number): number[] {
  const points = [...trajectory.points].sort((a, b) => a.ageHours - b.ageHours);
  if (points.length === 0) return new Array(sampleCount * 2).fill(0);
  const ageMin = points[0].ageHours;
  const ageMax = points[points.length - 1].ageHours;
  const out: number[] = [];
  for (let i = 0; i < sampleCount; i += 1) {
    const target = ageMin + ((ageMax - ageMin) * i) / Math.max(1, sampleCount - 1);
    // Linear interpolation
    let prev = points[0];
    let next = points[points.length - 1];
    for (let j = 1; j < points.length; j += 1) {
      if (points[j].ageHours >= target) {
        prev = points[j - 1];
        next = points[j];
        break;
      }
    }
    const span = next.ageHours - prev.ageHours || 1;
    const t = (target - prev.ageHours) / span;
    out.push(prev.latitude + t * (next.latitude - prev.latitude));
    out.push(prev.longitude + t * (next.longitude - prev.longitude));
  }
  return out;
}

function trajectoryDistance(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 2) {
    const dLat = a[i] - b[i];
    const dLon = a[i + 1] - b[i + 1];
    sum += dLat * dLat + dLon * dLon;
  }
  return sum;
}

// ---------------------------------------------------------------------------
// trajectoryLevel — bin a pollutant time-series by trajectory passage
// through a lat/lon grid. Output cells are suitable for the openair
// trajLevel heatmap.
// ---------------------------------------------------------------------------

export type TrajectoryLevelOptions = {
  latStep?: number;
  lonStep?: number;
  statistic?: "mean" | "median" | "max";
};

export type TrajectoryLevelCell = {
  latitude: number;       // cell south-west corner
  longitude: number;
  count: number;
  value: number;
};

export function trajectoryLevel(
  trajectories: readonly HysplitTrajectory[],
  pollutantByTrajectory: ReadonlyMap<number, number>,
  options: TrajectoryLevelOptions = {},
): TrajectoryLevelCell[] {
  const latStep = options.latStep ?? 1;
  const lonStep = options.lonStep ?? 1;
  const statistic = options.statistic ?? "mean";
  const grid = new Map<string, { lat: number; lon: number; values: number[] }>();
  for (const trajectory of trajectories) {
    const value = pollutantByTrajectory.get(trajectory.id);
    if (value === undefined || !Number.isFinite(value)) continue;
    const seen = new Set<string>();
    for (const point of trajectory.points) {
      const latCell = Math.floor(point.latitude / latStep) * latStep;
      const lonCell = Math.floor(point.longitude / lonStep) * lonStep;
      const key = `${latCell.toFixed(4)}:${lonCell.toFixed(4)}`;
      if (seen.has(key)) continue;     // count each cell once per trajectory
      seen.add(key);
      const bucket = grid.get(key) ?? { lat: latCell, lon: lonCell, values: [] };
      bucket.values.push(value);
      grid.set(key, bucket);
    }
  }
  return [...grid.values()].map((bucket) => ({
    latitude: bucket.lat,
    longitude: bucket.lon,
    count: bucket.values.length,
    value: aggregate(bucket.values, statistic),
  }));
}

function aggregate(values: readonly number[], statistic: "mean" | "median" | "max"): number {
  if (values.length === 0) return 0;
  if (statistic === "mean") return values.reduce((a, b) => a + b, 0) / values.length;
  if (statistic === "max") return Math.max(...values);
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}
