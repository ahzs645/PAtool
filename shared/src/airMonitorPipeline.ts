// ---------------------------------------------------------------------------
// airMonitorPipeline — TS analogue of the AirMonitor `monitor_*` chainable
// dplyr-style pipeline:
//   - Monitor object holds meta (one row per timeseries) + data (rows = time,
//     columns = monitor IDs)
//   - filterMeta / filterDate / dropNullData / collapse / combine / select
//   - daily aggregation in LST (local-standard-time, daylight-savings aware)
//
// Plus light source-loader interfaces for AIRSIS / WRCC / AirNow / EPA AQS /
// Clarity / OpenAQ. The interfaces fix shape; concrete network adapters live
// behind these so we can stub them in tests without touching the pipeline.
// ---------------------------------------------------------------------------

export type MonitorRow = {
  datetime: string;                 // ISO timestamp (UTC)
  [monitorId: string]: number | string | null;
};

export type MonitorMetaRow = {
  monitorId: string;
  source?: "AIRSIS" | "WRCC" | "AirNow" | "AQS" | "Clarity" | "OpenAQ" | "PurpleAir" | "manual";
  siteName?: string;
  agency?: string;
  parameter: string;
  units: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;                // IANA tz, e.g. "America/Los_Angeles"
  utcOffsetHours?: number;          // LST offset (no DST)
  notes?: string;
};

export class Monitor {
  readonly meta: MonitorMetaRow[];
  readonly data: MonitorRow[];

  constructor(meta: MonitorMetaRow[], data: MonitorRow[]) {
    this.meta = meta;
    this.data = data;
  }

  get monitorIds(): string[] {
    return this.meta.map((row) => row.monitorId);
  }

  get nMonitors(): number {
    return this.meta.length;
  }

  get nTimestamps(): number {
    return this.data.length;
  }

  filterMeta(predicate: (row: MonitorMetaRow) => boolean): Monitor {
    const keptMeta = this.meta.filter(predicate);
    const keptIds = new Set(keptMeta.map((row) => row.monitorId));
    const keptData = this.data.map((row) => {
      const next: MonitorRow = { datetime: row.datetime };
      for (const id of keptIds) {
        if (id in row) next[id] = row[id];
      }
      return next;
    });
    return new Monitor(keptMeta, keptData);
  }

  filterDate(start: string, end: string): Monitor {
    const startMs = Date.parse(start);
    const endMs = Date.parse(end);
    const data = this.data.filter((row) => {
      const t = Date.parse(row.datetime);
      return t >= startMs && t < endMs;
    });
    return new Monitor(this.meta, data);
  }

  dropEmptyMonitors(): Monitor {
    const meta = this.meta.filter((row) => {
      const id = row.monitorId;
      return this.data.some((dataRow) => {
        const v = dataRow[id];
        return typeof v === "number" && Number.isFinite(v);
      });
    });
    const keptIds = new Set(meta.map((row) => row.monitorId));
    const data = this.data.map((row) => {
      const next: MonitorRow = { datetime: row.datetime };
      for (const id of keptIds) {
        if (id in row) next[id] = row[id];
      }
      return next;
    });
    return new Monitor(meta, data);
  }

  collapse(fn: "mean" | "median" | "max" = "mean", label = "collapsed"): Monitor {
    const ids = this.monitorIds;
    const data: MonitorRow[] = this.data.map((row) => {
      const values: number[] = [];
      for (const id of ids) {
        const v = row[id];
        if (typeof v === "number" && Number.isFinite(v)) values.push(v);
      }
      let aggregate: number | null = null;
      if (values.length > 0) {
        if (fn === "mean") aggregate = values.reduce((s, v) => s + v, 0) / values.length;
        else if (fn === "median") aggregate = median(values);
        else aggregate = Math.max(...values);
      }
      return { datetime: row.datetime, [label]: aggregate };
    });
    const meta: MonitorMetaRow[] = [{
      monitorId: label,
      parameter: this.meta[0]?.parameter ?? "PM2.5",
      units: this.meta[0]?.units ?? "ug/m3",
      source: "manual",
      notes: `Collapsed from ${this.nMonitors} monitor(s) via ${fn}`,
    }];
    return new Monitor(meta, data);
  }

  select(monitorIds: readonly string[]): Monitor {
    const set = new Set(monitorIds);
    return this.filterMeta((row) => set.has(row.monitorId));
  }

