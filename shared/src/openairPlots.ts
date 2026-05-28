/**
 * Plot-data builders ported from openair. These return structured rows
 * intended to be fed to ECharts; no rendering happens here.
 *
 * - timeVariation: diurnal + day-of-week + monthly + DOW×hour panels
 * - calendarPlot: daily values laid out per ISO date
 * - corPlot: correlation matrix with hierarchical-clustering ordering
 * - scatterPlot: hex-bin density + linear/loess fit
 * - trendLevel: heatmap of a statistic over (month × year)
 */

export type DatedValue = {
  timestamp: string;
  value: number;
};

export type TimeVariationBin = {
  bin: string;
  mean: number;
  median: number;
  q25: number;
  q75: number;
  count: number;
};

export type TimeVariationResult = {
  hour: TimeVariationBin[];
  dayOfWeek: TimeVariationBin[];
  month: TimeVariationBin[];
  hourByDow: Array<{ hour: number; dow: number; mean: number; count: number }>;
};

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function summarize(values: number[], label: string): TimeVariationBin {
  if (values.length === 0) {
    return { bin: label, mean: 0, median: 0, q25: 0, q75: 0, count: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const q = (qq: number) => {
    const pos = Math.min(sorted.length - 1, Math.max(0, qq * (sorted.length - 1)));
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  };
  return { bin: label, mean, median: q(0.5), q25: q(0.25), q75: q(0.75), count: values.length };
}

/**
 * `openair::timeVariation` — diurnal / DOW / monthly / DOW×hour panels.
 */
export function timeVariation(rows: ReadonlyArray<DatedValue>): TimeVariationResult {
  const hour: Record<number, number[]> = {};
  const dow: Record<number, number[]> = {};
  const month: Record<number, number[]> = {};
  const hourDow: Record<string, number[]> = {};
  for (const row of rows) {
    const t = new Date(row.timestamp);
    if (!Number.isFinite(t.getTime()) || !Number.isFinite(row.value)) continue;
    const h = t.getUTCHours();
    const d = t.getUTCDay();
    const m = t.getUTCMonth();
    (hour[h] ??= []).push(row.value);
    (dow[d] ??= []).push(row.value);
    (month[m] ??= []).push(row.value);
    (hourDow[`${h}:${d}`] ??= []).push(row.value);
  }
  return {
    hour: Array.from({ length: 24 }, (_, i) => summarize(hour[i] ?? [], `${i}`)),
    dayOfWeek: Array.from({ length: 7 }, (_, i) => summarize(dow[i] ?? [], DOW_LABELS[i])),
    month: Array.from({ length: 12 }, (_, i) => summarize(month[i] ?? [], MONTH_LABELS[i])),
    hourByDow: Object.entries(hourDow).map(([key, vals]) => {
      const [h, d] = key.split(":").map(Number);
      const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
      return { hour: h, dow: d, mean, count: vals.length };
    }),
  };
}

export type CalendarCell = {
  date: string; // ISO date YYYY-MM-DD
  year: number;
  month: number;
  day: number;
  weekday: number;
  value: number;
  count: number;
};

/**
 * `openair::calendarPlot` — daily aggregates ready for an ECharts
 * calendar heatmap. `stat` controls the daily aggregator.
 */
export function calendarPlot(
  rows: ReadonlyArray<DatedValue>,
  options: { statistic?: "mean" | "median" | "max" } = {},
): CalendarCell[] {
  const stat = options.statistic ?? "mean";
  const groups: Record<string, number[]> = {};
  for (const row of rows) {
    const t = new Date(row.timestamp);
    if (!Number.isFinite(t.getTime()) || !Number.isFinite(row.value)) continue;
    const key = t.toISOString().slice(0, 10);
    (groups[key] ??= []).push(row.value);
  }
  return Object.entries(groups)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, vals]) => {
      const sorted = [...vals].sort((a, b) => a - b);
      const value =
        stat === "max" ? sorted[sorted.length - 1]
        : stat === "median" ? sorted[Math.floor(sorted.length / 2)]
        : vals.reduce((s, v) => s + v, 0) / vals.length;
      const t = new Date(`${date}T00:00:00Z`);
      return {
        date,
        year: t.getUTCFullYear(),
        month: t.getUTCMonth() + 1,
        day: t.getUTCDate(),
        weekday: t.getUTCDay(),
        value: Number(value.toFixed(4)),
        count: vals.length,
      };
    });
}

export type CorrelationCell = {
  rowVar: string;
  colVar: string;
  r: number;
  n: number;
};

export type CorrelationMatrix = {
  variables: string[];
  /** Ordering after hierarchical (single-linkage) clustering on |r|. */
  order: string[];
  cells: CorrelationCell[];
};

/**
 * `openair::corPlot` — pairwise Pearson r matrix with simple
 * single-linkage hierarchical ordering on 1−|r|. Useful for showing
 * pollutant/meteorological co-variation.
 */
