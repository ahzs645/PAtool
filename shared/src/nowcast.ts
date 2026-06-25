/**
 * EPA NowCast implementation. NowCast is the smoothing rule the AQI uses
 * for sub-daily reporting of PM2.5, PM10, and ozone. Three variants:
 *
 *   - "pm":       12-hour window, weight factor floor = 0.5  (US PM)
 *   - "pmAsian":  3-hour window,  weight factor floor = 0.1  (Asian PM)
 *   - "ozone":    8-hour window,  simple trailing mean of valid hours
 *
 * For PM variants:
 *   w  = max(min_value, c_min / c_max)
 *   ŷ  = Σ wᵏ · c_k / Σ wᵏ   (k = 0..n−1, most recent first)
 *   Require at least two of the last three hours valid; otherwise output NaN.
 *
 * Reference: AirNow "How is NowCast PM calculated", September 2013;
 * AirMonitor vignette `NowCast.Rmd`.
 */

export type NowcastVariant = "pm" | "pmAsian" | "ozone";

export type NowcastOptions = {
  variant?: NowcastVariant;
};

const VARIANT_WINDOW: Record<NowcastVariant, number> = {
  pm: 12,
  pmAsian: 3,
  ozone: 8,
};

const VARIANT_MIN_WEIGHT: Record<NowcastVariant, number> = {
  pm: 0.5,
  pmAsian: 0.1,
  ozone: 0, // ozone uses simple trailing mean
};

function isFinite_(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Compute a single NowCast value at the trailing edge of `values`.
 * `values[0]` is the *oldest* hour and `values[n-1]` is the most recent.
 * Returns `null` if the most recent hour is missing or completeness
 * checks fail.
 */
/**
 * @equation nowcast-pm
 * @title EPA NowCast (PM) weighted average
 * @category AQI & Metrics
 * @latex w = \max\!\left(0.5,\ \tfrac{c_{min}}{c_{max}}\right) \qquad \hat{c} = \dfrac{\sum_{k=0}^{n-1} w^{k} c_{k}}{\sum_{k=0}^{n-1} w^{k}}
 * @var c_k | hourly concentration, k hours before now (k=0 most recent)
 * @var w | weight factor (floor 0.5 for US PM, 0.1 for Asian PM)
 * @plain 12-hour weighted average; requires >=2 of the 3 most recent hours valid.
 * @cite AirNow "How is the NowCast algorithm used to report current air quality"
 */
export function nowcastValue(
  values: ReadonlyArray<number | null>,
  variant: NowcastVariant = "pm",
): number | null {
  const window = VARIANT_WINDOW[variant];
  const slice = values.slice(-window);
  if (slice.length === 0) return null;
  const recent = slice[slice.length - 1];
  if (!isFinite_(recent)) return null;

  // EPA PM rule: require ≥ 2 of the last 3 hours valid.
  if (variant !== "ozone") {
    const last3 = slice.slice(-3).filter(isFinite_).length;
    if (last3 < 2) return null;
  }

  if (variant === "ozone") {
    const valid = slice.filter(isFinite_);
    if (valid.length === 0) return null;
    return valid.reduce((s, v) => s + v, 0) / valid.length;
  }

  const valid = slice.filter(isFinite_);
  const cMin = Math.min(...valid);
  const cMax = Math.max(...valid);
  const wFloor = VARIANT_MIN_WEIGHT[variant];
  const w = cMax === 0 ? 1 : Math.max(wFloor, cMin / cMax);
  let num = 0;
  let den = 0;
  // Most recent at index n-1 gets weight w^0 = 1.
  for (let k = 0; k < slice.length; k += 1) {
    const idxFromEnd = slice.length - 1 - k;
    const v = slice[idxFromEnd];
    if (!isFinite_(v)) continue;
    const wk = Math.pow(w, k);
    num += v * wk;
    den += wk;
  }
  return den > 0 ? num / den : null;
}

/**
 * Compute NowCast over a full hourly series, returning aligned output of
 * the same length. Insufficient-data positions are `null`.
 */
export function monitorNowcast(
  hourly: ReadonlyArray<number | null>,
  options: NowcastOptions = {},
): Array<number | null> {
  const variant = options.variant ?? "pm";
  const window = VARIANT_WINDOW[variant];
  return hourly.map((_, i) => {
    const start = Math.max(0, i - window + 1);
    return nowcastValue(hourly.slice(start, i + 1), variant);
  });
}

/**
 * Categorical AQI breakpoints (USEPA 2024 PM2.5 NAAQS). Useful for
 * `nowcast_to_aqi`-style downstream display.
 */
export const PM25_AQI_BREAKPOINTS = [
  { low: 0, high: 9.0, aqiLow: 0, aqiHigh: 50, label: "Good" },
  { low: 9.1, high: 35.4, aqiLow: 51, aqiHigh: 100, label: "Moderate" },
  { low: 35.5, high: 55.4, aqiLow: 101, aqiHigh: 150, label: "Unhealthy for Sensitive Groups" },
  { low: 55.5, high: 125.4, aqiLow: 151, aqiHigh: 200, label: "Unhealthy" },
  { low: 125.5, high: 225.4, aqiLow: 201, aqiHigh: 300, label: "Very Unhealthy" },
  { low: 225.5, high: 500, aqiLow: 301, aqiHigh: 500, label: "Hazardous" },
] as const;

export function nowcastToAqi(value: number | null): { aqi: number | null; label: string } {
  if (!isFinite_(value) || value === null) return { aqi: null, label: "Unavailable" };
  for (const bp of PM25_AQI_BREAKPOINTS) {
    if (value >= bp.low && value <= bp.high) {
      const aqi = Math.round(((bp.aqiHigh - bp.aqiLow) / (bp.high - bp.low)) * (value - bp.low) + bp.aqiLow);
      return { aqi, label: bp.label };
    }
  }
  return { aqi: 500, label: "Hazardous" };
}
