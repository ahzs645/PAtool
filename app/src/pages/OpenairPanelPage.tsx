import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  calendarPlot,
  corPlot,
  scatterPlot,
  timeVariation,
  trendLevel,
  whittakerSmooth,
  type PatSeries,
} from "@patool/shared";

import { Card, EChart, Loader, PageHeader, StatCard } from "../components";
import { getJson } from "../lib/api";
import styles from "./ToolsetPage.module.css";

type Panel = "timeVariation" | "calendar" | "corPlot" | "scatter" | "trendLevel";

export default function OpenairPanelPage() {
  const [sensorId, setSensorId] = useState("1001");
  const [panel, setPanel] = useState<Panel>("timeVariation");

  const { data: series, isLoading } = useQuery({
    queryKey: ["openair-panels", sensorId],
    queryFn: () => getJson<PatSeries>(`/api/pat?id=${sensorId}&aggregate=hourly`),
  });

  const dated = useMemo(() => {
    if (!series) return [];
    return series.points
      .map((p) => ({
        timestamp: p.timestamp,
        value: ((p.pm25A ?? 0) + (p.pm25B ?? 0)) / 2,
        humidity: p.humidity ?? null,
        temperature: p.temperature ?? null,
      }))
      .filter((p) => Number.isFinite(p.value));
  }, [series]);

  const tv = useMemo(() => timeVariation(dated), [dated]);
  const cal = useMemo(() => calendarPlot(dated, { statistic: "mean" }), [dated]);
  const cor = useMemo(() => corPlot(dated.map((d) => ({
    pm25: d.value,
    humidity: d.humidity as number,
    temperature: d.temperature as number,
  }))), [dated]);
  const scatter = useMemo(() => scatterPlot(dated.map((d) => ({ x: d.temperature ?? 0, y: d.value })), { bins: 24 }), [dated]);
  const trend = useMemo(() => trendLevel(dated, { statistic: "mean" }), [dated]);
  const smoothed = useMemo(() => whittakerSmooth(dated.map((d) => d.value), 75), [dated]);

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow="Openair"
        title="Time, calendar, correlation, and trend panels"
        subtitle="Ported from openair: timeVariation, calendarPlot, corPlot, scatterPlot, trendLevel. Switch panels with the selector."
      />
      <div className={styles.stats}>
        <StatCard label="Sensor" value={sensorId} />
        <StatCard label="Hours loaded" value={String(dated.length)} />
        <StatCard label="Smooth λ" value="75" />
        <StatCard label="Panel" value={panel} />
      </div>

      <Card title="Configuration">
        <div className={styles.controls}>
          <label className={styles.field}>
            <span>Sensor ID</span>
            <input value={sensorId} onChange={(event) => setSensorId(event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Panel</span>
            <select value={panel} onChange={(event) => setPanel(event.target.value as Panel)}>
              <option value="timeVariation">Time variation</option>
              <option value="calendar">Calendar heatmap</option>
              <option value="corPlot">Correlation matrix</option>
              <option value="scatter">Scatter (T vs PM)</option>
              <option value="trendLevel">Trend level</option>
            </select>
          </label>
        </div>
      </Card>

      {isLoading && <Loader message="Loading sensor history..." />}

      {panel === "timeVariation" && (
        <Card title="Diurnal variation">
          <EChart
            option={{
              tooltip: { trigger: "axis" },
              xAxis: { type: "category", data: tv.hour.map((b) => b.bin), name: "Hour" },
              yAxis: { type: "value", name: "PM2.5" },
              series: [
                { name: "Mean", type: "line", data: tv.hour.map((b) => b.mean) },
                { name: "Median", type: "line", data: tv.hour.map((b) => b.median) },
              ],
            }}
            height={320}
          />
        </Card>
      )}

      {panel === "calendar" && (
        <Card title="Daily mean (calendar)">
          <EChart
            option={{
              tooltip: { trigger: "item" },
              xAxis: { type: "category", data: cal.map((c) => c.date) },
              yAxis: { type: "value", name: "PM2.5" },
              series: [{ type: "bar", data: cal.map((c) => c.value), itemStyle: { color: "#7b8cde" } }],
            }}
            height={320}
            zoomable
          />
        </Card>
      )}

      {panel === "corPlot" && (
        <Card title="Pollutant × meteorology correlations">
          <EChart
            option={{
              tooltip: { trigger: "item" },
              xAxis: { type: "category", data: cor.order, name: "Variable" },
              yAxis: { type: "category", data: cor.order, name: "Variable" },
              visualMap: { min: -1, max: 1, calculable: true, orient: "horizontal", left: "center", bottom: 0 },
              series: [{
                type: "heatmap",
                data: cor.cells.map((c) => [cor.order.indexOf(c.rowVar), cor.order.indexOf(c.colVar), Number(c.r.toFixed(3))]),
              }],
            }}
            height={360}
          />
        </Card>
      )}

      {panel === "scatter" && (
        <Card title="Scatter density (Temperature × PM2.5)">
          <EChart
            option={{
              tooltip: {},
              xAxis: { type: "value", name: "Temperature" },
              yAxis: { type: "value", name: "PM2.5" },
              series: [{
                type: "scatter",
                data: scatter.bins.map((b) => [b.x, b.y, b.count]),
                symbolSize: (d: number[]) => Math.max(4, Math.min(28, Math.sqrt(d[2]) * 4)),
              }],
            }}
            height={320}
          />
        </Card>
      )}

      {panel === "trendLevel" && (
        <Card title="Trend level — monthly heatmap">
          <EChart
            option={{
              tooltip: {},
              xAxis: { type: "category", data: trend.map((t) => `${t.year}-${String(t.month).padStart(2, "0")}`) },
              yAxis: { type: "value", name: "PM2.5" },
              series: [
                { name: "Monthly mean", type: "bar", data: trend.map((t) => Number(t.value.toFixed(2))) },
                {
                  name: "Whittaker smoother (full series)",
                  type: "line",
                  showSymbol: false,
                  data: smoothed.map((v, i) => [i, Number(v.toFixed(2))]),
                  xAxisIndex: 0,
                },
              ],
            }}
            height={360}
          />
        </Card>
      )}
    </div>
  );
}
