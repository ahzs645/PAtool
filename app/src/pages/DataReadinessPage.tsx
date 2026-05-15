import { useMemo } from "react";
import type { EChartsCoreOption } from "echarts/core";

import {
  bitesizedDataReadinessScores,
  bitesizedMonitorMetadataSummary,
  bitesizedStandardsCoverage,
  countStandardsCoverageBuckets,
} from "@patool/shared";

import { Card, PageHeader, StatCard } from "../components";
import { EChart } from "../components/EChart";
import { useChartTheme } from "../hooks/useChartTheme";
import styles from "./DataReadinessPage.module.css";

const STRICTNESS_COUNTRIES = new Set(["India", "United States of America", "Norway", "Brazil", "Vanuatu"]);

export default function DataReadinessPage() {
  const chartTheme = useChartTheme();
  const readiness = bitesizedDataReadinessScores;
  const metadata = bitesizedMonitorMetadataSummary;
  const standards = bitesizedStandardsCoverage;
  const standardsBuckets = useMemo(() => countStandardsCoverageBuckets(standards), [standards]);
  const readinessRows = useMemo(() => readiness.slice(0, 12), [readiness]);
  const metadataRows = useMemo(() => metadata.slice(0, 12), [metadata]);
  const strictnessRows = useMemo(() => {
    const selected = standards.filter((row) => STRICTNESS_COUNTRIES.has(row.country));
    return selected.length ? selected : standards.slice(0, 8);
  }, [standards]);
  const openSources = readiness.filter((row) => row.tier === "excellent" || row.tier === "usable").length;
  const metadataMean = metadata.reduce((total, row) => total + row.metadataCompleteness, 0) / metadata.length;
  const fullStandardsCoverage = standards.filter((row) => row.pollutantCount === 6).length;

  const readinessOption = useMemo<EChartsCoreOption>(() => ({
    color: chartTheme.colors,
    tooltip: { trigger: "axis" },
    grid: { left: 92, right: 18, top: 16, bottom: 28 },
    xAxis: { type: "value", max: 1, axisLabel: { color: chartTheme.text, formatter: (value: number) => `${Math.round(value * 100)}%` }, splitLine: { lineStyle: { color: chartTheme.grid } } },
    yAxis: { type: "category", data: readinessRows.map((row) => row.country), axisLabel: { color: chartTheme.text }, axisLine: { lineStyle: { color: chartTheme.axis } } },
    series: [{ type: "bar", data: readinessRows.map((row) => Number(row.score.toFixed(2))), barMaxWidth: 22 }],
  }), [chartTheme, readinessRows]);

  const metadataOption = useMemo<EChartsCoreOption>(() => ({
    color: chartTheme.colors,
    tooltip: { trigger: "axis" },
    legend: { textStyle: { color: chartTheme.text } },
    grid: { left: 42, right: 12, top: 34, bottom: 28 },
    xAxis: { type: "category", data: metadataRows.map((row) => row.iso), axisLabel: { color: chartTheme.text }, axisLine: { lineStyle: { color: chartTheme.axis } } },
    yAxis: { type: "value", max: 1, axisLabel: { color: chartTheme.text, formatter: (value: number) => `${Math.round(value * 100)}%` }, splitLine: { lineStyle: { color: chartTheme.grid } } },
    series: [
      { name: "Coordinates", type: "bar", data: metadataRows.map((row) => row.coordinateCoverage) },
      { name: "Official type", type: "bar", data: metadataRows.map((row) => row.officialTypeCoverage) },
      { name: "Completeness", type: "line", smooth: true, data: metadataRows.map((row) => Number(row.metadataCompleteness.toFixed(2))) },
    ],
  }), [chartTheme, metadataRows]);

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
            {readinessRows.map((row) => (
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
            {strictnessRows.map((row) => (
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
