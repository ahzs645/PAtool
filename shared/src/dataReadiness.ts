export type MonitorMetadataRecord = {
  uniqueId: string;
  iso: string;
  longitude?: number | null;
  latitude?: number | null;
  elevation?: number | null;
  area?: string | null;
  type?: string | null;
  labeledArea?: boolean | null;
  labeledType?: boolean | null;
};

export type MonitorMetadataSummary = {
  iso: string;
  monitorCount: number;
  coordinateCoverage: number;
  elevationCoverage: number;
  areaClassificationCoverage: number;
  typeClassificationCoverage: number;
  officialAreaCoverage: number;
  officialTypeCoverage: number;
  metadataCompleteness: number;
};

export type DataReadinessRecord = {
  country: string;
  governmentMonitoring2024: boolean;
  publicAccessInCountry?: boolean | null;
  fullyTransparent?: boolean | null;
  partiallyTransparent?: boolean | null;
  physicalUnitsAvailable?: boolean | null;
  stationCoordinatesAvailable?: boolean | null;
  timelyFineScaleAvailable?: boolean | null;
  programmaticAccessAvailable?: boolean | null;
};

export type DataReadinessScore = {
  country: string;
  score: number;
  tier: "excellent" | "usable" | "limited" | "not-open" | "not-monitoring";
  missing: string[];
  present: string[];
};

export function summarizeMonitorMetadata(
  records: ReadonlyArray<MonitorMetadataRecord>,
): MonitorMetadataSummary[] {
  const groups = new Map<string, MonitorMetadataRecord[]>();
  for (const record of records) {
    const iso = record.iso.trim().toUpperCase();
    if (!iso) continue;
    const group = groups.get(iso);
    if (group) group.push(record);
    else groups.set(iso, [record]);
  }

  return Array.from(groups.entries())
    .map(([iso, group]) => {
      const monitorCount = group.length || 1;
      const coordinateCoverage = share(group, hasCoordinates);
      const elevationCoverage = share(group, (record) => finite(record.elevation));
      const areaClassificationCoverage = share(group, (record) => hasText(record.area));
      const typeClassificationCoverage = share(group, (record) => hasText(record.type));
      const officialAreaCoverage = share(group, (record) => record.labeledArea === true);
      const officialTypeCoverage = share(group, (record) => record.labeledType === true);

      return {
        iso,
        monitorCount,
        coordinateCoverage,
        elevationCoverage,
        areaClassificationCoverage,
        typeClassificationCoverage,
        officialAreaCoverage,
        officialTypeCoverage,
        metadataCompleteness: (
          coordinateCoverage +
          elevationCoverage +
          areaClassificationCoverage +
          typeClassificationCoverage +
          officialAreaCoverage +
          officialTypeCoverage
        ) / 6,
      };
    })
    .sort((a, b) => b.monitorCount - a.monitorCount || a.iso.localeCompare(b.iso));
}

export function scoreDataReadiness(record: DataReadinessRecord): DataReadinessScore {
  if (!record.governmentMonitoring2024) {
    return {
      country: record.country,
      score: 0,
      tier: "not-monitoring",
      missing: ["government monitoring"],
      present: [],
    };
  }

  const checks: Array<[string, boolean | null | undefined]> = [
    ["public access", record.publicAccessInCountry],
    ["full transparency", record.fullyTransparent],
    ["physical units", record.physicalUnitsAvailable],
    ["station coordinates", record.stationCoordinatesAvailable],
    ["timely fine-scale data", record.timelyFineScaleAvailable],
    ["programmatic access", record.programmaticAccessAvailable],
  ];
  const present = checks.filter(([, value]) => value === true).map(([label]) => label);
  const missing = checks.filter(([, value]) => value !== true).map(([label]) => label);
  const score = present.length / checks.length;

  return {
    country: record.country,
    score,
    tier: score >= 0.9 ? "excellent" : score >= 0.65 ? "usable" : score >= 0.35 ? "limited" : "not-open",
    missing,
    present,
  };
}

export function rankDataReadiness(records: ReadonlyArray<DataReadinessRecord>): DataReadinessScore[] {
  return records
    .map(scoreDataReadiness)
    .sort((a, b) => b.score - a.score || a.country.localeCompare(b.country));
}

function hasCoordinates(record: MonitorMetadataRecord): boolean {
  return finite(record.latitude) && finite(record.longitude);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function share<T>(records: ReadonlyArray<T>, predicate: (record: T) => boolean): number {
  if (records.length === 0) return 0;
  return records.filter(predicate).length / records.length;
}
