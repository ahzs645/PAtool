// ---------------------------------------------------------------------------
// superPollutants — utilities for decomposing short-lived climate pollutant
// (SLCP) emissions inventories into the canonical bite-sized-aq components:
// methane (CH₄), black carbon (BC), hydrofluorocarbons (HFCs), and tropospheric
// ozone (O₃) precursors.  Also computes 20-year and 100-year CO₂-equivalent
// totals using AR6 GWPs.
// ---------------------------------------------------------------------------

export type SlcpInventoryRow = {
  /** ISO-3 country code or arbitrary region identifier. */
  region: string;
  year: number;
  /** Pollutant species. */
  species: "CO2" | "CH4" | "BC" | "HFCs" | "N2O" | "NOx" | "VOC" | "SO2";
  /** Emissions, in metric tonnes (kt = 1e3 t). */
  tonnes: number;
};

export type GwpHorizon = "GWP20" | "GWP100";

// IPCC AR6 (Working Group I, Chapter 7, Table 7.15) GWP values for SLCPs.
// HFCs covers a basket; we use the AR6 HFC-134a value as a default for the
// bite-sized-aq SLCP decomposition.
export const AR6_GWP: Record<SlcpInventoryRow["species"], { GWP20: number; GWP100: number }> = {
  CO2:  { GWP20: 1,     GWP100: 1 },
  CH4:  { GWP20: 82.5,  GWP100: 29.8 },     // fossil methane
  BC:   { GWP20: 2421,  GWP100: 900 },      // Bond et al. 2013 / AR6 footnote
  HFCs: { GWP20: 4144,  GWP100: 1526 },     // HFC-134a as the basket proxy
  N2O:  { GWP20: 273,   GWP100: 273 },
  NOx:  { GWP20: 0,     GWP100: 0 },        // GWP not assigned (precursor)
  VOC:  { GWP20: 0,     GWP100: 0 },
  SO2:  { GWP20: -141,  GWP100: -42 },      // negative — net cooling proxy
};

export type SlcpDecomposition = {
  region: string;
  year: number;
  totalCo2eGwp20: number;
  totalCo2eGwp100: number;
  byClass: {
    longLived: number;   // CO2, N2O
    methane: number;
    blackCarbon: number;
    hfcs: number;
    ozonePrecursors: number;  // NOx + VOC
    coolingProxies: number;   // SO2
  };
};

export function decomposeSlcp(
  inventory: readonly SlcpInventoryRow[],
  horizon: GwpHorizon = "GWP100",
): SlcpDecomposition[] {
  const groups = new Map<string, SlcpInventoryRow[]>();
  for (const row of inventory) {
    if (!Number.isFinite(row.tonnes)) continue;
    const key = `${row.region}:${row.year}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }
  const out: SlcpDecomposition[] = [];
  for (const rows of groups.values()) {
    const region = rows[0].region;
    const year = rows[0].year;
    let longLived = 0;
    let methane = 0;
    let bc = 0;
    let hfcs = 0;
    let ozone = 0;
    let cooling = 0;
    let totalGwp20 = 0;
    let totalGwp100 = 0;
    for (const row of rows) {
      const gwp = AR6_GWP[row.species];
      const gwp20Tonnes = row.tonnes * gwp.GWP20;
      const gwp100Tonnes = row.tonnes * gwp.GWP100;
      totalGwp20 += gwp20Tonnes;
      totalGwp100 += gwp100Tonnes;
      const co2e = horizon === "GWP20" ? gwp20Tonnes : gwp100Tonnes;
      switch (row.species) {
        case "CO2":
        case "N2O":
          longLived += co2e;
          break;
        case "CH4":
          methane += co2e;
          break;
        case "BC":
          bc += co2e;
          break;
        case "HFCs":
          hfcs += co2e;
          break;
        case "NOx":
        case "VOC":
          ozone += row.tonnes;  // store as tonnes since GWP=0 by convention
          break;
        case "SO2":
          cooling += co2e;
          break;
      }
    }
    out.push({
      region,
      year,
      totalCo2eGwp20: totalGwp20,
      totalCo2eGwp100: totalGwp100,
      byClass: {
        longLived,
        methane,
        blackCarbon: bc,
        hfcs,
        ozonePrecursors: ozone,
        coolingProxies: cooling,
      },
    });
  }
  return out.sort((a, b) => a.region.localeCompare(b.region) || a.year - b.year);
}

/**
 * Convenience: compute the SLCP-share fraction of a region's total CO2e for a
 * given year. Helps the bite-sized-aq narrative ("methane is X% of the next
 * 20 years of warming for this region").
 */
export function slcpShare(row: SlcpDecomposition): {
  methane: number;
  blackCarbon: number;
  hfcs: number;
  combinedSlcp: number;
} {
  const denom = row.totalCo2eGwp20 || 1;
  const slcp = row.byClass.methane + row.byClass.blackCarbon + row.byClass.hfcs;
  return {
    methane: row.byClass.methane / denom,
    blackCarbon: row.byClass.blackCarbon / denom,
    hfcs: row.byClass.hfcs / denom,
    combinedSlcp: slcp / denom,
  };
}
