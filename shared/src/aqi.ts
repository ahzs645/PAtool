import type { AqiBandResult, AqiBreakpoint, AqiCategory, AqiProfile } from "./domain";

export type AqiPaletteKey = "epa" | "subdued" | "deuteranopia";

export type AqiPalette = {
  key: AqiPaletteKey;
  label: string;
  colors: Record<AqiCategory, string>;
};

export const PM25_2024_AQI_BREAKPOINTS: AqiBreakpoint[] = [
  { category: "Good", label: "Good", concLow: 0.0, concHigh: 9.0, concentrationHigh: 9.0, aqiLow: 0, aqiHigh: 50, color: "#00e400" },
  { category: "Moderate", label: "Moderate", concLow: 9.1, concHigh: 35.4, concentrationHigh: 35.4, aqiLow: 51, aqiHigh: 100, color: "#ffff00" },
  { category: "USG", label: "USG", concLow: 35.5, concHigh: 55.4, concentrationHigh: 55.4, aqiLow: 101, aqiHigh: 150, color: "#ff7e00" },
  { category: "Unhealthy", label: "Unhealthy", concLow: 55.5, concHigh: 125.4, concentrationHigh: 125.4, aqiLow: 151, aqiHigh: 200, color: "#ff0000" },
  { category: "Very Unhealthy", label: "Very Unhealthy", concLow: 125.5, concHigh: 225.4, concentrationHigh: 225.4, aqiLow: 201, aqiHigh: 300, color: "#8f3f97" },
  { category: "Hazardous", label: "Hazardous", concLow: 225.5, concHigh: 325.4, concentrationHigh: 325.4, aqiLow: 301, aqiHigh: 500, color: "#7e0023" },
];

export const AQI_PALETTES: Record<AqiPaletteKey, AqiPalette> = {
  epa: {
    key: "epa",
    label: "EPA",
    colors: {
      Good: "#00e400",
      Moderate: "#ffff00",
      USG: "#ff7e00",
      Unhealthy: "#ff0000",
      "Very Unhealthy": "#8f3f97",
      Hazardous: "#7e0023",
    },
  },
  subdued: {
    key: "subdued",
    label: "Subdued",
    colors: {
      Good: "#6fbd8b",
      Moderate: "#d9c85f",
      USG: "#d99058",
      Unhealthy: "#cc6b6b",
      "Very Unhealthy": "#8a6aa1",
      Hazardous: "#8f5b66",
    },
  },
  deuteranopia: {
    key: "deuteranopia",
    label: "Deuteranopia",
    colors: {
      Good: "#4e79a7",
      Moderate: "#f28e2b",
      USG: "#e15759",
      Unhealthy: "#b07aa1",
      "Very Unhealthy": "#9c755f",
      Hazardous: "#4d4d4d",
    },
  },
};

export const AQI_CATEGORY_ACTIONS: Record<AqiCategory, string> = {
  Good: "Air quality is satisfactory.",
  Moderate: "Unusually sensitive people should consider reducing prolonged exertion.",
  USG: "Sensitive groups should reduce prolonged or heavy exertion.",
  Unhealthy: "Everyone should reduce prolonged or heavy exertion.",
  "Very Unhealthy": "Avoid prolonged or heavy exertion.",
  Hazardous: "Avoid outdoor exertion and follow local public health guidance.",
};

export function aqiBreakpointsWithPalette(
  profile: AqiProfile,
  palette: AqiPaletteKey = "subdued",
): AqiBreakpoint[] {
  const colors = AQI_PALETTES[palette].colors;
  return profile.breakpoints.map((breakpoint) => ({
    ...breakpoint,
    label: breakpoint.category,
    concentrationHigh: breakpoint.concHigh,
    color: colors[breakpoint.category],
  }));
}

export function truncatePm25ForAqi(pm25: number): number {
  if (!Number.isFinite(pm25)) return 0;
  return Math.floor(Math.max(0, pm25) * 10) / 10;
}

export function pm25ToAqiRegulatory(pm25: number, profile: AqiProfile): number {
  const c = truncatePm25ForAqi(pm25);
  for (const bp of profile.breakpoints) {
    if (c >= bp.concLow && c <= bp.concHigh) {
      return Math.round(((bp.aqiHigh - bp.aqiLow) / (bp.concHigh - bp.concLow)) * (c - bp.concLow) + bp.aqiLow);
    }
  }

  const last = profile.breakpoints.at(-1);
  if (!last) return 0;
  return Math.round(((last.aqiHigh - last.aqiLow) / (last.concHigh - last.concLow)) * (c - last.concLow) + last.aqiLow);
}

export function pm25ToAqiBandWithPalette(
  value: number | null | undefined,
  profile: AqiProfile,
  palette: AqiPaletteKey = "subdued",
): AqiBandResult {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { label: "Unavailable", category: "Unavailable", color: "#94a3b8", aqi: null };
  }

  const aqi = pm25ToAqiRegulatory(value, profile);
  const breakpoint = profile.breakpoints.find((bp) => aqi >= bp.aqiLow && aqi <= bp.aqiHigh)
    ?? profile.breakpoints.at(-1);
  if (!breakpoint) return { label: "Unavailable", category: "Unavailable", color: "#94a3b8", aqi: null };

  return {
    label: breakpoint.category,
    category: breakpoint.category,
    color: AQI_PALETTES[palette].colors[breakpoint.category],
    aqi,
  };
}

export function aqiThresholds(profile: AqiProfile): number[] {
  return profile.breakpoints
    .map((breakpoint) => breakpoint.concLow)
    .filter((value, index) => index > 0 && Number.isFinite(value));
}
