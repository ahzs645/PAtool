/**
 * Helpers around the multi-year India block-level PM2.5 fixture
 * (biteSizedAQ notebook #13). The data file ships as JSON in
 * `shared/src/generated/bitesizedaq_india_block_multiyear.json`.
 */

import multiyear from "./generated/bitesizedaq_india_block_multiyear.json";

export type BiteSizedBlockRow = {
  state: string;
  block: string;
  year: number;
  pm25: number;
  populationWeighted: boolean;
};

export function loadBiteSizedBlockSeries(): BiteSizedBlockRow[] {
  return (multiyear as { rows: BiteSizedBlockRow[] }).rows.map((row) => ({ ...row }));
}

/** Aggregate to per-block first/last/decade-trend rows. */
export type BiteSizedBlockTrendRow = {
  state: string;
  block: string;
  firstYear: number;
  lastYear: number;
  firstPm25: number;
  lastPm25: number;
  changePerDecade: number;
};

export function summarizeBlockTrends(): BiteSizedBlockTrendRow[] {
  const groups: Record<string, BiteSizedBlockRow[]> = {};
  for (const row of loadBiteSizedBlockSeries()) {
    const key = `${row.state}|${row.block}`;
    (groups[key] ??= []).push(row);
  }
  return Object.values(groups).map((rows) => {
    const ordered = [...rows].sort((a, b) => a.year - b.year);
    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    const years = last.year - first.year || 1;
    return {
      state: first.state,
      block: first.block,
      firstYear: first.year,
      lastYear: last.year,
      firstPm25: first.pm25,
      lastPm25: last.pm25,
      changePerDecade: ((last.pm25 - first.pm25) / years) * 10,
    };
  });
}
