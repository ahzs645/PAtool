/**
 * Climate-stratified evaluation metrics. EPA performance targets for
 * sensor evaluation recommend reporting metrics by temperature and
 * humidity bins so seasonal/environmental biases are visible.
 */

import { modStats, type ModStats, type PairedObsMod } from "./openairStats";

export type ClimateRecord = PairedObsMod & {
  temperature?: number;
  humidity?: number;
};

export type ClimateBin = {
  label: string;
  min: number;
  max: number;
};

export type ClimateStrataResult = {
  variable: "temperature" | "humidity";
  bins: ClimateBin[];
  rows: Array<{ bin: ClimateBin; stats: ModStats; share: number }>;
};

export const DEFAULT_TEMP_BINS: ClimateBin[] = [
  { label: "<10°C", min: -Infinity, max: 10 },
  { label: "10–20°C", min: 10, max: 20 },
  { label: "20–30°C", min: 20, max: 30 },
  { label: ">30°C", min: 30, max: Infinity },
];

export const DEFAULT_RH_BINS: ClimateBin[] = [
  { label: "<25%", min: -Infinity, max: 25 },
  { label: "25–50%", min: 25, max: 50 },
  { label: "50–75%", min: 50, max: 75 },
  { label: ">75%", min: 75, max: Infinity },
];

function selectBin(value: number | undefined, bins: ReadonlyArray<ClimateBin>): ClimateBin | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return bins.find((b) => value >= b.min && value < b.max) ?? null;
}

export function stratifyByTemperature(
  records: ReadonlyArray<ClimateRecord>,
  bins: ReadonlyArray<ClimateBin> = DEFAULT_TEMP_BINS,
): ClimateStrataResult {
  return stratifyByVariable(records, bins, "temperature");
}

export function stratifyByHumidity(
  records: ReadonlyArray<ClimateRecord>,
  bins: ReadonlyArray<ClimateBin> = DEFAULT_RH_BINS,
): ClimateStrataResult {
  return stratifyByVariable(records, bins, "humidity");
}

function stratifyByVariable(
  records: ReadonlyArray<ClimateRecord>,
  bins: ReadonlyArray<ClimateBin>,
  variable: "temperature" | "humidity",
): ClimateStrataResult {
  const total = records.length;
  const grouped = new Map<string, ClimateRecord[]>();
  for (const rec of records) {
    const bin = selectBin(rec[variable], bins);
    if (!bin) continue;
    const arr = grouped.get(bin.label) ?? [];
    arr.push(rec);
    grouped.set(bin.label, arr);
  }
  return {
    variable,
    bins: [...bins],
    rows: bins.map((bin) => {
      const group = grouped.get(bin.label) ?? [];
      return {
        bin,
        stats: modStats(group),
        share: total === 0 ? 0 : group.length / total,
      };
    }),
  };
}
