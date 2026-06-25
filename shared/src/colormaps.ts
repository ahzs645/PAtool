/**
 * Colormaps for the map time-lapse. ASNAT lets the user pick a colormap that
 * is then described in the legend; this provides the AQI category palette plus
 * a couple of continuous scientific ramps and the SCAQMD PM2.5 palette.
 */

import { pm25ToAqiBand } from "./domain";

export type ColormapId = "aqi" | "viridis" | "magma" | "scaqmd";

export const COLORMAP_IDS: ColormapId[] = ["aqi", "viridis", "magma", "scaqmd"];

export const NO_DATA_COLOR = "#94a3b8";

export type LegendStop = { color: string; label: string };

// Continuous ramps as evenly spaced hex stops (low -> high).
const VIRIDIS = ["#440154", "#414487", "#2a788e", "#22a884", "#7ad151", "#fde725"];
const MAGMA = ["#000004", "#3b0f70", "#8c2981", "#de4968", "#fe9f6d", "#fcfdbf"];

// SCAQMD PM2.5 palette (fixed breaks, ug/m3).
const SCAQMD_BANDS: Array<{ max: number; color: string; label: string }> = [
  { max: 12, color: "#abebff", label: "0-12" },
  { max: 35, color: "#3b8aff", label: "12-35" },
  { max: 55, color: "#002ade", label: "35-55" },
  { max: 75, color: "#9f00de", label: "55-75" },
  { max: Infinity, color: "#6b0096", label: "75+" },
];

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb.map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, "0")).join("")}`;
}

function sampleRamp(stops: string[], t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  if (clamped <= 0) return stops[0];
  if (clamped >= 1) return stops[stops.length - 1];
  const scaled = clamped * (stops.length - 1);
  const i = Math.floor(scaled);
  const frac = scaled - i;
  const a = hexToRgb(stops[i]);
  const b = hexToRgb(stops[i + 1]);
  return rgbToHex([a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac, a[2] + (b[2] - a[2]) * frac]);
}

function scaqmdColor(value: number): string {
  return (SCAQMD_BANDS.find((band) => value <= band.max) ?? SCAQMD_BANDS[SCAQMD_BANDS.length - 1]).color;
}

export type ColorScaleOptions = { colormap: ColormapId; min: number; max: number };

/** Color a value under the chosen colormap. Null/non-finite -> the no-data color. */
export function colorForValue(value: number | null | undefined, options: ColorScaleOptions): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return NO_DATA_COLOR;
  switch (options.colormap) {
    case "aqi":
      return pm25ToAqiBand(value).color;
    case "scaqmd":
      return scaqmdColor(value);
    case "viridis":
    case "magma": {
      const span = options.max - options.min;
      const t = span > 0 ? (value - options.min) / span : 0;
      return sampleRamp(options.colormap === "viridis" ? VIRIDIS : MAGMA, t);
    }
    default:
      return NO_DATA_COLOR;
  }
}

/** Legend entries describing the active colormap (ASNAT shows this beside the map). */
export function colormapLegend(colormap: ColormapId, min: number, max: number): LegendStop[] {
  if (colormap === "aqi") {
    return [
      { color: "#2e9d5b", label: "Good (0-9)" },
      { color: "#f0c419", label: "Moderate (9-35)" },
      { color: "#f2994a", label: "USG (35-55)" },
      { color: "#d64545", label: "Unhealthy (55-125)" },
      { color: "#7d3c98", label: "Very Unhealthy (125-225)" },
      { color: "#8b0000", label: "Hazardous (225+)" },
    ];
  }
  if (colormap === "scaqmd") {
    return SCAQMD_BANDS.map((band) => ({ color: band.color, label: band.label }));
  }
  const stops = colormap === "viridis" ? VIRIDIS : MAGMA;
  const span = max - min;
  return stops.map((_, i) => {
    const t = i / (stops.length - 1);
    const value = min + span * t;
    return { color: sampleRamp(stops, t), label: span > 0 ? value.toFixed(0) : `${value.toFixed(0)}` };
  });
}
