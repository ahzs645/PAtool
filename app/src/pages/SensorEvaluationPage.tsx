import { useMemo, useState } from "react";

import {
  cleanPurpleairAB,
  coefficientOfVariation,
  detectWarmupEvents,
  DEFAULT_RH_BINS,
  listPollutantReportTemplates,
  modStats,
  stratifyByHumidity,
  stratifyByTemperature,
  summarizeCv,
  targetDiagram,
} from "@patool/shared";

import { Card, DataTable, EChart, PageHeader, StatCard, type Column } from "../components";
import styles from "./ToolsetPage.module.css";

type SimRow = {
  obs: number;
  mod: number;
  temperature: number;
  humidity: number;
};

function simulate(n = 240): { datetime: string[]; sensors: Array<Array<number | null>>; ref: number[]; ab: Array<{ timestamp: string; a: number | null; b: number | null }>; pairs: SimRow[] } {
  const datetime: string[] = [];
  const sensors: Array<Array<number | null>> = [[], [], []];
  const ref: number[] = [];
  const ab: Array<{ timestamp: string; a: number | null; b: number | null }> = [];
  const pairs: SimRow[] = [];
  const start = new Date(Date.UTC(2024, 0, 1, 0)).getTime();
  for (let i = 0; i < n; i += 1) {
    const t = new Date(start + i * 3600 * 1000).toISOString();
    datetime.push(t);
    const truth = 8 + Math.sin(i / 8) * 5 + (i / n) * 4;
    ref.push(truth);
    const temperature = 12 + Math.sin(i / 24) * 10;
    const humidity = 55 + Math.cos(i / 12) * 18;
    pairs.push({ obs: truth, mod: truth * 1.05 + 0.5 + Math.cos(i / 7) * 0.4, temperature, humidity });
    for (let s = 0; s < 3; s += 1) {
      const drift = 0.02 * s + Math.cos(i / 9 + s) * 0.3;
      sensors[s].push(truth + drift);
    }
    const a = truth + Math.cos(i / 5) * 0.6;
    const b = i % 41 === 0 ? null : truth + Math.sin(i / 5) * 0.6;
    ab.push({ timestamp: t, a, b });
  }
  return { datetime, sensors, ref, ab, pairs };
}

