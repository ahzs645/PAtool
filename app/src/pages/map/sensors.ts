import { pm25ToAqiBand, type PasRecord } from "@patool/shared";
import type maplibregl from "maplibre-gl";

import { appPath } from "../../lib/routing";
import { MISSING_PM_COLOR } from "./config";
import type { Pm25Window } from "./types";

export function getPm25ValueForWindow(record: PasRecord, window: Pm25Window): number | null {
  const value = record[window] ?? record.pm25Current;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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

export function buildSensorPopupHtml(props: maplibregl.GeoJSONFeature["properties"]): string {
  const bandText = props.aqi === "NA" ? props.bandLabel : `${props.bandLabel} · AQI ${props.aqi}`;
  const sensorPathId = encodeURIComponent(String(props.id ?? ""));
  const rows = [
    popupRow("Selected", props.pm25 === "NA" ? "PM2.5 unavailable" : `${props.pm25} ug/m3`),
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
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: records.map((r) => {
      const pm25 = getPm25ValueForWindow(r, pm25Window);
      const band = pm25ToAqiBand(pm25);

      return {
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [r.longitude, r.latitude],
        },
        properties: {
          id: r.id,
          label: r.label,
          pm25: pm25?.toFixed(2) ?? "NA",
          color: pm25 == null ? MISSING_PM_COLOR : band.color,
          bandLabel: band.label,
          aqi: band.aqi ?? "NA",
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
