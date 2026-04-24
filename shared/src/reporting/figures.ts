import type {
  ReportFigureSpec,
  ReportGenerationPlan,
  ReportNetworkSummary,
  ReportSeason,
  ReportSensorMetrics,
  ReportSensorPercentDifference,
} from "./types";

export type GeneratedReportFigure = {
  svg: string;
  altText: string;
  caption: string;
  width: number;
  height: number;
  status: "ready" | "placeholder";
};

const WIDTH = 720;
const HEIGHT = 360;
const PLOT = { left: 92, right: 30, top: 72, bottom: 58 };
const SEASONS: readonly ReportSeason[] = ["winter", "spring", "summer", "fall"];
const SEASON_COLORS: Record<ReportSeason, string> = {
  winter: "#2563eb",
  spring: "#16a34a",
  summer: "#dc2626",
  fall: "#d97706",
};

function escapeXml(value: string): string {
  return Array.from(value, (char) => {
    const codePoint = char.codePointAt(0) ?? 0;
    if (
      codePoint === 0x09 ||
      codePoint === 0x0a ||
      codePoint === 0x0d ||
      (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
      (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
      (codePoint >= 0x10000 && codePoint <= 0x10ffff)
    ) {
      return char;
    }
    return " ";
  }).join("")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function round(value: number, digits = 1): string {
  return value.toFixed(digits);
}

function mean(values: readonly number[]): number | null {
  if (!values.length) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function percentile(values: readonly number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * Math.max(0, Math.min(1, fraction));
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function scale(value: number, domainMin: number, domainMax: number, rangeMin: number, rangeMax: number): number {
  if (domainMax === domainMin) return (rangeMin + rangeMax) / 2;
  return rangeMin + ((value - domainMin) / (domainMax - domainMin)) * (rangeMax - rangeMin);
}

function shortLabel(value: string, max = 24): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}.`;
}

function numericExtent(values: readonly number[], pad = 0.08): [number, number] {
  if (!values.length) return [0, 1];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    const padding = Math.max(1, Math.abs(min) * 0.1);
    return [min - padding, max + padding];
  }
  const padding = (max - min) * pad;
  return [min - padding, max + padding];
}

function heatColor(value: number | null, min: number, max: number): string {
  if (value === null || !Number.isFinite(value)) return "#f1f5f9";
  const t = clamp((value - min) / Math.max(0.001, max - min), 0, 1);
  if (t < 0.5) {
    const local = t / 0.5;
    const r = Math.round(219 + (251 - 219) * local);
    const g = Math.round(234 + (191 - 234) * local);
    const b = Math.round(254 + (36 - 254) * local);
    return `rgb(${r},${g},${b})`;
  }
  const local = (t - 0.5) / 0.5;
  const r = Math.round(251 + (185 - 251) * local);
  const g = Math.round(191 + (28 - 191) * local);
  const b = Math.round(36 + (28 - 36) * local);
  return `rgb(${r},${g},${b})`;
}

function diffColor(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "#94a3b8";
  if (value >= 20) return "#b91c1c";
  if (value >= 5) return "#f97316";
  if (value <= -20) return "#1d4ed8";
  if (value <= -5) return "#38bdf8";
  return "#64748b";
}

function svgShell(title: string, subtitle: string, body: string, width = WIDTH, height = HEIGHT): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}">`,
    "<rect width=\"100%\" height=\"100%\" rx=\"10\" fill=\"#ffffff\"/>",
    "<rect x=\"1\" y=\"1\" width=\"718\" height=\"358\" rx=\"10\" fill=\"none\" stroke=\"#cbd5e1\"/>",
    `<text x="24" y="30" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="700" fill="#111827">${escapeXml(title)}</text>`,
    subtitle ? `<text x="24" y="52" font-family="Arial, Helvetica, sans-serif" font-size="11" fill="#64748b">${escapeXml(subtitle)}</text>` : "",
    body,
    "</svg>",
  ].join("");
}

function axisFrame(yLabel = "PM2.5 ug/m3"): string {
  const x0 = PLOT.left;
  const y0 = HEIGHT - PLOT.bottom;
  const x1 = WIDTH - PLOT.right;
  const y1 = PLOT.top;
  return [
    `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y0}" stroke="#334155" stroke-width="1"/>`,
    `<line x1="${x0}" y1="${y0}" x2="${x0}" y2="${y1}" stroke="#334155" stroke-width="1"/>`,
    `<text x="24" y="${PLOT.top + 8}" font-family="Arial, Helvetica, sans-serif" font-size="10" fill="#64748b">${escapeXml(yLabel)}</text>`,
  ].join("");
}

function placeholderFigure(label: string, reason: string): GeneratedReportFigure {
  const body = [
    "<rect x=\"64\" y=\"102\" width=\"592\" height=\"156\" rx=\"8\" fill=\"#f8fafc\" stroke=\"#cbd5e1\" stroke-dasharray=\"8 6\"/>",
    `<text x="360" y="153" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="700" fill="#475569">${escapeXml(label)}</text>`,
    `<text x="360" y="184" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="13" fill="#64748b">${escapeXml(reason)}</text>`,
  ].join("");
  return {
    svg: svgShell(label, "Figure placeholder", body),
    altText: `${label}. ${reason}`,
    caption: `${label}. Placeholder: ${reason}`,
    width: WIDTH,
    height: HEIGHT,
    status: "placeholder",
  };
}

function sensorMetricById(summary: ReportNetworkSummary): Map<string, ReportSensorMetrics> {
  return new Map(summary.sensorMetrics.map((metric) => [metric.sensorId, metric]));
}

function renderSensorMap(plan: ReportGenerationPlan, summary: ReportNetworkSummary, label: string): GeneratedReportFigure {
  const metrics = sensorMetricById(summary);
  const points = plan.sensors
    .filter((sensor) => Number.isFinite(sensor.latitude) && Number.isFinite(sensor.longitude))
    .map((sensor) => ({
      label: sensor.label,
      lat: sensor.latitude,
      lon: sensor.longitude,
      meanPm25: metrics.get(sensor.id)?.meanPm25 ?? null,
    }));
  if (!points.length) return placeholderFigure(label, "Needs selected sensors with coordinates.");
  const [lonMin, lonMax] = numericExtent(points.map((point) => point.lon), 0.14);
  const [latMin, latMax] = numericExtent(points.map((point) => point.lat), 0.14);
  const means = points.map((point) => point.meanPm25).filter(isFiniteNumber);
  const [meanMin, meanMax] = numericExtent(means);
  const body = [
    "<rect x=\"70\" y=\"76\" width=\"580\" height=\"220\" fill=\"#f8fafc\" stroke=\"#cbd5e1\"/>",
    ...[0.25, 0.5, 0.75].flatMap((ratio) => {
      const x = 70 + 580 * ratio;
      const y = 76 + 220 * ratio;
      return [
        `<line x1="${x}" y1="76" x2="${x}" y2="296" stroke="#e2e8f0"/>`,
        `<line x1="70" y1="${y}" x2="650" y2="${y}" stroke="#e2e8f0"/>`,
      ];
    }),
    ...points.map((point, index) => {
      const x = scale(point.lon, lonMin, lonMax, 90, 630);
      const y = scale(point.lat, latMin, latMax, 276, 96);
      const fill = heatColor(point.meanPm25, meanMin, meanMax);
      return [
        `<circle cx="${x}" cy="${y}" r="9" fill="${fill}" stroke="#0f172a" stroke-width="1.2"/>`,
        `<text x="${x + 12}" y="${y + 4}" font-family="Arial, Helvetica, sans-serif" font-size="10" fill="#111827">${escapeXml(shortLabel(point.label, 18))}</text>`,
        `<text x="${x}" y="${y + 24}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="9" fill="#475569">${index + 1}</text>`,
      ].join("");
    }),
    "<text x=\"70\" y=\"320\" font-family=\"Arial, Helvetica, sans-serif\" font-size=\"10\" fill=\"#64748b\">Relative sensor position from selected coordinates; color follows mean PM2.5.</text>",
  ].join("");
  return readyFigure(label, "Coordinate plot generated from selected sensor inventory.", body);
}

function renderMonthlyTile(summary: ReportNetworkSummary, label: string, valueKey: "meanPm25" | "p98DailyPm25"): GeneratedReportFigure {
  const sensors = summary.sensorMetrics;
  const months = [...new Set(sensors.flatMap((metric) => metric.monthly.map((month) => month.month)))].sort();
  if (!sensors.length || !months.length) return placeholderFigure(label, "Needs monthly metrics.");
  const values = sensors.flatMap((metric) => metric.monthly.map((month) => month[valueKey]).filter(isFiniteNumber));
  const [min, max] = numericExtent(values);
  const left = 150;
  const top = 82;
  const cellW = Math.min(92, (WIDTH - left - 38) / Math.max(months.length, 1));
  const cellH = Math.min(26, (HEIGHT - top - 72) / Math.max(sensors.length, 1));
  const monthBySensor = new Map(sensors.map((metric) => [metric.sensorId, new Map(metric.monthly.map((month) => [month.month, month]))]));
  const body = [
    ...months.map((month, index) => `<text x="${left + index * cellW + cellW / 2}" y="${top - 12}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="10" fill="#475569">${escapeXml(month.slice(5))}</text>`),
    ...sensors.map((metric, rowIndex) => `<text x="${left - 10}" y="${top + rowIndex * cellH + cellH * 0.65}" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="10" fill="#111827">${escapeXml(shortLabel(metric.label, 19))}</text>`),
    ...sensors.flatMap((metric, rowIndex) => months.map((month, columnIndex) => {
      const value = monthBySensor.get(metric.sensorId)?.get(month)?.[valueKey] ?? null;
      const x = left + columnIndex * cellW;
      const y = top + rowIndex * cellH;
      return [
        `<rect x="${x}" y="${y}" width="${cellW - 2}" height="${cellH - 2}" fill="${heatColor(value, min, max)}" stroke="#ffffff"/>`,
        value !== null ? `<text x="${x + cellW / 2}" y="${y + cellH * 0.65}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="9" fill="#0f172a">${round(value, 0)}</text>` : "",
      ].join("");
    })),
    `<text x="${left}" y="${HEIGHT - 28}" font-family="Arial, Helvetica, sans-serif" font-size="10" fill="#64748b">Darker warm colors indicate higher ${valueKey === "meanPm25" ? "monthly mean" : "monthly 98th percentile daily"} PM2.5.</text>`,
  ].join("");
  return readyFigure(label, "Monthly tile plot generated from valid daily sensor metrics.", body);
}

function renderDiurnal(summary: ReportNetworkSummary, label: string): GeneratedReportFigure {
  const grouped = new Map<ReportSeason, Map<number, number[]>>();
  for (const metric of summary.sensorMetrics) {
    for (const row of metric.diurnalProfiles) {
      if (row.meanPm25 === null) continue;
      const byHour = grouped.get(row.season) ?? new Map<number, number[]>();
      const values = byHour.get(row.hour) ?? [];
      values.push(row.meanPm25);
      byHour.set(row.hour, values);
      grouped.set(row.season, byHour);
    }
  }
  const series = SEASONS.map((season) => ({
    season,
    points: [...(grouped.get(season)?.entries() ?? [])]
      .map(([hour, values]) => ({ hour, value: mean(values) }))
      .filter((point): point is { hour: number; value: number } => point.value !== null)
      .sort((left, right) => left.hour - right.hour),
  })).filter((item) => item.points.length);
  if (!series.length) return placeholderFigure(label, "Needs hourly PM2.5 by season.");
  const allValues = series.flatMap((item) => item.points.map((point) => point.value));
  const [, max] = numericExtent(allValues);
  const yMax = Math.max(1, max);
  const body = [
    axisFrame(),
    ...[0, 6, 12, 18, 23].map((hour) => {
      const x = scale(hour, 0, 23, PLOT.left, WIDTH - PLOT.right);
      return `<text x="${x}" y="${HEIGHT - 36}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="10" fill="#64748b">${hour}</text>`;
    }),
    ...series.map((item) => {
      const path = item.points.map((point, index) => {
        const x = scale(point.hour, 0, 23, PLOT.left, WIDTH - PLOT.right);
        const y = scale(point.value, 0, yMax, HEIGHT - PLOT.bottom, PLOT.top + 8);
        return `${index === 0 ? "M" : "L"} ${round(x, 2)} ${round(y, 2)}`;
      }).join(" ");
      return `<path d="${path}" fill="none" stroke="${SEASON_COLORS[item.season]}" stroke-width="2.5"/>`;
    }),
    ...series.map((item, index) => `<circle cx="${PLOT.left + index * 92}" cy="${HEIGHT - 18}" r="5" fill="${SEASON_COLORS[item.season]}"/><text x="${PLOT.left + index * 92 + 10}" y="${HEIGHT - 14}" font-family="Arial, Helvetica, sans-serif" font-size="10" fill="#475569">${item.season}</text>`),
  ].join("");
  return readyFigure(label, "Network seasonal diurnal profile generated from valid hourly PM2.5.", body);
}

function renderWeekday(summary: ReportNetworkSummary, label: string): GeneratedReportFigure {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const buckets = days.map(() => [] as number[]);
  const dates = new Set(summary.sensorMetrics.flatMap((metric) => metric.daily.map((day) => day.date)));
  for (const date of dates) {
    const values = summary.sensorMetrics
      .map((metric) => metric.daily.find((day) => day.date === date)?.meanPm25 ?? null)
      .filter(isFiniteNumber);
    const value = mean(values);
    if (value !== null) buckets[new Date(`${date}T00:00:00.000Z`).getUTCDay()].push(value);
  }
  const rows = buckets.map((values, index) => ({ day: days[index], value: mean(values) }));
  if (!rows.some((row) => row.value !== null)) return placeholderFigure(label, "Needs daily valid PM2.5 values.");
  return renderBarFigure(label, "Network daily mean by weekday.", rows.map((row) => ({
    label: row.day,
    value: row.value,
    color: "#2563eb",
  })), "PM2.5 ug/m3");
}

function renderCorrelation(summary: ReportNetworkSummary, label: string): GeneratedReportFigure {
  const metrics = summary.sensorMetrics;
  if (metrics.length < 2) return placeholderFigure(label, "Needs at least two sensors with valid daily means.");
  const size = Math.min(24, (HEIGHT - 142) / metrics.length, (WIDTH - 250) / metrics.length);
  const left = 170;
  const top = 112;
  const body = [
    ...metrics.map((metric, index) => `<text x="${left - 8}" y="${top + index * size + size * 0.65}" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="9" fill="#111827">${escapeXml(shortLabel(metric.label, 20))}</text>`),
    ...metrics.map((metric, index) => `<text transform="translate(${left + index * size + size * 0.62} ${top - 8}) rotate(-45)" font-family="Arial, Helvetica, sans-serif" font-size="9" fill="#111827">${escapeXml(shortLabel(metric.label, 13))}</text>`),
    ...metrics.flatMap((leftMetric, rowIndex) => metrics.map((rightMetric, columnIndex) => {
      const value = correlation(leftMetric, rightMetric);
      const fill = value === null ? "#f1f5f9" : heatColor((value + 1) / 2, 0, 1);
      return `<rect x="${left + columnIndex * size}" y="${top + rowIndex * size}" width="${size - 1}" height="${size - 1}" fill="${fill}" stroke="#ffffff"/>`;
    })),
    "<text x=\"170\" y=\"330\" font-family=\"Arial, Helvetica, sans-serif\" font-size=\"10\" fill=\"#64748b\">Color scale ranges from weak/negative association to strong positive association.</text>",
  ].join("");
  return readyFigure(label, "Correlation matrix generated from aligned valid daily PM2.5 values.", body);
}

function correlation(left: ReportSensorMetrics, right: ReportSensorMetrics): number | null {
  const rightByDate = new Map(right.daily.map((day) => [day.date, day.meanPm25]));
  const pairs = left.daily
    .map((day) => [day.meanPm25, rightByDate.get(day.date)] as const)
    .filter((pair): pair is readonly [number, number] => isFiniteNumber(pair[0]) && isFiniteNumber(pair[1]));
  if (pairs.length < 2) return null;
  const leftMean = mean(pairs.map((pair) => pair[0])) ?? 0;
  const rightMean = mean(pairs.map((pair) => pair[1])) ?? 0;
  const numerator = pairs.reduce((total, [leftValue, rightValue]) => total + (leftValue - leftMean) * (rightValue - rightMean), 0);
  const leftDenominator = Math.sqrt(pairs.reduce((total, [leftValue]) => total + (leftValue - leftMean) ** 2, 0));
  const rightDenominator = Math.sqrt(pairs.reduce((total, [, rightValue]) => total + (rightValue - rightMean) ** 2, 0));
  return leftDenominator && rightDenominator ? numerator / (leftDenominator * rightDenominator) : null;
}

function renderBoxplot(summary: ReportNetworkSummary, label: string): GeneratedReportFigure {
  const rows = summary.sensorMetrics.map((metric) => {
    const values = metric.daily.map((day) => day.meanPm25).filter(isFiniteNumber);
    return {
      label: metric.label,
      min: percentile(values, 0),
      q1: percentile(values, 0.25),
      median: percentile(values, 0.5),
      q3: percentile(values, 0.75),
      max: percentile(values, 1),
    };
  }).filter((row) => row.median !== null);
  if (!rows.length) return placeholderFigure(label, "Needs daily valid PM2.5 values.");
  const values = rows.flatMap((row) => [row.min, row.q1, row.median, row.q3, row.max]).filter(isFiniteNumber);
  const [min, max] = numericExtent(values);
  const rowH = Math.min(26, (HEIGHT - 106) / rows.length);
  const x0 = 170;
  const x1 = WIDTH - 34;
  const top = 78;
  const body = [
    `<line x1="${x0}" y1="${HEIGHT - 42}" x2="${x1}" y2="${HEIGHT - 42}" stroke="#334155"/>`,
    `<text x="${x0}" y="${HEIGHT - 24}" font-family="Arial, Helvetica, sans-serif" font-size="10" fill="#64748b">${round(min)}</text>`,
    `<text x="${x1}" y="${HEIGHT - 24}" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="10" fill="#64748b">${round(max)} ug/m3</text>`,
    ...rows.map((row, index) => {
      const y = top + index * rowH + rowH / 2;
      const minX = scale(row.min ?? 0, min, max, x0, x1);
      const q1X = scale(row.q1 ?? 0, min, max, x0, x1);
      const medX = scale(row.median ?? 0, min, max, x0, x1);
      const q3X = scale(row.q3 ?? 0, min, max, x0, x1);
      const maxX = scale(row.max ?? 0, min, max, x0, x1);
      return [
        `<text x="${x0 - 8}" y="${y + 4}" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="10" fill="#111827">${escapeXml(shortLabel(row.label, 20))}</text>`,
        `<line x1="${minX}" y1="${y}" x2="${maxX}" y2="${y}" stroke="#64748b"/>`,
        `<rect x="${q1X}" y="${y - 7}" width="${Math.max(2, q3X - q1X)}" height="14" fill="#dbeafe" stroke="#1d4ed8"/>`,
        `<line x1="${medX}" y1="${y - 9}" x2="${medX}" y2="${y + 9}" stroke="#1e3a8a" stroke-width="2"/>`,
      ].join("");
    }),
  ].join("");
  return readyFigure(label, "Daily distribution boxplots generated from valid daily PM2.5.", body);
}

function renderPercentRanking(label: string, rows: readonly ReportSensorPercentDifference[], caption: string): GeneratedReportFigure {
  const values = rows.map((row) => row.percentDifference).filter(isFiniteNumber);
  if (!values.length) return placeholderFigure(label, "Needs sensor percent differences.");
  const [min, max] = numericExtent([...values, 0], 0.12);
  const sorted = [...rows].filter((row) => row.percentDifference !== null).sort((left, right) => (right.percentDifference ?? 0) - (left.percentDifference ?? 0));
  const rowH = Math.min(25, (HEIGHT - 112) / sorted.length);
  const x0 = 190;
  const x1 = WIDTH - 40;
  const zeroX = scale(0, min, max, x0, x1);
  const body = [
    `<line x1="${zeroX}" y1="74" x2="${zeroX}" y2="${HEIGHT - 48}" stroke="#334155" stroke-dasharray="4 4"/>`,
    ...sorted.map((row, index) => {
      const y = 82 + index * rowH;
      const value = row.percentDifference ?? 0;
      const x = scale(value, min, max, x0, x1);
      return [
        `<text x="${x0 - 8}" y="${y + 4}" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="10" fill="#111827">${escapeXml(shortLabel(row.label, 20))}</text>`,
        `<line x1="${zeroX}" y1="${y}" x2="${x}" y2="${y}" stroke="${diffColor(value)}" stroke-width="4" stroke-linecap="round"/>`,
        `<circle cx="${x}" cy="${y}" r="5" fill="${diffColor(value)}"/>`,
        `<text x="${x + (value >= 0 ? 8 : -8)}" y="${y + 4}" text-anchor="${value >= 0 ? "start" : "end"}" font-family="Arial, Helvetica, sans-serif" font-size="10" fill="#334155">${round(value)}%</text>`,
      ].join("");
    }),
    `<text x="${x0}" y="${HEIGHT - 22}" font-family="Arial, Helvetica, sans-serif" font-size="10" fill="#64748b">${escapeXml(caption)}</text>`,
  ].join("");
  return readyFigure(label, caption, body);
}

function renderSeasonalPercentRanking(summary: ReportNetworkSummary, label: string): GeneratedReportFigure {
  const seasonMeans = new Map<string, { sensorId: string; label: string; value: number }[]>();
  for (const metric of summary.sensorMetrics) {
    const grouped = new Map<string, number[]>();
    for (const day of metric.daily) {
      if (day.meanPm25 === null) continue;
      const key = seasonKey(day.date);
      const values = grouped.get(key) ?? [];
      values.push(day.meanPm25);
      grouped.set(key, values);
    }
    for (const [key, values] of grouped) {
      const existing = seasonMeans.get(key) ?? [];
      const value = mean(values);
      if (value !== null) existing.push({ sensorId: metric.sensorId, label: metric.label, value });
      seasonMeans.set(key, existing);
    }
  }
  const bySensor = new Map<string, { label: string; differences: number[] }>();
  for (const rows of seasonMeans.values()) {
    const network = mean(rows.map((row) => row.value));
    if (network === null || network === 0) continue;
    for (const row of rows) {
      const existing = bySensor.get(row.sensorId) ?? { label: row.label, differences: [] };
      existing.differences.push(((row.value - network) / network) * 100);
      bySensor.set(row.sensorId, existing);
    }
  }
  const rows = [...bySensor.entries()].map(([sensorId, row]) => ({
    sensorId,
    label: row.label,
    meanPm25: null,
    percentDifference: mean(row.differences),
  }));
  return renderPercentRanking(label, rows, "Average seasonal percent difference from same-season network mean.");
}

function seasonKey(date: string): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const season = month === 12 || month <= 2 ? "winter" : month <= 5 ? "spring" : month <= 8 ? "summer" : "fall";
  return `${month === 12 ? year : month <= 2 ? year - 1 : year}:${season}`;
}

function renderIdw(plan: ReportGenerationPlan, summary: ReportNetworkSummary, label: string): GeneratedReportFigure {
  const metrics = sensorMetricById(summary);
  const points = plan.sensors
    .map((sensor) => ({
      label: sensor.label,
      lat: sensor.latitude,
      lon: sensor.longitude,
      value: metrics.get(sensor.id)?.meanPm25 ?? null,
    }))
    .filter((point): point is { label: string; lat: number; lon: number; value: number } => (
      Number.isFinite(point.lat) && Number.isFinite(point.lon) && isFiniteNumber(point.value)
    ));
  if (points.length < 3) return placeholderFigure(label, "Needs at least three selected sensors with coordinates and valid means.");
  const [lonMin, lonMax] = numericExtent(points.map((point) => point.lon), 0.18);
  const [latMin, latMax] = numericExtent(points.map((point) => point.lat), 0.18);
  const [valueMin, valueMax] = numericExtent(points.map((point) => point.value));
  const left = 72;
  const top = 72;
  const width = 580;
  const height = 230;
  const columns = 24;
  const rows = 12;
  const grid = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const lon = scale(column + 0.5, 0, columns, lonMin, lonMax);
      const lat = scale(row + 0.5, rows, 0, latMin, latMax);
      const value = idwValue(points, lon, lat);
      grid.push(`<rect x="${left + (column * width) / columns}" y="${top + (row * height) / rows}" width="${width / columns + 0.5}" height="${height / rows + 0.5}" fill="${heatColor(value, valueMin, valueMax)}"/>`);
    }
  }
  const body = [
    `<rect x="${left}" y="${top}" width="${width}" height="${height}" fill="#f8fafc" stroke="#cbd5e1"/>`,
    ...grid,
    ...points.map((point) => {
      const x = scale(point.lon, lonMin, lonMax, left + 12, left + width - 12);
      const y = scale(point.lat, latMin, latMax, top + height - 12, top + 12);
      return `<circle cx="${x}" cy="${y}" r="5" fill="#0f172a" stroke="#ffffff" stroke-width="1.5"><title>${escapeXml(point.label)}</title></circle>`;
    }),
    `<text x="${left}" y="326" font-family="Arial, Helvetica, sans-serif" font-size="10" fill="#64748b">IDW-style surface from selected sensor means; darker warm colors indicate higher PM2.5.</text>`,
  ].join("");
  return readyFigure(label, "IDW-style hotspot/coldspot surface generated from coordinates and sensor means.", body);
}