export default function SensorEvaluationPage() {
  const [warmupThreshold, setWarmupThreshold] = useState(0.5);
  const sim = useMemo(() => simulate(), []);
  const cv = useMemo(() => coefficientOfVariation(sim.datetime, sim.sensors), [sim]);
  const cvSummary = useMemo(() => summarizeCv(cv), [cv]);
  const stratT = useMemo(() => stratifyByTemperature(sim.pairs), [sim]);
  const stratH = useMemo(() => stratifyByHumidity(sim.pairs, DEFAULT_RH_BINS), [sim]);
  const target = useMemo(() => targetDiagram(sim.ref, [
    { label: "Sensor 1", values: sim.sensors[0] },
    { label: "Sensor 2", values: sim.sensors[1] },
    { label: "Sensor 3", values: sim.sensors[2] },
  ]), [sim]);
  const ab = useMemo(() => cleanPurpleairAB(sim.ab), [sim]);
  const warmup = useMemo(
    () => detectWarmupEvents(sim.sensors[0], { stabilityThreshold: warmupThreshold, consecutive: 3 }),
    [sim, warmupThreshold],
  );
  const fitAll = useMemo(() => modStats(sim.pairs), [sim]);
  const templates = useMemo(() => listPollutantReportTemplates(), []);

  const stratCols: Column<typeof stratT.rows[number]>[] = [
    { key: "bin", header: "Bin", render: (row) => row.bin.label },
    { key: "n", header: "N", render: (row) => row.stats.n },
    { key: "r", header: "r", render: (row) => row.stats.r.toFixed(2) },
    { key: "rmse", header: "RMSE", render: (row) => row.stats.RMSE.toFixed(2) },
    { key: "mb", header: "Bias", render: (row) => row.stats.MB.toFixed(2) },
    { key: "share", header: "Share", render: (row) => `${(row.share * 100).toFixed(1)}%` },
  ];

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow="Sensortoolkit"
        title="Reference-grade sensor evaluation"
        subtitle="Climate-stratified metrics, intra-sensor CV, target diagram, A/B channel cleaning, warm-up detection, and EPA pollutant report templates."
      />
      <div className={styles.stats}>
        <StatCard label="Pairs" value={String(sim.pairs.length)} />
        <StatCard label="Mean CV" value={`${cvSummary.mean.toFixed(1)}%`} />
        <StatCard label="Max CV" value={`${cvSummary.max.toFixed(1)}%`} />
        <StatCard label="All-data r" value={fitAll.r.toFixed(2)} />
      </div>

      <Card title="Target diagram">
        <EChart
          option={{
            tooltip: {},
            xAxis: { type: "value", name: "Unbiased RMSE / σref" },
            yAxis: { type: "value", name: "Bias / σref" },
            series: [{
              type: "scatter",
              symbolSize: 18,
              data: target.points.map((p) => [p.ubRmseNorm, p.bias, p.label] as [number, number, string]),
              label: { show: true, formatter: (d: { data: [number, number, string] }) => d.data[2] },
            }],
          }}
          height={320}
        />
      </Card>

      <div className={styles.splitGrid}>
        <Card title="Coefficient of variation (intra-sensor)">
          <EChart
            option={{
              tooltip: { trigger: "axis" },
              xAxis: { type: "time" },
              yAxis: { type: "value", name: "CV %" },
              series: [{
                name: "CV %",
                type: "line",
                showSymbol: false,
                data: cv.datetime.map((t, i) => [t, cv.cv[i] !== null ? Number((cv.cv[i] as number).toFixed(2)) : null]),
              }],
            }}
            height={300}
          />
        </Card>
        <Card title="A/B channel agreement (Barkjohn 2021)">
          <EChart
            option={{
              tooltip: { trigger: "axis" },
              xAxis: { type: "time" },
              yAxis: { type: "value", name: "Cleaned PM" },
              series: [{
                name: "PM cleaned",
                type: "line",
                showSymbol: false,
                data: ab.pm25Cleaned.map((p) => [p.timestamp, p.value]),
              }],
            }}
            height={300}
          />
        </Card>
      </div>

      <div className={styles.splitGrid}>
        <Card title="Stratified by temperature">
          <DataTable columns={stratCols} data={stratT.rows} rowKey={(r) => r.bin.label} pageSize={8} />
        </Card>
        <Card title="Stratified by humidity">
          <DataTable columns={stratCols} data={stratH.rows} rowKey={(r) => r.bin.label} pageSize={8} />
        </Card>
      </div>

      <Card title="Warm-up detection">
        <div className={styles.controls}>
          <label className={styles.field}>
            <span>Stability Δ threshold</span>
            <input
              type="number"
              step={0.1}
              value={warmupThreshold}
              onChange={(event) => setWarmupThreshold(Number(event.target.value))}
            />
          </label>
          <span>
            {warmup.events.length} warm-up event{warmup.events.length === 1 ? "" : "s"} detected
          </span>
        </div>
      </Card>

      <Card title="Pollutant-specific report templates">
        <DataTable
          columns={[
            { key: "pollutant", header: "Pollutant", render: (row) => row.pollutant.toUpperCase() },
            { key: "tmpl", header: "Template", render: (row) => row.templateName },
            { key: "avg", header: "Averaging", render: (row) => row.averagingPeriod },
            { key: "tgt", header: "Targets",
              render: (row) => row.performanceTargetsTable
                .map((t) => `${t.metric}: ${t.target}`).join(", ") || "—" },
          ]}
          data={templates}
          rowKey={(r) => r.pollutant}
          pageSize={10}
        />
      </Card>
    </div>
  );
}
