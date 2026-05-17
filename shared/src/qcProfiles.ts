export type QcProfileId =
  | "purpleair-ab"
  | "epa-collocation"
  | "sentinel-fenceline"
  | "asnat-network"
  | "mobile-campaign";

export type QcProfileRule =
  | { kind: "min-count"; minCount: number }
  | { kind: "range"; field: string; min?: number; max?: number }
  | { kind: "max-absolute-difference"; left: string; right: string; threshold: number }
  | { kind: "max-percent-difference"; left: string; right: string; threshold: number }
  | { kind: "constant-run"; field: string; maxRunLength: number }
  | { kind: "missing"; field: string };

export type QcProfile = {
  id: QcProfileId;
  label: string;
  provenance: string;
  description: string;
  rules: QcProfileRule[];
};

export type QcProfileInputRow = Record<string, unknown>;

export type QcFlaggedRow<T extends QcProfileInputRow = QcProfileInputRow> = T & {
  qcFlags: string[];
  qcPass: boolean;
};

export type QcProfileSummary = {
  profile: QcProfile;
  total: number;
  passed: number;
  failed: number;
  byRule: Array<{ rule: string; count: number }>;
  rows: QcFlaggedRow[];
};

export const QC_PROFILES: QcProfile[] = [
  {
    id: "purpleair-ab",
    label: "PurpleAir A/B",
    provenance: "AirSensor hourly A/B QC profile",
    description: "Channel agreement, minimum sample count, and environmental bounds for PurpleAir-like data.",
    rules: [
      { kind: "min-count", minCount: 12 },
      { kind: "missing", field: "pm25A" },
      { kind: "missing", field: "pm25B" },
      { kind: "max-absolute-difference", left: "pm25A", right: "pm25B", threshold: 5 },
      { kind: "max-percent-difference", left: "pm25A", right: "pm25B", threshold: 30 },
      { kind: "range", field: "humidity", min: 0, max: 100 },
      { kind: "range", field: "temperature", min: -50, max: 80 },
    ],
  },
  {
    id: "epa-collocation",
    label: "EPA collocation",
    provenance: "sensortoolkit-style performance evaluation",
    description: "Reference/candidate completeness and coarse agreement checks before EPA-style metric review.",
    rules: [
      { kind: "min-count", minCount: 23 },
      { kind: "missing", field: "reference" },
      { kind: "missing", field: "sensor" },
      { kind: "range", field: "reference", min: 0 },
      { kind: "range", field: "sensor", min: 0 },
      { kind: "max-percent-difference", left: "reference", right: "sensor", threshold: 80 },
    ],
  },
  {
    id: "sentinel-fenceline",
    label: "SENTINEL fenceline",
    provenance: "SENTINEL fenceline QA workflow",
    description: "Low-wind, wind-range, humidity/temperature, missing signal, and constant-run screening.",
    rules: [
      { kind: "missing", field: "pollutant" },
      { kind: "range", field: "pollutant", min: 0 },
      { kind: "range", field: "windSpeed", min: 0 },
      { kind: "range", field: "windDirection", min: 0, max: 360 },
      { kind: "range", field: "humidity", min: 0, max: 100 },
      { kind: "constant-run", field: "pollutant", maxRunLength: 8 },
    ],
  },
  {
    id: "asnat-network",
    label: "ASNAT network",
    provenance: "ASNAT network comparison workflow",
    description: "Network-wide screening for missing, negative, implausible, and stale concentration records.",
    rules: [
      { kind: "missing", field: "pollutant" },
      { kind: "range", field: "pollutant", min: 0, max: 1000 },
      { kind: "range", field: "latitude", min: -90, max: 90 },
      { kind: "range", field: "longitude", min: -180, max: 180 },
      { kind: "constant-run", field: "pollutant", maxRunLength: 12 },
    ],
  },
  {
    id: "mobile-campaign",
    label: "Mobile campaign",
    provenance: "AirBeamR/mobile-sensing workflow",
    description: "Route data checks for location, nonnegative PM2.5, and coarse plausibility.",
    rules: [
      { kind: "missing", field: "pollutant" },
      { kind: "range", field: "pollutant", min: 0, max: 1000 },
      { kind: "range", field: "latitude", min: -90, max: 90 },
      { kind: "range", field: "longitude", min: -180, max: 180 },
    ],
  },
];

