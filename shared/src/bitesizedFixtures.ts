import type { CountryStandardsCoverage } from "./standardsCoverage";
import type { DataReadinessScore, MonitorMetadataSummary } from "./dataReadiness";

import standardsCoverageJson from "./generated/bitesizedaq_standards_coverage.json";
import monitorMetadataSummaryJson from "./generated/bitesizedaq_monitor_metadata_summary.json";
import dataReadinessScoresJson from "./generated/bitesizedaq_data_readiness_scores.json";
import indiaPm25TrendsJson from "./generated/bitesizedaq_india_pm25_trends.json";
import indiaBlockSnapshotSummaryJson from "./generated/bitesizedaq_india_block_snapshot_summary.json";

export type IndiaPm25TrendRow = {
  state: string;
  year: number;
  minPm25: number;
  maxPm25: number;
  avgPm25: number;
};

export type IndiaBlockSnapshotSummaryRow = {
  state: string;
  subdistrictCount: number;
  population: number;
  populationWeightedPm25: number | null;
  aboveWhoPopulationFraction: number | null;
  aboveIndiaStandardPopulationFraction: number | null;
  minPm25: number | null;
  maxPm25: number | null;
};

export const bitesizedStandardsCoverage = standardsCoverageJson as CountryStandardsCoverage[];
export const bitesizedMonitorMetadataSummary = monitorMetadataSummaryJson as MonitorMetadataSummary[];
export const bitesizedDataReadinessScores = dataReadinessScoresJson as Array<DataReadinessScore & { dataSharingStatus?: string }>;
export const bitesizedIndiaPm25Trends = indiaPm25TrendsJson as IndiaPm25TrendRow[];
export const bitesizedIndiaBlockSnapshotSummary = indiaBlockSnapshotSummaryJson as IndiaBlockSnapshotSummaryRow[];
