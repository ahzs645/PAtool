import { useMemo } from "react";
import type { EChartsCoreOption } from "echarts/core";

import {
  rankDataReadiness,
  countStandardsCoverageBuckets,
  summarizeMonitorMetadata,
  summarizeStandardsCoverage,
  type AirQualityStandardRecord,
  type DataReadinessRecord,
  type MonitorMetadataRecord,
} from "@patool/shared";

import { Card, PageHeader, StatCard } from "../components";
import { EChart } from "../components/EChart";
import { useChartTheme } from "../hooks/useChartTheme";
import styles from "./DataReadinessPage.module.css";

const readinessRecords: DataReadinessRecord[] = [
  {
    country: "United States",
    governmentMonitoring2024: true,
    publicAccessInCountry: true,
    fullyTransparent: true,
    physicalUnitsAvailable: true,
    stationCoordinatesAvailable: true,
    timelyFineScaleAvailable: true,
    programmaticAccessAvailable: true,
  },
  {
    country: "India",
    governmentMonitoring2024: true,
    publicAccessInCountry: true,
    partiallyTransparent: true,
    physicalUnitsAvailable: true,
    stationCoordinatesAvailable: true,
    timelyFineScaleAvailable: false,
    programmaticAccessAvailable: false,
  },
  {
    country: "Brazil",
    governmentMonitoring2024: true,
    publicAccessInCountry: true,
    partiallyTransparent: true,
    physicalUnitsAvailable: true,
    stationCoordinatesAvailable: false,
    timelyFineScaleAvailable: false,
    programmaticAccessAvailable: false,
  },
  {
    country: "Example no-monitor country",
    governmentMonitoring2024: false,
  },
];

const metadataRecords: MonitorMetadataRecord[] = [
  { uniqueId: "usa-1", iso: "usa", latitude: 39.0, longitude: -77.4, elevation: 88, area: "urban", type: "background", labeledArea: true, labeledType: false },
  { uniqueId: "usa-2", iso: "usa", latitude: 34.0, longitude: -118.2, elevation: 90, area: "urban", type: "traffic", labeledArea: true, labeledType: true },
  { uniqueId: "usa-3", iso: "usa", latitude: 47.6, longitude: -122.3, area: "urban", type: "background", labeledArea: true, labeledType: false },
  { uniqueId: "ind-1", iso: "ind", latitude: 28.6, longitude: 77.2, area: "urban", type: "background", labeledArea: true, labeledType: true },
  { uniqueId: "ind-2", iso: "ind", latitude: 19.0, longitude: 72.8, area: "urban", type: null, labeledArea: false, labeledType: false },
  { uniqueId: "bra-1", iso: "bra", latitude: -23.5, longitude: -46.2, area: "urban", type: "background", labeledArea: false, labeledType: false },
  { uniqueId: "bra-2", iso: "bra", latitude: -22.3, longitude: -48.5, area: "urban", type: "background", labeledArea: true, labeledType: false },
  { uniqueId: "ita-1", iso: "ita", latitude: 42.7, longitude: 12.6, elevation: 318, area: "urban", type: "non-background", labeledArea: true, labeledType: true },
];

const standardsRecords: AirQualityStandardRecord[] = [
  { iso3: "USA", country: "United States", pollutant: "PM25", duration: "yr", numericStandard: 9 },
  { iso3: "USA", country: "United States", pollutant: "PM10", duration: "24h", numericStandard: 150 },
  { iso3: "USA", country: "United States", pollutant: "NO2", duration: "1h", numericStandard: 188 },
  { iso3: "USA", country: "United States", pollutant: "SO2", duration: "1h", numericStandard: 196 },
  { iso3: "USA", country: "United States", pollutant: "O3", duration: "8h", numericStandard: 137 },
  { iso3: "USA", country: "United States", pollutant: "CO", duration: "8h", numericStandard: 10000 },
  { iso3: "IND", country: "India", pollutant: "PM25", duration: "yr", numericStandard: 40 },
  { iso3: "IND", country: "India", pollutant: "PM10", duration: "yr", numericStandard: 60 },
  { iso3: "IND", country: "India", pollutant: "NO2", duration: "yr", numericStandard: 40 },
  { iso3: "IND", country: "India", pollutant: "SO2", duration: "24h", numericStandard: 80 },
  { iso3: "IND", country: "India", pollutant: "O3", duration: "8h", numericStandard: 100 },
  { iso3: "IND", country: "India", pollutant: "CO", duration: "8h", numericStandard: 2000 },
  { iso3: "NOR", country: "Norway", pollutant: "PM25", duration: "yr", numericStandard: 5 },
  { iso3: "NOR", country: "Norway", pollutant: "PM10", duration: "yr", numericStandard: 20 },
  { iso3: "NOR", country: "Norway", pollutant: "NO2", duration: "yr", numericStandard: 30 },
  { iso3: "BRA", country: "Brazil", pollutant: "PM25", duration: "yr", numericStandard: null },
  { iso3: "BRA", country: "Brazil", pollutant: "PM10", duration: "24h", numericStandard: 120 },
  { iso3: "VUT", country: "Vanuatu", pollutant: "PM25", duration: "yr", numericStandard: null },
  { iso3: "VUT", country: "Vanuatu", pollutant: "PM10", duration: "yr", numericStandard: null },
];