function idwValue(points: readonly { lat: number; lon: number; value: number }[], lon: number, lat: number): number {
  let numerator = 0;
  let denominator = 0;
  for (const point of points) {
    const distance = Math.max(0.00001, Math.hypot(point.lon - lon, point.lat - lat));
    const weight = 1 / distance ** 2;
    numerator += point.value * weight;
    denominator += weight;
  }
  return numerator / denominator;
}

function renderDataCapture(summary: ReportNetworkSummary, label: string): GeneratedReportFigure {
  const rows = summary.sensorMetrics.map((metric) => ({
    label: metric.label,
    value: metric.dailyCaptureFraction * 100,
    color: metric.dailyCaptureFraction >= 0.75 ? "#16a34a" : "#f97316",
  }));
  return renderBarFigure(label, "Report-period valid daily capture by sensor.", rows, "Capture %", 100);
}

function renderTimeseries(summary: ReportNetworkSummary, label: string): GeneratedReportFigure {
  const dates = [...new Set(summary.sensorMetrics.flatMap((metric) => metric.daily.map((day) => day.date)))].sort();
  const points = dates.map((date) => {
    const values = summary.sensorMetrics
      .map((metric) => metric.daily.find((day) => day.date === date)?.meanPm25 ?? null)
      .filter(isFiniteNumber);
    return { date, value: mean(values) };
  }).filter((point): point is { date: string; value: number } => point.value !== null);
  if (points.length < 2) return placeholderFigure(label, "Needs at least two valid daily network means.");
  const [, max] = numericExtent(points.map((point) => point.value));
  const yMax = Math.max(1, max);
  const path = points.map((point, index) => {
    const x = scale(index, 0, points.length - 1, PLOT.left, WIDTH - PLOT.right);
    const y = scale(point.value, 0, yMax, HEIGHT - PLOT.bottom, PLOT.top + 8);
    return `${index === 0 ? "M" : "L"} ${round(x, 2)} ${round(y, 2)}`;
  }).join(" ");
  const body = [
    axisFrame(),
    `<path d="${path}" fill="none" stroke="#2563eb" stroke-width="2.5"/>`,
    `<text x="${PLOT.left}" y="${HEIGHT - 28}" font-family="Arial, Helvetica, sans-serif" font-size="10" fill="#64748b">${escapeXml(points[0].date)}</text>`,
    `<text x="${WIDTH - PLOT.right}" y="${HEIGHT - 28}" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="10" fill="#64748b">${escapeXml(points.at(-1)?.date ?? "")}</text>`,
  ].join("");
  return readyFigure(label, "Daily network PM2.5 timeseries generated from valid daily means.", body);
}

