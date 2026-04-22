// ---------------------------------------------------------------------------
// USDA Rural-Urban Continuum Codes (RUCC) locale tagging
//
// RUCC codes classify every US county into 9 ordinal rural/urban bins. We use
// them to:
//   1. Tag sensor records or POI receptors with a rural/urban locale label.
//   2. Roll up PM2.5 exposure estimates by metro vs non-metro category so that
//      outcome analyses can stratify on urbanicity (as in Carroll et al. 2025).
//
// The full 1900+ row USDA CSV is user-supplied; this module only ships the
// code metadata and the ingest / lookup helpers. Users load the CSV from
// https://www.ers.usda.gov/data-products/rural-urban-continuum-codes/.
// ---------------------------------------------------------------------------

export type RuccCode = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type RuccCategory = "metro" | "nonmetro";

export type RuccTier =
  | "metro-large"      // RUCC 1
  | "metro-medium"     // RUCC 2
  | "metro-small"      // RUCC 3
  | "nonmetro-large"   // RUCC 4-5
  | "nonmetro-small"   // RUCC 6-7
  | "nonmetro-rural";  // RUCC 8-9

export type RuccCodeInfo = {
  code: RuccCode;
  category: RuccCategory;
  tier: RuccTier;
  label: string;
  description: string;
};

export const RUCC_CODE_INFO: Record<RuccCode, RuccCodeInfo> = {
  1: {
    code: 1,
    category: "metro",
    tier: "metro-large",
    label: "Metro (1M+)",
    description: "Counties in metro areas of 1 million population or more",
  },
  2: {
    code: 2,
    category: "metro",
    tier: "metro-medium",
    label: "Metro (250K-1M)",
    description: "Counties in metro areas of 250,000 to 1 million population",
  },
  3: {
    code: 3,
    category: "metro",
    tier: "metro-small",
    label: "Metro (<250K)",
    description: "Counties in metro areas of fewer than 250,000 population",
  },
  4: {
    code: 4,
    category: "nonmetro",
    tier: "nonmetro-large",
    label: "Nonmetro large, adj metro",
    description: "Urban pop >= 20,000, adjacent to a metro area",
  },
  5: {
    code: 5,
    category: "nonmetro",
    tier: "nonmetro-large",
    label: "Nonmetro large, not adj",
    description: "Urban pop >= 20,000, not adjacent to a metro area",
  },
  6: {
    code: 6,
    category: "nonmetro",
    tier: "nonmetro-small",
    label: "Nonmetro small, adj metro",
    description: "Urban pop 5,000-19,999, adjacent to a metro area",
  },
  7: {
    code: 7,
    category: "nonmetro",
    tier: "nonmetro-small",
    label: "Nonmetro small, not adj",
    description: "Urban pop 5,000-19,999, not adjacent to a metro area",
  },
  8: {
    code: 8,
    category: "nonmetro",
    tier: "nonmetro-rural",
    label: "Nonmetro rural, adj metro",
    description: "Urban pop < 5,000, adjacent to a metro area",
  },
  9: {
    code: 9,
    category: "nonmetro",
    tier: "nonmetro-rural",
    label: "Nonmetro rural, not adj",
    description: "Urban pop < 5,000, not adjacent to a metro area",
  },
};

export type RuccRow = {
  fips: string;          // 5-digit zero-padded county FIPS
  state: string;
  countyName: string;
  populationYear?: number | null;
  population?: number | null;
  code: RuccCode;
};

export type RuccTable = {
  rows: RuccRow[];
  byFips: Map<string, RuccRow>;
};

export function isRuccCode(value: number): value is RuccCode {
  return Number.isInteger(value) && value >= 1 && value <= 9;
}

function normalizeFips(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.length === 0) return "";
  return digits.padStart(5, "0").slice(-5);
}

function splitCsvLine(line: string): string[] {
  // Minimal RFC-4180 parser: handles quoted cells with embedded commas.
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current);
  return cells.map((c) => c.trim());
}

export type ParseRuccOptions = {
  // Override column names if the source CSV uses different headers. Column
  // lookup is case-insensitive. Defaults follow USDA's 2023 release.
  columns?: {
    fips?: string;
    state?: string;
    countyName?: string;
    code?: string;
    population?: string;
    populationYear?: string;
  };
};