export function corPlot(rows: ReadonlyArray<Record<string, number | null>>): CorrelationMatrix {
  const variables = Array.from(
    new Set(rows.flatMap((r) => Object.keys(r))),
  ).filter((v) => rows.some((r) => Number.isFinite(r[v] as number)));

  const cells: CorrelationCell[] = [];
  const rMap: Record<string, Record<string, number>> = {};
  for (let i = 0; i < variables.length; i += 1) {
    rMap[variables[i]] = {};
    for (let j = 0; j < variables.length; j += 1) {
      const a = variables[i];
      const b = variables[j];
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (const row of rows) {
        const x = row[a];
        const y = row[b];
        if (!Number.isFinite(x as number) || !Number.isFinite(y as number)) continue;
        sx += x as number;
        sy += y as number;
        n += 1;
      }
      if (n === 0) {
        cells.push({ rowVar: a, colVar: b, r: 0, n: 0 });
        rMap[a][b] = 0;
        continue;
      }
      const mx = sx / n;
      const my = sy / n;
      let sxx = 0;
      let syy = 0;
      let sxy = 0;
      for (const row of rows) {
        const x = row[a];
        const y = row[b];
        if (!Number.isFinite(x as number) || !Number.isFinite(y as number)) continue;
        const dx = (x as number) - mx;
        const dy = (y as number) - my;
        sxx += dx * dx;
        syy += dy * dy;
        sxy += dx * dy;
      }
      const r = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
      cells.push({ rowVar: a, colVar: b, r, n });
      rMap[a][b] = r;
    }
  }

  // Single-linkage clustering on distance = 1 − |r|.
  const order = clusterOrder(variables, (a, b) => 1 - Math.abs(rMap[a]?.[b] ?? 0));
  return { variables, order, cells };
}

function clusterOrder(items: string[], distance: (a: string, b: string) => number): string[] {
  if (items.length <= 1) return [...items];
  const clusters: string[][] = items.map((v) => [v]);
  while (clusters.length > 1) {
    let bestI = 0;
    let bestJ = 1;
    let bestD = Infinity;
    for (let i = 0; i < clusters.length; i += 1) {
      for (let j = i + 1; j < clusters.length; j += 1) {
        let d = Infinity;
        for (const a of clusters[i]) for (const b of clusters[j]) {
          const dij = distance(a, b);
          if (dij < d) d = dij;
        }
        if (d < bestD) {
          bestD = d;
          bestI = i;
          bestJ = j;
        }
      }
    }
    clusters[bestI] = [...clusters[bestI], ...clusters[bestJ]];
    clusters.splice(bestJ, 1);
  }
  return clusters[0];
}

export type ScatterDensityBin = {
  x: number;
  y: number;
  count: number;
  density: number;
};

export type ScatterPlotResult = {
  bins: ScatterDensityBin[];
  fit: { slope: number; intercept: number; r2: number };
};

/**
 * `openair::scatterPlot` — 2D hex/grid-binned density + OLS fit line.
 */
export function scatterPlot(
  rows: ReadonlyArray<{ x: number; y: number }>,
  options: { bins?: number } = {},
): ScatterPlotResult {
  const bins = Math.max(4, Math.floor(options.bins ?? 30));
  const usable = rows.filter((r) => Number.isFinite(r.x) && Number.isFinite(r.y));
  if (usable.length === 0) {
    return { bins: [], fit: { slope: 0, intercept: 0, r2: 0 } };
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const r of usable) {
    if (r.x < minX) minX = r.x;
    if (r.x > maxX) maxX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.y > maxY) maxY = r.y;
  }
  const dx = (maxX - minX) / bins || 1;
  const dy = (maxY - minY) / bins || 1;
  const grid = new Map<string, number>();
  for (const r of usable) {
    const xi = Math.min(bins - 1, Math.floor((r.x - minX) / dx));
    const yi = Math.min(bins - 1, Math.floor((r.y - minY) / dy));
    const key = `${xi}:${yi}`;
    grid.set(key, (grid.get(key) ?? 0) + 1);
  }
  let maxCount = 0;
  for (const count of grid.values()) if (count > maxCount) maxCount = count;
  const cells: ScatterDensityBin[] = Array.from(grid.entries()).map(([key, count]) => {
    const [xi, yi] = key.split(":").map(Number);
    return {
      x: minX + (xi + 0.5) * dx,
      y: minY + (yi + 0.5) * dy,
      count,
      density: count / maxCount,
    };
  });

  const n = usable.length;
  const mx = usable.reduce((s, p) => s + p.x, 0) / n;
  const my = usable.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of usable) {
    sxx += (p.x - mx) ** 2;
    syy += (p.y - my) ** 2;
    sxy += (p.x - mx) * (p.y - my);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = sxx > 0 && syy > 0 ? (sxy * sxy) / (sxx * syy) : 0;
  return { bins: cells, fit: { slope, intercept, r2 } };
}

export type TrendLevelCell = {
  year: number;
  month: number;
  value: number;
  count: number;
};

/**
 * `openair::trendLevel` — heatmap of a chosen statistic by (year, month).
 */
export function trendLevel(
  rows: ReadonlyArray<DatedValue>,
  options: { statistic?: "mean" | "median" | "max" } = {},
): TrendLevelCell[] {
  const stat = options.statistic ?? "mean";
  const groups: Record<string, number[]> = {};
  for (const row of rows) {
    const t = new Date(row.timestamp);
    if (!Number.isFinite(t.getTime()) || !Number.isFinite(row.value)) continue;
    const key = `${t.getUTCFullYear()}:${t.getUTCMonth() + 1}`;
    (groups[key] ??= []).push(row.value);
  }
  return Object.entries(groups).map(([key, vals]) => {
    const [year, month] = key.split(":").map(Number);
    const sorted = [...vals].sort((a, b) => a - b);
    const value =
      stat === "max" ? sorted[sorted.length - 1]
      : stat === "median" ? sorted[Math.floor(sorted.length / 2)]
      : vals.reduce((s, v) => s + v, 0) / vals.length;
    return { year, month, value, count: vals.length };
  }).sort((a, b) => (a.year - b.year) || (a.month - b.month));
}