function renderWind(plan: ReportGenerationPlan, label: string): GeneratedReportFigure {
  const sectors = plan.options.sourceAttribution.sectors;
  if (!sectors.length) return placeholderFigure(label, "Needs directional source sectors.");
  const cx = 360;
  const cy = 190;
  const radius = 92;
  const body = [
    `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="#f8fafc" stroke="#cbd5e1"/>`,
    "<text x=\"360\" y=\"88\" text-anchor=\"middle\" font-family=\"Arial, Helvetica, sans-serif\" font-size=\"11\" fill=\"#64748b\">Configured source-sector context</text>",
    ...["N", "E", "S", "W"].map((direction, index) => {
      const angle = (index * 90 - 90) * Math.PI / 180;
      const x = cx + Math.cos(angle) * (radius + 22);
      const y = cy + Math.sin(angle) * (radius + 22) + 4;
      return `<text x="${x}" y="${y}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="12" font-weight="700" fill="#475569">${direction}</text>`;
    }),
    ...sectors.map((sector, index) => {
      const angle = directionAngle(sector.direction, index, sectors.length);
      const radians = (angle - 90) * Math.PI / 180;
      const x = cx + Math.cos(radians) * radius;
      const y = cy + Math.sin(radians) * radius;
      return [
        `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#dc2626" stroke-width="4" stroke-linecap="round"/>`,
        `<circle cx="${x}" cy="${y}" r="7" fill="#dc2626"/>`,
        `<text x="${cx + Math.cos(radians) * (radius + 44)}" y="${cy + Math.sin(radians) * (radius + 44)}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="10" fill="#111827">${escapeXml(shortLabel(sector.label ?? sector.sourceType, 18))}</text>`,
      ].join("");
    }),
    `<text x="360" y="326" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="10" fill="#64748b">Hotspot sensor: ${escapeXml(plan.options.sourceAttribution.hotspotSensorLabel ?? plan.options.sourceAttribution.hotspotSensorId ?? "not specified")}; wind source: ${escapeXml(plan.options.sourceAttribution.windSourceLabel ?? "not specified")}.</text>`,
  ].join("");
  return readyFigure(label, "Directional source-sector chart generated from configured attribution inputs.", body);
}