export function getQcProfile(id: QcProfileId): QcProfile {
  return QC_PROFILES.find((profile) => profile.id === id) ?? QC_PROFILES[0];
}

export function applyQcProfile<T extends QcProfileInputRow>(
  rows: readonly T[],
  profileOrId: QcProfile | QcProfileId,
): QcProfileSummary {
  const profile = typeof profileOrId === "string" ? getQcProfile(profileOrId) : profileOrId;
  const constantRuns = constantRunIndexes(rows, profile.rules);
  const counts = new Map<string, number>();
  const flaggedRows = rows.map((row, index) => {
    const flags: string[] = [];
    for (const rule of profile.rules) {
      const flag = evaluateRule(row, index, rule, rows.length, constantRuns);
      if (flag) {
        flags.push(flag);
        counts.set(flag, (counts.get(flag) ?? 0) + 1);
      }
    }
    return { ...row, qcFlags: flags, qcPass: flags.length === 0 };
  });

  const passed = flaggedRows.filter((row) => row.qcPass).length;
  return {
    profile,
    total: rows.length,
    passed,
    failed: rows.length - passed,
    byRule: [...counts.entries()].map(([rule, count]) => ({ rule, count })).sort((a, b) => b.count - a.count),
    rows: flaggedRows,
  };
}

function evaluateRule(
  row: QcProfileInputRow,
  index: number,
  rule: QcProfileRule,
  total: number,
  constantRuns: Set<string>,
): string | null {
  if (rule.kind === "min-count") return total < rule.minCount ? `min-count-${rule.minCount}` : null;
  if (rule.kind === "missing") return finiteValue(row[rule.field]) === null ? `missing-${rule.field}` : null;
  if (rule.kind === "range") {
    const value = finiteValue(row[rule.field]);
    if (value === null) return null;
    if (typeof rule.min === "number" && value < rule.min) return `${rule.field}-below-${rule.min}`;
    if (typeof rule.max === "number" && value > rule.max) return `${rule.field}-above-${rule.max}`;
    return null;
  }
  if (rule.kind === "max-absolute-difference") {
    const left = finiteValue(row[rule.left]);
    const right = finiteValue(row[rule.right]);
    return left !== null && right !== null && Math.abs(left - right) > rule.threshold
      ? `absdiff-${rule.left}-${rule.right}`
      : null;
  }
  if (rule.kind === "max-percent-difference") {
    const left = finiteValue(row[rule.left]);
    const right = finiteValue(row[rule.right]);
    if (left === null || right === null) return null;
    const denominator = Math.abs(left + right);
    const spd = denominator === 0 ? 0 : (200 * Math.abs(left - right)) / denominator;
    return spd > rule.threshold ? `pctdiff-${rule.left}-${rule.right}` : null;
  }
  return constantRuns.has(`${rule.field}:${index}`) ? `constant-${rule.field}` : null;
}

function constantRunIndexes(rows: readonly QcProfileInputRow[], rules: QcProfileRule[]): Set<string> {
  const indexes = new Set<string>();
  for (const rule of rules) {
    if (rule.kind !== "constant-run") continue;
    let start = 0;
    let previous = finiteValue(rows[0]?.[rule.field]);
    for (let index = 1; index <= rows.length; index += 1) {
      const current = index < rows.length ? finiteValue(rows[index]?.[rule.field]) : Symbol("end");
      if (current === previous) continue;
      if (previous !== null && index - start > rule.maxRunLength) {
        for (let flagged = start; flagged < index; flagged += 1) indexes.add(`${rule.field}:${flagged}`);
      }
      start = index;
      previous = typeof current === "symbol" ? null : current;
    }
  }
  return indexes;
}

function finiteValue(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : null;
}
