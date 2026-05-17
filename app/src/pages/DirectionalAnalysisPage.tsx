import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  generateSyntheticWindData,
  polarCluster,
  pollutionRose,
  smoothTrend,
  theilSenTrend,
  type PatSeries,
} from "@patool/shared";

import { Card, DataTable, EChart, Loader, PageHeader, StatCard, type Column } from "../components";
import { getJson } from "../lib/api";
import styles from "./ToolsetPage.module.css";

const DEFAULT_SENSOR_ID = "1001";

export default function DirectionalAnalysisPage() {
  const [sensorId, setSensorId] = useState(DEFAULT_SENSOR_ID);
  const { data: series, isLoading } = useQuery({
    queryKey: ["directional-series", sensorId],
    queryFn: () => getJson<PatSeries>(`/api/pat?id=${sensorId}&aggregate=hourly`),
  });
  const wind = useMemo(() => series ? generateSyntheticWindData(series) : [], [series]);
  const rose = useMemo(() => pollutionRose(wind), [wind]);
  const clusters = useMemo(() => polarCluster(wind), [wind]);
  const trendRows = useMemo(() => smoothTrend(wind.map((row) => ({ timestamp: row.timestamp, value: row.pm25 })), 9), [wind]);
  const trend = useMemo(() => theilSenTrend(wind.map((row) => ({ timestamp: row.timestamp, value: row.pm25 }))), [wind]);

  const columns: Column<(typeof rose)[number]>[] = [
    { key: "dir", header: "Direction", render: (row) => row.label },
    { key: "count", header: "Count", render: (row) => row.count },
    { key: "freq", header: "Frequency", render: (row) => `${(row.frequency * 100).toFixed(1)}%` },
    { key: "mean", header: "Mean PM2.5", render: (row) => row.mean.toFixed(2) },
    { key: "median", header: "Median", render: (row) => row.median.toFixed(2) },
    { key: "max", header: "Max", render: (row) => row.max.toFixed(2) },
  ];

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow="Directional Analysis"
        title="Openair-style wind and source diagnostics"
        subtitle="Pollution rose, directional clusters, and Theil-Sen/smoothed trends for sensor time series."
      />
      <div className={styles.stats}>
        <StatCard label="Sensor" value={sensorId} />
        <StatCard label="Wind points" value={String(wind.length)} />
        <StatCard label="Theil-Sen slope/day" value={trend.slopePerDay.toFixed(3)} />
        <StatCard label="Clusters" value={String(clusters.length)} />
      </div>
      <Card title="Configuration">
        <div className={styles.controls}>
          <label className={styles.field}>
            <span>Sensor ID</span>
            <input value={sensorId} onChange={(event) => setSensorId(event.target.value)} />
          </label>
        </div>
      </Card>
      {isLoading && <Loader message="Loading sensor history..." />}
      <div className={styles.splitGrid}>
        <Card title="Pollution rose">
          <EChart option={{
            tooltip: {},
            xAxis: { type: "category", data: rose.map((row) => row.label) },
            yAxis: { type: "value", name: "PM2.5" },
            series: [{ type: "bar", data: rose.map((row) => row.mean) }],
          }} height={320} />
        </Card>
        <Card title="Smoothed trend">
          <EChart option={{
            tooltip: { trigger: "axis" },
            xAxis: { type: "time" },
            yAxis: { type: "value", name: "PM2.5" },
            series: [
              { name: "Observed", type: "line", showSymbol: false, data: trendRows.map((row) => [row.timestamp, row.observed]) },
              { name: "Smooth", type: "line", showSymbol: false, data: trendRows.map((row) => [row.timestamp, row.smooth]) },
            ],
          }} height={320} zoomable />
        </Card>
      </div>
      <Card title="Directional bins">
        <DataTable columns={columns} data={rose} rowKey={(row) => row.label} pageSize={16} />
      </Card>
    </div>
  );
}