function directionAngle(direction: string, index: number, count: number): number {
  const normalized = direction.trim().toLowerCase();
  const lookup: Record<string, number> = {
    north: 0,
    northeast: 45,
    east: 90,
    southeast: 135,
    south: 180,
    southwest: 225,
    west: 270,
    northwest: 315,
  };
  return lookup[normalized] ?? (index / Math.max(1, count)) * 360;
}

function renderBarFigure(label: string, subtitle: string, rows: readonly { label: string; value: number | null; color: string }[], axisLabel: string, fixedMax?: number): GeneratedReportFigure {
  const valid = rows.filter((row): row is { label: string; value: number; color: string } => row.value !== null && Number.isFinite(row.value));
  if (!valid.length) return placeholderFigure(label, "Needs values.");
  const max = fixedMax ?? Math.max(...valid.map((row) => row.value), 1);
  const rowH = Math.min(26, (HEIGHT - 116) / valid.length);
  const x0 = 170;
  const x1 = WIDTH - 46;
  const body = [
    `<line x1="${x0}" y1="${HEIGHT - 42}" x2="${x1}" y2="${HEIGHT - 42}" stroke="#334155"/>`,
    `<text x="${x1}" y="${HEIGHT - 24}" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="10" fill="#64748b">${escapeXml(axisLabel)}</text>`,
    ...valid.map((row, index) => {
      const y = 84 + index * rowH;
      const w = scale(row.value, 0, max, 0, x1 - x0);
      return [
        `<text x="${x0 - 8}" y="${y + 4}" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="10" fill="#111827">${escapeXml(shortLabel(row.label, 20))}</text>`,
        `<rect x="${x0}" y="${y - 9}" width="${w}" height="16" fill="${row.color}" rx="3"/>`,
        `<text x="${x0 + w + 6}" y="${y + 4}" font-family="Arial, Helvetica, sans-serif" font-size="10" fill="#334155">${round(row.value)}</text>`,
      ].join("");
    }),
  ].join("");
  return readyFigure(label, subtitle, body);
}