export function parseRuccCsv(text: string, options: ParseRuccOptions = {}): RuccTable {
  const cols = {
    fips: (options.columns?.fips ?? "FIPS").toLowerCase(),
    state: (options.columns?.state ?? "State").toLowerCase(),
    countyName: (options.columns?.countyName ?? "County_Name").toLowerCase(),
    code: (options.columns?.code ?? "RUCC_2023").toLowerCase(),
    population: (options.columns?.population ?? "Population_2020").toLowerCase(),
    populationYear: (options.columns?.populationYear ?? "Population_Year").toLowerCase(),
  };

  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return { rows: [], byFips: new Map() };
  }

  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const idx = (key: string) => header.indexOf(key);

  const fipsIdx = idx(cols.fips);
  const stateIdx = idx(cols.state);
  const nameIdx = idx(cols.countyName);
  const codeIdx = idx(cols.code);
  const popIdx = idx(cols.population);
  const popYrIdx = idx(cols.populationYear);

  if (fipsIdx < 0 || codeIdx < 0) {
    throw new Error(
      `parseRuccCsv requires columns for FIPS ('${cols.fips}') and RUCC code ('${cols.code}').`,
    );
  }

  const rows: RuccRow[] = [];
  const byFips = new Map<string, RuccRow>();

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const fips = normalizeFips(cells[fipsIdx] ?? "");
    if (!fips) continue;
    const rawCode = Number(cells[codeIdx]);
    if (!isRuccCode(rawCode)) continue;
    const row: RuccRow = {
      fips,
      state: stateIdx >= 0 ? cells[stateIdx] ?? "" : "",
      countyName: nameIdx >= 0 ? cells[nameIdx] ?? "" : "",
      population:
        popIdx >= 0 ? (() => {
          const raw = cells[popIdx]?.replace(/[,\s"]/g, "");
          const v = raw ? Number(raw) : NaN;
          return Number.isFinite(v) ? v : null;
        })() : null,
      populationYear:
        popYrIdx >= 0 ? (() => {
          const v = Number(cells[popYrIdx]);
          return Number.isFinite(v) ? v : null;
        })() : null,
      code: rawCode,
    };
    rows.push(row);
    byFips.set(fips, row);
  }

  return { rows, byFips };
}

export function lookupRucc(fips: string, table: RuccTable): RuccRow | null {
  if (!fips) return null;
  const normalized = normalizeFips(fips);
  return table.byFips.get(normalized) ?? null;
}

export function ruccCategoryForFips(fips: string, table: RuccTable): RuccCategory | null {
  const row = lookupRucc(fips, table);
  return row ? RUCC_CODE_INFO[row.code].category : null;
}

export function ruccTierForFips(fips: string, table: RuccTable): RuccTier | null {
  const row = lookupRucc(fips, table);
  return row ? RUCC_CODE_INFO[row.code].tier : null;
}

// Rollup helpers ---------------------------------------------------------

export type RuccGroupKey = "code" | "category" | "tier";

export type RuccRollup<G extends string> = {
  group: G;
  label: string;
  receptorCount: number;
  withValueCount: number;
  meanPm25: number | null;
  medianPm25: number | null;
  p95Pm25: number | null;
  maxPm25: number | null;
  minPm25: number | null;
};

export type RuccRollupInput = {
  fips: string;
  pm25: number | null;
};

function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = q * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const w = idx - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

function summarizeGroup<G extends string>(
  group: G,
  label: string,
  values: number[],
  receptorCount: number,
): RuccRollup<G> {
  if (values.length === 0) {
    return {
      group,
      label,
      receptorCount,
      withValueCount: 0,
      meanPm25: null,
      medianPm25: null,
      p95Pm25: null,
      maxPm25: null,
      minPm25: null,
    };
  }
  const sorted = values.slice().sort((a, b) => a - b);
  let sum = 0;
  for (const v of values) sum += v;
  return {
    group,
    label,
    receptorCount,
    withValueCount: values.length,
    meanPm25: sum / values.length,
    medianPm25: quantile(sorted, 0.5),
    p95Pm25: quantile(sorted, 0.95),
    maxPm25: sorted[sorted.length - 1],
    minPm25: sorted[0],
  };
}

export function rollupByRucc(
  records: RuccRollupInput[],
  table: RuccTable,
  groupBy: RuccGroupKey,
): Array<RuccRollup<string>> {
  const buckets = new Map<string, { label: string; values: number[]; count: number }>();
  const missingLabel = "Unclassified (no matching FIPS)";

  for (const rec of records) {
    const row = lookupRucc(rec.fips, table);
    let key: string;
    let label: string;
    if (!row) {
      key = "__unclassified__";
      label = missingLabel;
    } else {
      const info = RUCC_CODE_INFO[row.code];
      if (groupBy === "code") {
        key = String(info.code);
        label = info.label;
      } else if (groupBy === "category") {
        key = info.category;
        label = info.category === "metro" ? "Metro" : "Non-metro";
      } else {
        key = info.tier;
        label = info.label.replace(/\s+\(.+?\)/, "");
      }
    }

    let entry = buckets.get(key);
    if (!entry) {
      entry = { label, values: [], count: 0 };
      buckets.set(key, entry);
    }
    entry.count += 1;
    if (rec.pm25 !== null && Number.isFinite(rec.pm25)) entry.values.push(rec.pm25);
  }

  const out: Array<RuccRollup<string>> = [];
  for (const [group, entry] of buckets) {
    out.push(summarizeGroup(group, entry.label, entry.values, entry.count));
  }
  // Sort by deterministic ordering: numeric RUCC code if group is a code; otherwise by label.
  out.sort((a, b) => {
    const aNum = Number(a.group);
    const bNum = Number(b.group);
    if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum;
    if (a.group === "__unclassified__") return 1;
    if (b.group === "__unclassified__") return -1;
    return a.label.localeCompare(b.label);
  });
  return out;
}