  combine(other: Monitor): Monitor {
    const ourIds = new Set(this.monitorIds);
    const otherMeta = other.meta.filter((row) => !ourIds.has(row.monitorId));
    const meta = [...this.meta, ...otherMeta];
    const idsToAdd = new Set(otherMeta.map((row) => row.monitorId));
    // index other.data by datetime
    const otherByTs = new Map(other.data.map((row) => [row.datetime, row]));
    const datetimes = new Set([...this.data.map((row) => row.datetime), ...other.data.map((row) => row.datetime)]);
    const ourByTs = new Map(this.data.map((row) => [row.datetime, row]));
    const data: MonitorRow[] = [...datetimes].sort().map((datetime) => {
      const ours = ourByTs.get(datetime) ?? { datetime } as MonitorRow;
      const theirs = otherByTs.get(datetime);
      const merged: MonitorRow = { ...ours };
      if (theirs) {
        for (const id of idsToAdd) merged[id] = theirs[id] ?? null;
      } else {
        for (const id of idsToAdd) merged[id] = null;
      }
      return merged;
    });
    return new Monitor(meta, data);
  }

  // ---- Aggregations ------------------------------------------------------

  /**
   * Daily aggregation using each monitor's LST (local standard time, ignoring
   * DST). The bucket key is YYYY-MM-DD in LST. Returns one new Monitor with
   * 24-hour-mean values per monitor.
   */
  dailyLstMean(minHours = 18): Monitor {
    const ids = this.monitorIds;
    const offsetById = new Map<string, number>();
    for (const row of this.meta) offsetById.set(row.monitorId, row.utcOffsetHours ?? 0);

    const byDate = new Map<string, Map<string, { sum: number; count: number }>>();
    for (const row of this.data) {
      const utcMs = Date.parse(row.datetime);
      if (!Number.isFinite(utcMs)) continue;
      for (const id of ids) {
        const v = row[id];
        if (typeof v !== "number" || !Number.isFinite(v)) continue;
        const offset = offsetById.get(id) ?? 0;
        const local = new Date(utcMs + offset * 3_600_000);
        const dateKey = `${local.getUTCFullYear()}-${pad2(local.getUTCMonth() + 1)}-${pad2(local.getUTCDate())}`;
        const dateBucket = byDate.get(dateKey) ?? new Map();
        const monitorBucket = dateBucket.get(id) ?? { sum: 0, count: 0 };
        monitorBucket.sum += v;
        monitorBucket.count += 1;
        dateBucket.set(id, monitorBucket);
        byDate.set(dateKey, dateBucket);
      }
    }

    const sortedDates = [...byDate.keys()].sort();
    const data: MonitorRow[] = sortedDates.map((dateKey) => {
      const row: MonitorRow = { datetime: `${dateKey}T00:00:00Z` };
      const bucket = byDate.get(dateKey)!;
      for (const id of ids) {
        const cell = bucket.get(id);
        row[id] = cell && cell.count >= minHours ? cell.sum / cell.count : null;
      }
      return row;
    });
    return new Monitor(this.meta, data);
  }
}

// ---------------------------------------------------------------------------
// LST helpers
// ---------------------------------------------------------------------------

const COMMON_LST_OFFSETS: Record<string, number> = {
  "America/Los_Angeles": -8,
  "America/Denver": -7,
  "America/Phoenix": -7,
  "America/Chicago": -6,
  "America/New_York": -5,
  "America/Anchorage": -9,
  "Pacific/Honolulu": -10,
  "UTC": 0,
};

export function lstOffsetHoursForTimezone(tz: string | undefined): number {
  if (!tz) return 0;
  return COMMON_LST_OFFSETS[tz] ?? 0;
}

// ---------------------------------------------------------------------------
// Loader interfaces
// ---------------------------------------------------------------------------

export type LoaderQuery = {
  parameter: "PM2.5" | "PM10" | "O3" | "NO2" | "CO" | "SO2";
  start: string;
  end: string;
  bbox?: { west: number; south: number; east: number; north: number };
  monitorIds?: readonly string[];
};

export type MonitorLoader = {
  source: NonNullable<MonitorMetaRow["source"]>;
  load(query: LoaderQuery): Promise<Monitor>;
};

// ---------------------------------------------------------------------------
// OpenAQ metadata catalog types (countries / instruments / manufacturers /
// providers / parameters). Concrete adapters live in worker/src.
// ---------------------------------------------------------------------------

export type OpenAqCountry = { code: string; name: string };
export type OpenAqProvider = { id: number; name: string; url?: string };
export type OpenAqManufacturer = { id: number; name: string };
export type OpenAqInstrument = {
  id: number;
  name: string;
  manufacturerId?: number;
  reference?: boolean;
};
export type OpenAqParameter = {
  id: number;
  name: string;
  displayName?: string;
  description?: string;
  units?: string;
};

export type OpenAqCatalog = {
  countries: OpenAqCountry[];
  providers: OpenAqProvider[];
  manufacturers: OpenAqManufacturer[];
  instruments: OpenAqInstrument[];
  parameters: OpenAqParameter[];
};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}
