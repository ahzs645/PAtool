/**
 * AirMonitor-style `mts_monitor` data model and chainable transforms.
 *
 * The R package exposes a tidy list-of-two-tibbles structure with `meta`
 * (one row per monitor) and `data` (one column per monitor, one row per
 * UTC timestamp). The pipeline functions below preserve that invariant
 * so analyses chain like dplyr: filterDate → filterMeta → mutate →
 * dailyStatistic.
 */

export type MonitorMeta = {
  id: string;
  label?: string;
  longitude?: number;
  latitude?: number;
  elevation?: number;
  timezone?: string;
  countryCode?: string;
  stateCode?: string;
  county?: string;
  parameter?: string;
  units?: string;
  agencyName?: string;
  /** Optional free-form metadata keys (location, contact, instrument, …). */
  [key: string]: unknown;
};

export type MonitorTimeseries = {
  /** ISO timestamps, one per row. */
  datetime: string[];
  /** Column per monitor (keyed by `meta[].id`). Values aligned to `datetime`. */
  data: Record<string, Array<number | null>>;
};

export type MtsMonitor = {
  meta: MonitorMeta[];
  data: MonitorTimeseries;
};

function cloneMeta(m: MonitorMeta): MonitorMeta {
  return { ...m };
}

function cloneTs(ts: MonitorTimeseries): MonitorTimeseries {
  return {
    datetime: [...ts.datetime],
    data: Object.fromEntries(Object.entries(ts.data).map(([k, v]) => [k, [...v]])),
  };
}

export function monitorClone(monitor: MtsMonitor): MtsMonitor {
  return { meta: monitor.meta.map(cloneMeta), data: cloneTs(monitor.data) };
}

/** Are there any monitors? */
export function monitorIsEmpty(monitor: MtsMonitor): boolean {
  return monitor.meta.length === 0;
}

/** Quick structural validity check (matched columns and rows). */
export function monitorIsValid(monitor: MtsMonitor): boolean {
  const ids = new Set(monitor.meta.map((m) => m.id));
  if (ids.size !== monitor.meta.length) return false;
  for (const id of ids) {
    const col = monitor.data.data[id];
    if (!col || col.length !== monitor.data.datetime.length) return false;
  }
  return true;
}

/** R: `monitor_filterMeta()` — keep monitors where `predicate(meta)` is true. */
export function monitorFilterMeta(
  monitor: MtsMonitor,
  predicate: (meta: MonitorMeta) => boolean,
): MtsMonitor {
  const keep = monitor.meta.filter(predicate);
  const ids = new Set(keep.map((m) => m.id));
  return {
    meta: keep,
    data: {
      datetime: [...monitor.data.datetime],
      data: Object.fromEntries(
        Object.entries(monitor.data.data).filter(([k]) => ids.has(k)),
      ),
    },
  };
}

/** R: `monitor_filterDate()` — keep rows in [start, end). */
export function monitorFilterDate(
  monitor: MtsMonitor,
  start: string,
  end: string,
): MtsMonitor {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  const keepIdx: number[] = [];
  for (let i = 0; i < monitor.data.datetime.length; i += 1) {
    const t = new Date(monitor.data.datetime[i]).getTime();
    if (Number.isFinite(t) && t >= startMs && t < endMs) keepIdx.push(i);
  }
  return {
    meta: monitor.meta.map(cloneMeta),
    data: {
      datetime: keepIdx.map((i) => monitor.data.datetime[i]),
      data: Object.fromEntries(
        Object.entries(monitor.data.data).map(([id, col]) => [id, keepIdx.map((i) => col[i])]),
      ),
    },
  };
}

