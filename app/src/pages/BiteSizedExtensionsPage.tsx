import { useMemo, useState } from "react";

import {
  coExposureScore,
  decomposeSuperPollutants,
  humanCentricMetrics,
  lifeExpectancyLoss,
  paleoTimeline,
  summarizeBlockTrends,
  yllAcrossPopulations,
  type SuperPollutant,
} from "@patool/shared";

import { Card, DataTable, EChart, PageHeader, StatCard, type Column } from "../components";
import styles from "./ToolsetPage.module.css";

const DEFAULT_EMISSIONS: { pollutant: SuperPollutant; tonnesPerYear: number }[] = [
  { pollutant: "co2", tonnesPerYear: 5_000_000 },
  { pollutant: "ch4", tonnesPerYear: 30_000 },
  { pollutant: "bc", tonnesPerYear: 800 },
  { pollutant: "o3-trop", tonnesPerYear: 60_000 },
];

export default function BiteSizedExtensionsPage() {
  const [pm25, setPm25] = useState(45);
  const yll = useMemo(() => lifeExpectancyLoss(pm25), [pm25]);
  const humanCentric = useMemo(() => humanCentricMetrics({ pm25Annual: pm25, no2Annual: 25, o3Summer: 70 }), [pm25]);
  const decomposition = useMemo(() => decomposeSuperPollutants(DEFAULT_EMISSIONS), []);
  const paleo = useMemo(() => paleoTimeline(), []);
  const pollen = useMemo(() => coExposureScore(pm25, [
    { category: "tree", index: 1500 }, { category: "grass", index: 700 }, { category: "mold", index: 200 },
  ]), [pm25]);
  const populations = useMemo(() => yllAcrossPopulations([
    { label: "Delhi", population: 32_000_000, pm25Exposure: 110 },
    { label: "Kolkata", population: 14_900_000, pm25Exposure: 90 },
    { label: "Mumbai", population: 21_000_000, pm25Exposure: 60 },
  ]), []);
  const trends = useMemo(() => summarizeBlockTrends(), []);

  const trendCols: Column<typeof trends[number]>[] = [
    { key: "state", header: "State", render: (r) => r.state },
    { key: "block", header: "Block", render: (r) => r.block },
    { key: "first", header: `First (${trends[0]?.firstYear ?? ""})`, render: (r) => r.firstPm25.toFixed(1) },
    { key: "last", header: `Last (${trends[0]?.lastYear ?? ""})`, render: (r) => r.lastPm25.toFixed(1) },
    { key: "decade", header: "Δ/decade", render: (r) => r.changePerDecade.toFixed(2) },
  ];

  const popCols: Column<typeof populations[number]>[] = [
    { key: "label", header: "Population", render: (r) => r.label },
    { key: "pop", header: "People", render: (r) => r.population.toLocaleString() },
    { key: "pm", header: "PM2.5", render: (r) => r.pm25Exposure.toFixed(1) },
    { key: "ll", header: "YLL/person", render: (r) => r.yearsLifeLostPerPerson.toFixed(2) },
    { key: "total", header: "Total person-years", render: (r) => r.totalPersonYearsLost.toLocaleString(undefined, { maximumFractionDigits: 0 }) },
  ];

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow="biteSizedAQ"
        title="Super pollutants, life expectancy, and human-centric metrics"
        subtitle="Composite metrics inspired by biteSizedAQ notebooks #11, #12, #19, #20, and #24, plus the multi-year India block series."
      />
      <div className={styles.stats}>
        <StatCard label="PM2.5 (µg/m³)" value={pm25.toFixed(1)} />
        <StatCard label="Life expectancy lost" value={`${yll.yearsLifeLost.toFixed(2)} yr`} />
        <StatCard label="FEV1 loss" value={`${humanCentric.fev1PercentLoss.toFixed(2)} %`} />
        <StatCard label="Pollen × PM warning" value={pollen.warningLevel} />
      </div>

      <Card title="Configuration">
        <div className={styles.controls}>
          <label className={styles.field}>
            <span>Annual PM2.5 exposure (µg/m³)</span>
            <input type="number" min={0} step={1} value={pm25} onChange={(event) => setPm25(Number(event.target.value))} />
          </label>
        </div>
      </Card>

      <Card title="Super-pollutant decomposition">
        <EChart
          option={{
            tooltip: { trigger: "axis" },
            xAxis: { type: "category", data: decomposition.rows.map((r) => r.pollutant) },
            yAxis: [{ type: "value", name: "tCO₂e (20yr)" }, { type: "value", name: "Premature deaths/yr" }],
            series: [
              { name: "CO₂e (20yr)", type: "bar", data: decomposition.rows.map((r) => r.co2eq20) },
              { name: "CO₂e (100yr)", type: "bar", data: decomposition.rows.map((r) => r.co2eq100) },
              { name: "Deaths/yr", type: "line", yAxisIndex: 1, data: decomposition.rows.map((r) => r.prematureDeathsPerYear) },
            ],
          }}
          height={320}
        />
      </Card>

      <div className={styles.splitGrid}>
        <Card title="Paleoclimatology baseline anchors">
          <EChart
            option={{
              tooltip: {},
              xAxis: { type: "category", data: paleo.map((p) => p.yearLabel) },
              yAxis: { type: "value", name: "Annual PM2.5 µg/m³" },
              series: [{ type: "bar", data: paleo.map((p) => p.pm25), itemStyle: { color: "#7a8d6a" } }],
            }}
            height={280}
          />
        </Card>
        <Card title="Population-weighted YLL">
          <DataTable columns={popCols} data={populations} rowKey={(r) => r.label} pageSize={8} />
        </Card>
      </div>

      <Card title="India block-level PM2.5 trends (1998–2023)">
        <DataTable columns={trendCols} data={trends} rowKey={(r) => `${r.state}-${r.block}`} pageSize={10} />
      </Card>
    </div>
  );
}
