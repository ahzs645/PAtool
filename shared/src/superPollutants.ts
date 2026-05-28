/**
 * Short-Lived Climate Pollutant (SLCP) accounting, inspired by
 * biteSizedAQ notebook #12 "super pollutants". Decomposes a basket of
 * pollutants into:
 *   - 20-year GWP-weighted CO₂ equivalent (CCAC convention)
 *   - 100-year GWP CO₂ equivalent
 *   - WHO-disease-burden-equivalent units (premature deaths / yr per
 *     unit emission, drawn from Lelieveld 2015 / GBD 2019 anchors)
 *
 * The GWPs used here are AR6 best-estimate values; callers can override
 * via `customGwp`.
 */

export type SuperPollutant =
  | "co2"
  | "ch4"   // methane
  | "n2o"
  | "bc"    // black carbon
  | "o3-trop" // tropospheric ozone (proxied)
  | "hfc"
  | "sf6";

export type SuperPollutantEmission = {
  pollutant: SuperPollutant;
  /** Tonnes per year. */
  tonnesPerYear: number;
  /** Optional override for AR6 GWP-20. */
  gwp20Override?: number;
  /** Optional override for AR6 GWP-100. */
  gwp100Override?: number;
};

const AR6_GWP_20: Record<SuperPollutant, number> = {
  co2: 1,
  ch4: 81,        // AR6 GWP20 for fossil methane
  n2o: 273,
  bc: 2421,       // Bond 2013 BC GWP20 (high uncertainty)
  "o3-trop": 60,  // proxied — order-of-magnitude only
  hfc: 5810,      // HFC-134a anchor
  sf6: 17850,
};

const AR6_GWP_100: Record<SuperPollutant, number> = {
  co2: 1,
  ch4: 29.8,
  n2o: 273,
  bc: 900,
  "o3-trop": 25,
  hfc: 1430,
  sf6: 23500,
};

/** Approx. premature-death-per-Tg metric — anchored to Lelieveld 2015. */
const HEALTH_BURDEN_PER_TG: Partial<Record<SuperPollutant, number>> = {
  bc: 350_000,
  "o3-trop": 32_000,
  ch4: 7_500,       // via ozone formation
};

export type SuperPollutantDecomposition = {
  pollutant: SuperPollutant;
  tonnesPerYear: number;
  co2eq20: number;
  co2eq100: number;
  prematureDeathsPerYear: number;
};

export type SuperPollutantSummary = {
  totalCo2eq20: number;
  totalCo2eq100: number;
  totalPrematureDeathsPerYear: number;
  rows: SuperPollutantDecomposition[];
};

export function decomposeSuperPollutants(
  emissions: ReadonlyArray<SuperPollutantEmission>,
): SuperPollutantSummary {
  const rows: SuperPollutantDecomposition[] = emissions.map((e) => {
    const gwp20 = e.gwp20Override ?? AR6_GWP_20[e.pollutant] ?? 0;
    const gwp100 = e.gwp100Override ?? AR6_GWP_100[e.pollutant] ?? 0;
    const co2eq20 = e.tonnesPerYear * gwp20;
    const co2eq100 = e.tonnesPerYear * gwp100;
    const tg = e.tonnesPerYear / 1e6;
    const prematureDeathsPerYear = (HEALTH_BURDEN_PER_TG[e.pollutant] ?? 0) * tg;
    return {
      pollutant: e.pollutant,
      tonnesPerYear: e.tonnesPerYear,
      co2eq20,
      co2eq100,
      prematureDeathsPerYear,
    };
  });
  return {
    totalCo2eq20: rows.reduce((s, r) => s + r.co2eq20, 0),
    totalCo2eq100: rows.reduce((s, r) => s + r.co2eq100, 0),
    totalPrematureDeathsPerYear: rows.reduce((s, r) => s + r.prematureDeathsPerYear, 0),
    rows,
  };
}