export default function DataReadinessPage() {
  const chartTheme = useChartTheme();
  const readiness = useMemo(() => rankDataReadiness(readinessRecords), []);
  const metadata = useMemo(() => summarizeMonitorMetadata(metadataRecords), []);
  const standards = useMemo(() => summarizeStandardsCoverage(standardsRecords), []);
  const standardsBuckets = useMemo(() => countStandardsCoverageBuckets(standards), [standards]);
  const openSources = readiness.filter((row) => row.tier === "excellent" || row.tier === "usable").length;
  const metadataMean = metadata.reduce((total, row) => total + row.metadataCompleteness, 0) / metadata.length;
  const fullStandardsCoverage = standards.filter((row) => row.pollutantCount === 6).length;

  const readinessOption = useMemo<EChartsCoreOption>(() => ({
    color: chartTheme.colors,
    tooltip: { trigger: "axis" },
    grid: { left: 92, right: 18, top: 16, bottom: 28 },
    xAxis: { type: "value", max: 1, axisLabel: { color: chartTheme.text, formatter: (value: number) => `${Math.round(value * 100)}%` }, splitLine: { lineStyle: { color: chartTheme.grid } } },
    yAxis: { type: "category", data: readiness.map((row) => row.country), axisLabel: { color: chartTheme.text }, axisLine: { lineStyle: { color: chartTheme.axis } } },
    series: [{ type: "bar", data: readiness.map((row) => Number(row.score.toFixed(2))), barMaxWidth: 22 }],
  }), [chartTheme, readiness]);

  const metadataOption = useMemo<EChartsCoreOption>(() => ({
    color: chartTheme.colors,
    tooltip: { trigger: "axis" },
    legend: { textStyle: { color: chartTheme.text } },
    grid: { left: 42, right: 12, top: 34, bottom: 28 },
    xAxis: { type: "category", data: metadata.map((row) => row.iso), axisLabel: { color: chartTheme.text }, axisLine: { lineStyle: { color: chartTheme.axis } } },
    yAxis: { type: "value", max: 1, axisLabel: { color: chartTheme.text, formatter: (value: number) => `${Math.round(value * 100)}%` }, splitLine: { lineStyle: { color: chartTheme.grid } } },
    series: [
      { name: "Coordinates", type: "bar", data: metadata.map((row) => row.coordinateCoverage) },
      { name: "Official type", type: "bar", data: metadata.map((row) => row.officialTypeCoverage) },
      { name: "Completeness", type: "line", smooth: true, data: metadata.map((row) => Number(row.metadataCompleteness.toFixed(2))) },
    ],
  }), [chartTheme, metadata]);

  const standardsOption = useMemo<EChartsCoreOption>(() => ({
    color: chartTheme.colors,
    tooltip: { trigger: "axis" },
    grid: { left: 42, right: 12, top: 20, bottom: 34 },
    xAxis: { type: "category", data: standardsBuckets.map((row) => String(row.pollutantCount)), axisLabel: { color: chartTheme.text }, axisLine: { lineStyle: { color: chartTheme.axis } } },
    yAxis: { type: "value", name: "countries", axisLabel: { color: chartTheme.text }, splitLine: { lineStyle: { color: chartTheme.grid } } },
    series: [{ type: "bar", data: standardsBuckets.map((row) => row.countries), barMaxWidth: 38 }],
  }), [chartTheme, standardsBuckets]);

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow="Data Readiness"
        title="Score monitoring openness and metadata gaps"
        subtitle="Inspired by biteSizedAQ's OpenAQ transparency summary and METAIR metadata-gap visual. This turns source provenance into a first-class modeling signal."
      />

      <div className={styles.stats}>
        <StatCard label="Sources scored" value={String(readiness.length)} />
        <StatCard label="Open / usable" value={String(openSources)} tone={openSources >= 2 ? "good" : "warn"} />
        <StatCard label="Countries with monitors" value={String(metadata.length)} />
        <StatCard label="Metadata completeness" value={`${Math.round(metadataMean * 100)}%`} tone={metadataMean >= 0.75 ? "good" : "warn"} />
        <StatCard label="Full standards coverage" value={`${fullStandardsCoverage}/${standards.length}`} />
      </div>

      <div className={styles.splitGrid}>
        <Card title="Readiness score">
          <EChart option={readinessOption} height={320} />
        </Card>
        <Card title="Ranked source readiness">
          <ul className={styles.rankList}>
            {readiness.map((row) => (
              <li key={row.country}>
                <span className={styles.country}>{row.country}</span>
                <span className={styles.bar} aria-label={`${row.country} readiness ${Math.round(row.score * 100)}%`}>
                  <span className={styles.barFill} style={{ width: `${row.score * 100}%` }} />
                </span>
                <span className={styles.tier}>{row.tier}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className={styles.splitGrid}>
        <Card title="Monitor metadata coverage">
          <EChart option={metadataOption} height={320} />
        </Card>
        <Card title="What this unlocks">
          <ul className={styles.noteList}>
            <li><strong>Model eligibility</strong>Block weather normalization, kriging, or health summaries when coordinates, units, or time granularity are missing.</li>
            <li><strong>Provenance scoring</strong>Distinguish official labels from model-filled metadata so reports can expose inferred fields.</li>
            <li><strong>Source triage</strong>Rank countries, networks, or imports before investing time in ingestion and QA.</li>
            <li><strong>Report context</strong>Add an appendix-ready score explaining how complete and open the source data was.</li>
          </ul>
        </Card>
      </div>

      <div className={styles.splitGrid}>
        <Card title="National standards coverage">
          <EChart option={standardsOption} height={300} />
        </Card>
        <Card title="PM2.5 annual strictness">
          <ul className={styles.rankList}>
            {standards.map((row) => (
              <li key={row.iso3}>
                <span className={styles.country}>{row.country}</span>
                <span className={styles.bar} aria-label={`${row.country} standards coverage ${Math.round(row.coverageFraction * 100)}%`}>
                  <span className={styles.barFill} style={{ width: `${row.coverageFraction * 100}%` }} />
                </span>
                <span className={styles.tier}>{row.pm25AnnualTier}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