/** R: `monitor_filterByDistance()` — keep monitors within `radiusKm` of (lat, lon). */
export function monitorFilterByDistance(
  monitor: MtsMonitor,
  lat: number,
  lon: number,
  radiusKm: number,
): MtsMonitor {
  return monitorFilterMeta(monitor, (m) => {
    if (!Number.isFinite(m.latitude as number) || !Number.isFinite(m.longitude as number)) return false;
    return haversineKm(lat, lon, m.latitude!, m.longitude!) <= radiusKm;
  });
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** R: `monitor_select()` — keep a specific set of monitor IDs. */
export function monitorSelect(monitor: MtsMonitor, ids: ReadonlyArray<string>): MtsMonitor {
  const set = new Set(ids);
  return monitorFilterMeta(monitor, (m) => set.has(m.id));
}

/** R: `monitor_mutate()` — apply f to every column. */
export function monitorMutate(
  monitor: MtsMonitor,
  fn: (value: number | null, index: number, id: string) => number | null,
): MtsMonitor {
  const next = cloneTs(monitor.data);
  for (const id of Object.keys(next.data)) {
    next.data[id] = next.data[id].map((v, i) => fn(v, i, id));
  }
  return { meta: monitor.meta.map(cloneMeta), data: next };
}

/** R: `monitor_replaceValues()` — replace where `where(value)` returns true. */
export function monitorReplaceValues(
  monitor: MtsMonitor,
  where: (value: number | null) => boolean,
  replacement: number | null,
): MtsMonitor {
  return monitorMutate(monitor, (v) => (where(v) ? replacement : v));
}

/** R: `monitor_combine()` — union monitors over a common datetime grid. */
export function monitorCombine(monitors: ReadonlyArray<MtsMonitor>): MtsMonitor {
  if (monitors.length === 0) return { meta: [], data: { datetime: [], data: {} } };
  const datetimeSet = new Set<string>();
  for (const m of monitors) for (const ts of m.data.datetime) datetimeSet.add(ts);
  const datetime = Array.from(datetimeSet).sort();
  const tsIndex: Record<string, number> = {};
  datetime.forEach((ts, i) => { tsIndex[ts] = i; });
  const meta: MonitorMeta[] = [];
  const data: Record<string, Array<number | null>> = {};
  for (const m of monitors) {
    for (const md of m.meta) {
      meta.push(cloneMeta(md));
      const col = new Array<number | null>(datetime.length).fill(null);
      const src = m.data.data[md.id] ?? [];
      m.data.datetime.forEach((ts, i) => {
        const idx = tsIndex[ts];
        if (idx !== undefined) col[idx] = src[i] ?? null;
      });
      data[md.id] = col;
    }
  }
  return { meta, data: { datetime, data } };
}

export type DailyStatistic = "mean" | "median" | "max" | "min" | "count";

export type MonitorDailyOptions = {
  /** EPA convention "LST" uses local standard time; "UTC" uses UTC midnight. */
  dayBoundary?: "LST" | "UTC";
  /** Minimum number of valid hours to retain the daily value. */
  minHours?: number;
  statistic?: DailyStatistic;
};

/**
 * R: `monitor_dailyStatistic()` — collapse hourly values to daily values.
 * If `dayBoundary === "LST"`, each monitor's `timezone` is used to align
 * to local standard midnight (DST-aware ⇒ each monitor may have a
 * differently-shifted day boundary).
 */
export function monitorDailyStatistic(
  monitor: MtsMonitor,
  options: MonitorDailyOptions = {},
): MtsMonitor {
  const stat = options.statistic ?? "mean";
  const minHours = options.minHours ?? 18; // EPA "75% of 24" rule
  const dayBoundary = options.dayBoundary ?? "LST";
  const tzCache: Record<string, string | undefined> = {};
  for (const m of monitor.meta) tzCache[m.id] = m.timezone;

  const buckets: Record<string, Record<string, Array<number | null>>> = {};
  const datetimeKeys = new Set<string>();
  for (let i = 0; i < monitor.data.datetime.length; i += 1) {
    const tsIso = monitor.data.datetime[i];
    const t = new Date(tsIso);
    if (!Number.isFinite(t.getTime())) continue;
    for (const id of Object.keys(monitor.data.data)) {
      const value = monitor.data.data[id][i];
      const tz = dayBoundary === "LST" ? tzCache[id] : "UTC";
      const day = localDateKey(t, tz);
      datetimeKeys.add(day);
      const slot = (buckets[day] ??= {});
      (slot[id] ??= []).push(value);
    }
  }
  const datetime = Array.from(datetimeKeys).sort();
  const data: Record<string, Array<number | null>> = {};
  for (const m of monitor.meta) {
    data[m.id] = datetime.map((day) => {
      const vals = (buckets[day]?.[m.id] ?? []).filter(
        (v): v is number => typeof v === "number" && Number.isFinite(v),
      );
      if (vals.length < minHours) return null;
      const sorted = [...vals].sort((a, b) => a - b);
      switch (stat) {
        case "median": return sorted[Math.floor(sorted.length / 2)];
        case "max": return sorted[sorted.length - 1];
        case "min": return sorted[0];
        case "count": return vals.length;
        default: return vals.reduce((s, v) => s + v, 0) / vals.length;
      }
    });
  }
  return { meta: monitor.meta.map(cloneMeta), data: { datetime, data } };
}

/**
 * R: `monitor_dailyThreshold()` — count hours above threshold per day.
 */
export function monitorDailyThreshold(
  monitor: MtsMonitor,
  threshold: number,
  options: { dayBoundary?: "LST" | "UTC" } = {},
): MtsMonitor {
  const dayBoundary = options.dayBoundary ?? "LST";
  const tzCache: Record<string, string | undefined> = {};
  for (const m of monitor.meta) tzCache[m.id] = m.timezone;
  const buckets: Record<string, Record<string, number>> = {};
  const keys = new Set<string>();
  for (let i = 0; i < monitor.data.datetime.length; i += 1) {
    const tsIso = monitor.data.datetime[i];
    const t = new Date(tsIso);
    if (!Number.isFinite(t.getTime())) continue;
    for (const id of Object.keys(monitor.data.data)) {
      const value = monitor.data.data[id][i];
      const tz = dayBoundary === "LST" ? tzCache[id] : "UTC";
      const day = localDateKey(t, tz);
      keys.add(day);
      const slot = (buckets[day] ??= {});
      if (typeof value === "number" && Number.isFinite(value) && value > threshold) {
        slot[id] = (slot[id] ?? 0) + 1;
      } else {
        slot[id] = slot[id] ?? 0;
      }
    }
  }
  const datetime = Array.from(keys).sort();
  const data: Record<string, Array<number | null>> = {};
  for (const m of monitor.meta) {
    data[m.id] = datetime.map((day) => buckets[day]?.[m.id] ?? 0);
  }
  return { meta: monitor.meta.map(cloneMeta), data: { datetime, data } };
}

/**
 * R: `monitor_toCSV()` — flatten to a long CSV string (timestamp,id,value).
 */
export function monitorToCsv(monitor: MtsMonitor): string {
  const rows: string[] = ["timestamp,monitor_id,value"];
  for (let i = 0; i < monitor.data.datetime.length; i += 1) {
    for (const id of Object.keys(monitor.data.data)) {
      const v = monitor.data.data[id][i];
      const cell = typeof v === "number" && Number.isFinite(v) ? String(v) : "";
      rows.push(`${monitor.data.datetime[i]},${id},${cell}`);
    }
  }
  return rows.join("\n");
}

function localDateKey(t: Date, tz: string | undefined): string {
  if (!tz || tz === "UTC") return t.toISOString().slice(0, 10);
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return fmt.format(t);
  } catch {
    return t.toISOString().slice(0, 10);
  }
}
