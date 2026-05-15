import { pasPalette, pasSlicePm25, pm25ToAqiBand, type PasPm25Slice, type PasRecord } from "@patool/shared";
import type maplibregl from "maplibre-gl";

import { appPath } from "../../lib/routing";
import { MISSING_PM_COLOR } from "./config";
import type { Pm25Window, SensorMapMetric } from "./types";

export function getPm25ValueForWindow(record: PasRecord, window: Pm25Window): number | null {
  const value = record[window] ?? record.pm25Current;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function getPm25ValueForSlice(record: PasRecord, window: Pm25Window, slice: PasPm25Slice): number | null {
  return slice === "current" ? getPm25ValueForWindow(record, window) : pasSlicePm25(record, slice);
}

function formatPopupValue(value: unknown, suffix = ""): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${numeric.toFixed(1)}${suffix}` : "Unavailable";
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function popupRow(label: string, value: unknown): string {
  return `<tr><th style="padding:2px 8px 2px 0;text-align:left;color:#64748b;font-weight:500">${escapeHtml(label)}</th><td style="padding:2px 0;text-align:right">${escapeHtml(value)}</td></tr>`;
}

function valueFromPalette(value: number | null, metric: SensorMapMetric): { color: string; label: string; aqi?: number } {
  if (value === null) return { color: MISSING_PM_COLOR, label: "Unavailable" };
  if (metric === "pm25") {
    const band = pm25ToAqiBand(value);
    return { color: band.color, label: band.label, aqi: band.aqi ?? undefined };
  }
  const palette = pasPalette(metric);
  const index = Math.max(0, palette.breaks.findIndex((breakpoint, i) => (
    i < palette.breaks.length - 1 && value >= breakpoint && value < palette.breaks[i + 1]
  )));
  const clampedIndex = index >= 0 ? Math.min(index, palette.colors.length - 1) : palette.colors.length - 1;
  return {
    color: palette.colors[clampedIndex],
    label: palette.labels[clampedIndex] ?? "Measured",
  };
}

function getMetricValue(record: PasRecord, metric: SensorMapMetric, pm25Window: Pm25Window, pm25Slice: PasPm25Slice): number | null {
  if (metric === "humidity") {
    return typeof record.humidity === "number" && Number.isFinite(record.humidity) ? record.humidity : null;
  }
  if (metric === "temperature") {
    return typeof record.temperature === "number" && Number.isFinite(record.temperature) ? record.temperature : null;
  }
  return getPm25ValueForSlice(record, pm25Window, pm25Slice);
}

export function buildSensorPopupHtml(props: maplibregl.GeoJSONFeature["properties"]): string {
  const bandText = props.aqi === "NA" ? props.bandLabel : `${props.bandLabel} · AQI ${props.aqi}`;
  const sensorPathId = encodeURIComponent(String(props.id ?? ""));
  const rows = [
    popupRow("Mapped metric", props.metricLabel),
    popupRow("Selected", props.metricValue === "NA" ? "Unavailable" : `${props.metricValue}${props.metricUnit}`),
    popupRow("Band", bandText),
    popupRow("Current", formatPopupValue(props.pm25Current, " ug/m3")),
    popupRow("1 hr", formatPopupValue(props.pm25_1hr, " ug/m3")),
    popupRow("1 day", formatPopupValue(props.pm25_1day, " ug/m3")),
    popupRow("Humidity", formatPopupValue(props.humidity, "%")),
    popupRow("Temp", formatPopupValue(props.temperature, " F")),
    popupRow("Pressure", formatPopupValue(props.pressure, " hPa")),
  ].join("");

  return (
    `<div style="min-width:220px">`
    + `<strong>${escapeHtml(props.label)}</strong>`
    + `<div style="margin:4px 0 6px;color:#475569">${escapeHtml(props.locationType)} · ${escapeHtml(props.stateCode)}</div>`
    + `<table style="width:100%;border-collapse:collapse;font-size:12px">${rows}</table>`
    + `<div style="margin-top:8px">`
    + `<a href="${appPath(`/sensor/${sensorPathId}`)}">Sensor detail</a> | `
    + `<a href="${appPath(`/diagnostics/${sensorPathId}`)}">Diagnostics</a>`
    + `</div>`
    + `</div>`
  );
}

export function buildGeoJson(
  records: PasRecord[],
  pm25Window: Pm25Window,
  metric: SensorMapMetric = "pm25",
  pm25Slice: PasPm25Slice = "current",
): GeoJSON.FeatureCollection {
  const sortedRecords = [...records].sort((left, right) => {
    const leftValue = getMetricValue(left, metric, pm25Window, pm25Slice) ?? -Infinity;
    const rightValue = getMetricValue(right, metric, pm25Window, pm25Slice) ?? -Infinity;
    return leftValue - rightValue;
  });

  return {
    type: "FeatureCollection",
    features: sortedRecords.map((r) => {
      const pm25 = getPm25ValueForSlice(r, pm25Window, pm25Slice);
      const metricValue = getMetricValue(r, metric, pm25Window, pm25Slice);
      const band = pm25ToAqiBand(pm25);
      const metricBand = valueFromPalette(metricValue, metric);
      const metricUnit = metric === "humidity" ? "%" : metric === "temperature" ? " F" : " ug/m3";

      return {
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [r.longitude, r.latitude],
        },
        properties: {
          id: r.id,
          label: r.label,
          metric,
          metricLabel: metric === "humidity" ? "Humidity" : metric === "temperature" ? "Temperature" : "PM2.5",
          pm25Slice,
          metricValue: metricValue?.toFixed(2) ?? "NA",
          metricUnit,
          pm25: pm25?.toFixed(2) ?? "NA",
          color: metricBand.color,
          bandLabel: metric === "pm25" ? band.label : metricBand.label,
          aqi: metric === "pm25" ? band.aqi ?? "NA" : "NA",
          pm25Current: r.pm25Current ?? "NA",
          pm25_10min: r.pm25_10min ?? "NA",
          pm25_30min: r.pm25_30min ?? "NA",
          pm25_1hr: r.pm25_1hr ?? "NA",
          pm25_6hr: r.pm25_6hr ?? "NA",
          pm25_1day: r.pm25_1day ?? "NA",
          pm25_1week: r.pm25_1week ?? "NA",
          humidity: r.humidity ?? "NA",
          pressure: r.pressure ?? "NA",
          temperature: r.temperature ?? "NA",
          locationType: r.locationType,
          stateCode: r.stateCode ?? "NA",
        },
      };
    }),
  };
}
