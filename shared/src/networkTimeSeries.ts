/**
 * Network time-series model for the map time-lapse view.
 *
 * A NetworkTimeSeries holds a shared, ascending list of timestamps and, for
 * each site, a value array aligned to those timestamps. This is the structure
 * the map slider animates over: frame `i` is every site's value at
 * `timestamps[i]`. Built by pivoting per-(sensor, timestamp) measurement rows
 * — e.g. ASNAT/ASDU standard-format files or PurpleAir daily/hourly exports.
 */

export type NetworkSite = {
  id: string;
  label?: string;
  latitude: number;
  longitude: number;
  /** Aligned 1:1 with NetworkTimeSeries.timestamps; null where missing. */
  values: Array<number | null>;
};

export type NetworkTimeSeries = {
  pollutant: string;
  unit: string;
  timestamps: string[];
  sites: NetworkSite[];
};

export type NetworkFramePoint = {
  id: string;
  label?: string;
  latitude: number;
  longitude: number;
  value: number | null;
};

export type NetworkFrame = {
  index: number;
  timestamp: string;
  points: NetworkFramePoint[];
};

export type NetworkMeasurementRow = {
  sensorId: string;
  timestamp: string;
  latitude: number;
  longitude: number;
  value: number | null;
  label?: string;
};

export type BuildNetworkOptions = {
  pollutant?: string;
  unit?: string;
  /** Optional bucketing of timestamps before pivoting. */
  bucket?: "hour" | "day";
};

function bucketTimestamp(timestamp: string, bucket?: "hour" | "day"): string {
  if (!bucket) return timestamp;
  const t = Date.parse(timestamp);
  if (Number.isNaN(t)) return timestamp;
  const iso = new Date(t).toISOString();
  return bucket === "hour" ? `${iso.slice(0, 13)}:00:00Z` : `${iso.slice(0, 10)}T00:00:00Z`;
}

function isNum(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Pivot per-(sensor, timestamp) rows into an aligned NetworkTimeSeries.
 * Sites keep the last non-null coordinates seen; when multiple rows fall in
 * the same (site, timestamp) bucket their finite values are averaged.
 */
export function buildNetworkTimeSeries(
  rows: readonly NetworkMeasurementRow[],
  options: BuildNetworkOptions = {},
): NetworkTimeSeries {
  const timestampSet = new Set<string>();
  type Accum = { lat: number; lon: number; label?: string; sums: Map<string, { sum: number; count: number }> };
  const sites = new Map<string, Accum>();

  for (const row of rows) {
    const ts = bucketTimestamp(row.timestamp, options.bucket);
    timestampSet.add(ts);
    let site = sites.get(row.sensorId);
    if (!site) {
      site = { lat: row.latitude, lon: row.longitude, label: row.label, sums: new Map() };
      sites.set(row.sensorId, site);
    }
    if (isNum(row.latitude) && isNum(row.longitude)) {
      site.lat = row.latitude;
      site.lon = row.longitude;
    }
    if (row.label) site.label = row.label;
    if (isNum(row.value)) {
      const cell = site.sums.get(ts) ?? { sum: 0, count: 0 };
      cell.sum += row.value;
      cell.count += 1;
      site.sums.set(ts, cell);
    }
  }

  const timestamps = [...timestampSet].sort((a, b) => Date.parse(a) - Date.parse(b));
  const indexOf = new Map(timestamps.map((ts, i) => [ts, i]));

  const siteList: NetworkSite[] = [...sites.entries()].map(([id, site]) => {
    const values = new Array<number | null>(timestamps.length).fill(null);
    for (const [ts, cell] of site.sums) {
      const i = indexOf.get(ts);
      if (i !== undefined && cell.count > 0) values[i] = cell.sum / cell.count;
    }
    return { id, label: site.label, latitude: site.lat, longitude: site.lon, values };
  });

  return {
    pollutant: options.pollutant ?? "pm2.5",
    unit: options.unit ?? "ug/m3",
    timestamps,
    sites: siteList,
  };
}

/** The network state (every site's value) at timestamp index `index`. */
export function networkFrameAt(series: NetworkTimeSeries, index: number): NetworkFrame {
  const clamped = Math.max(0, Math.min(index, series.timestamps.length - 1));
  return {
    index: clamped,
    timestamp: series.timestamps[clamped] ?? "",
    points: series.sites.map((site) => ({
      id: site.id,
      label: site.label,
      latitude: site.latitude,
      longitude: site.longitude,
      value: site.values[clamped] ?? null,
    })),
  };
}

/** Finite [min, max] across every site/timestamp value (for colormap scaling). */
export function networkValueRange(series: NetworkTimeSeries): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const site of series.sites) {
    for (const value of site.values) {
      if (isNum(value)) {
        if (value < min) min = value;
        if (value > max) max = value;
      }
    }
  }
  if (!Number.isFinite(min)) return { min: 0, max: 0 };
  return { min, max };
}

/** Per-timestamp mean across all reporting sites — handy for a scrubber sparkline. */
export function networkFrameMeans(series: NetworkTimeSeries): Array<number | null> {
  return series.timestamps.map((_, i) => {
    let sum = 0;
    let count = 0;
    for (const site of series.sites) {
      const value = site.values[i];
      if (isNum(value)) {
        sum += value;
        count += 1;
      }
    }
    return count > 0 ? sum / count : null;
  });
}