function readyFigure(label: string, caption: string, body: string): GeneratedReportFigure {
  return {
    svg: svgShell(label, caption, body),
    altText: `${label}. ${caption}`,
    caption,
    width: WIDTH,
    height: HEIGHT,
    status: "ready",
  };
}

export function buildReportFigure(
  plan: ReportGenerationPlan,
  summary: ReportNetworkSummary,
  figure: ReportFigureSpec,
): GeneratedReportFigure {
  const readiness = summary.figureReadiness.find((item) => item.figureId === figure.id);
  if (!readiness?.ready) {
    return placeholderFigure(figure.label, readiness?.reason ?? "Additional input required.");
  }

  switch (figure.id) {
    case "sensor-location-map":
      return renderSensorMap(plan, summary, figure.label);
    case "monthly-mean-tile":
      return renderMonthlyTile(summary, figure.label, "meanPm25");
    case "monthly-p98-tile":
      return renderMonthlyTile(summary, figure.label, "p98DailyPm25");
    case "seasonal-diurnal":
    case "diurnal-wildfire-comparison":
      return renderDiurnal(summary, figure.label);
    case "weekday-pattern":
      return renderWeekday(summary, figure.label);
    case "sensor-correlation":
      return renderCorrelation(summary, figure.label);
    case "daily-distribution-boxplot":
      return renderBoxplot(summary, figure.label);
    case "percent-difference-ranking":
      return renderPercentRanking(figure.label, summary.percentDifferences, "Percent difference from the selected-sensor network mean.");
    case "seasonal-percent-difference-ranking":
      return renderSeasonalPercentRanking(summary, figure.label);
    case "annual-idw":
    case "seasonal-idw":
      return renderIdw(plan, summary, figure.label);
    case "wind-contribution":
      return renderWind(plan, figure.label);
    case "data-capture":
      return renderDataCapture(summary, figure.label);
    case "full-timeseries":
      return renderTimeseries(summary, figure.label);
    default:
      return placeholderFigure(figure.label, "No deterministic renderer is available for this figure yet.");
  }
}
