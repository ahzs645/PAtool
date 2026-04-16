import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";

import {
  type PatSeries,
  type OutlierResult,
  type LinearFitResult,
  type ScatterMatrixData,
  type QcResult,
  type WindRoseData,
  type PolarPlotData,
} from "@patool/shared";

import {
  Loader,
  PageHeader,
  StatCard,
  Card,
  Button,
} from "../components";
import { EChart } from "../components/EChart";
import { getJson, postJson } from "../lib/api";
import { useChartTheme } from "../hooks/useChartTheme";
import styles from "./DiagnosticsPage.module.css";

/** Format a timestamp for x-axis: "Aug 1" for daily, "08/01 14:00" for sub-day */
function fmtDate(ts: string, total: number): string {
  const d = new Date(ts);
  const mo = d.toLocaleString("en", { month: "short" });
  const day = d.getDate();
  if (total > 2000) return `${mo} ${day}`;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${mo} ${day} ${hh}:${mm}`;
}

export default function DiagnosticsPage() {
  const { id: routeId } = useParams();
  const sensorId = routeId ?? "1001";
  const ct = useChartTheme();
  const [replaceMode, setReplaceMode] = useState(false);

  const { data: series } = useQuery({
    queryKey: ["diag-series", sensorId],
    queryFn: () => getJson<PatSeries>(`/api/pat?id=${sensorId}&aggregate=raw`),
  });

  const { data: outliers, refetch: refetchOutliers } = useQuery({
    queryKey: ["outliers", sensorId, series?.points.length, replaceMode],
    enabled: Boolean(series),
    queryFn: () =>
      postJson<OutlierResult>("/api/outliers", {
        series, windowSize: 7, thresholdMin: 3, replace: replaceMode,
      }),
  });

  const { data: fit } = useQuery({
    queryKey: ["fit-internal", sensorId, series?.points.length],
    enabled: Boolean(series),
    queryFn: () => postJson<LinearFitResult>("/api/fit/internal", { series }),
  });

  /* on-demand sections */
  const [scatterMatrix, setScatterMatrix] = useState<ScatterMatrixData | null>(null);
  const [scatterLoading, setScatterLoading] = useState(false);
  const [qcResult, setQcResult] = useState<QcResult | null>(null);
  const [qcLoading, setQcLoading] = useState(false);
  const [windRose, setWindRose] = useState<WindRoseData | null>(null);
  const [polarPlot, setPolarPlot] = useState<PolarPlotData | null>(null);
  const [windLoading, setWindLoading] = useState(false);

  /* ── Shared axis helper ── */
  const timeAxis = useMemo(() => {
    if (!series) return { labels: [] as string[], interval: 0 };
    const n = series.points.length;
    const labels = series.points.map((p) => fmtDate(p.timestamp, n));
    // Show ~8-12 labels max
    const interval = Math.max(1, Math.floor(n / 10));
    return { labels, interval };
  }, [series]);

  const baseTooltip = {
    backgroundColor: ct.tooltipBg,
    borderColor: ct.tooltipBorder,
    textStyle: { color: ct.tooltipText, fontSize: 11 },
  };

  /* ── Outlier chart ── */
  const outlierChartOption = useMemo(() => {
    if (!series || !outliers) return null;
    const outlierSet = new Set(outliers.outlierIndices);
    const pm25 = series.points.map((p) =>
      p.pm25A !== null && p.pm25B !== null ? ((p.pm25A + p.pm25B) / 2) : null
    );
    const outlierPts = series.points.map((p, i) =>
      outlierSet.has(i) && p.pm25A !== null && p.pm25B !== null
        ? (p.pm25A + p.pm25B) / 2 : null
    );
    return {
      textStyle: { fontFamily: "Inter, sans-serif", color: ct.text },
      tooltip: { trigger: "axis" as const, ...baseTooltip },
      legend: { top: 0, textStyle: { color: ct.text, fontSize: 10 } },
      grid: { top: 28, right: 12, bottom: 28, left: 44 },
      xAxis: {
        type: "category" as const,
        data: timeAxis.labels,
        axisLabel: { color: ct.axis, fontSize: 9, interval: timeAxis.interval, rotate: 0 },
        axisLine: { lineStyle: { color: ct.grid } },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value" as const, name: "PM2.5",
        nameTextStyle: { color: ct.axis, fontSize: 9 },
        axisLabel: { color: ct.axis, fontSize: 9 },
        splitLine: { lineStyle: { color: ct.grid } },
      },
      series: [
        { name: "PM2.5 Avg", type: "line" as const, smooth: true, data: pm25, color: ct.colors[0], symbol: "none" },
        { name: "Outliers", type: "scatter" as const, data: outlierPts, itemStyle: { color: "#e06c5e" }, symbolSize: 6 },
      ],
    };
  }, [series, outliers, ct, timeAxis, baseTooltip]);

  /* ── Fit scatter ── */
  const fitChartOption = useMemo(() => {
    if (!series || !fit) return null;
    const pairs = series.points
      .filter((p) => p.pm25A !== null && p.pm25B !== null)
      .map((p) => [p.pm25A!, p.pm25B!]);
    const aVals = pairs.map((p) => p[0]);
    const minA = Math.min(...aVals), maxA = Math.max(...aVals);
    return {
      textStyle: { fontFamily: "Inter, sans-serif", color: ct.text },
      tooltip: { trigger: "item" as const, ...baseTooltip },
      grid: { top: 12, right: 12, bottom: 28, left: 44 },
      xAxis: {
        type: "value" as const, name: "PM2.5 A",
        nameTextStyle: { color: ct.axis, fontSize: 9 },
        axisLabel: { color: ct.axis, fontSize: 9 },
        splitLine: { lineStyle: { color: ct.grid } },
      },
      yAxis: {
        type: "value" as const, name: "PM2.5 B",
        nameTextStyle: { color: ct.axis, fontSize: 9 },
        axisLabel: { color: ct.axis, fontSize: 9 },
        splitLine: { lineStyle: { color: ct.grid } },
      },
      series: [
        { name: "A vs B", type: "scatter" as const, data: pairs, color: ct.colors[1], symbolSize: 3 },
        { name: "Fit", type: "line" as const, data: [[minA, fit.slope * minA + fit.intercept], [maxA, fit.slope * maxA + fit.intercept]], color: ct.colors[2], lineStyle: { width: 2 }, symbol: "none", smooth: false },
      ],
    };
  }, [series, fit, ct, baseTooltip]);

  /* ── Multi-panel ── */
  const multiPanelOptions = useMemo(() => {
    if (!series) return null;
    const sharedX = {
      type: "category" as const,
      data: timeAxis.labels,
      axisLabel: { color: ct.axis, fontSize: 8, interval: timeAxis.interval, rotate: 0 },
      axisLine: { lineStyle: { color: ct.grid } },
      splitLine: { show: false },
    };
    const base = {
      textStyle: { fontFamily: "Inter, sans-serif", color: ct.text },
      tooltip: { trigger: "axis" as const, ...baseTooltip },
      grid: { top: 24, right: 12, bottom: 36, left: 44 },
      xAxis: sharedX,
    };
    const mkY = (name: string) => ({
      type: "value" as const, name,
      nameTextStyle: { color: ct.axis, fontSize: 9 },
      axisLabel: { color: ct.axis, fontSize: 8 },
      splitLine: { lineStyle: { color: ct.grid } },
    });
    return [
      { ...base, legend: { top: 0, textStyle: { color: ct.text, fontSize: 9 } }, yAxis: mkY("PM2.5"), series: [
        { name: "A", type: "line" as const, smooth: true, data: series.points.map((p) => p.pm25A), color: ct.colors[0], symbol: "none" },
        { name: "B", type: "line" as const, smooth: true, data: series.points.map((p) => p.pm25B), color: ct.colors[2], symbol: "none" },
      ] },
      { ...base, legend: { show: false }, yAxis: mkY("Temp (F)"), series: [
        { name: "Temperature", type: "line" as const, smooth: true, data: series.points.map((p) => p.temperature), color: ct.colors[3], symbol: "none" },
      ] },
      { ...base, legend: { show: false }, yAxis: mkY("RH (%)"), series: [
        { name: "Humidity", type: "line" as const, smooth: true, data: series.points.map((p) => p.humidity), color: ct.colors[1], symbol: "none" },
      ] },
      { ...base, legend: { show: false }, yAxis: mkY("hPa"), series: [
        { name: "Pressure", type: "line" as const, smooth: true, data: series.points.map((p) => p.pressure), color: ct.colors[4], symbol: "none" },
      ] },
    ];
  }, [series, ct, timeAxis, baseTooltip]);

  /* ── Scatter matrix ── */
  const scatterMatrixOpts = useMemo(() => {
    if (!scatterMatrix) return null;
    return scatterMatrix.pairs.map((pair, idx) => ({
      textStyle: { fontFamily: "Inter, sans-serif", color: ct.text, fontSize: 9 },
      tooltip: { trigger: "item" as const, ...baseTooltip },
      grid: { top: 22, right: 6, bottom: 20, left: 32 },
      title: { text: `r=${pair.correlation.toFixed(2)}`, left: "center", top: 2, textStyle: { color: ct.text, fontSize: 9, fontWeight: "normal" as const } },
      xAxis: { type: "value" as const, name: pair.xVar, nameTextStyle: { color: ct.axis, fontSize: 7 }, axisLabel: { color: ct.axis, fontSize: 7 }, splitLine: { lineStyle: { color: ct.grid } } },
      yAxis: { type: "value" as const, name: pair.yVar, nameTextStyle: { color: ct.axis, fontSize: 7 }, axisLabel: { color: ct.axis, fontSize: 7 }, splitLine: { lineStyle: { color: ct.grid } } },
      series: [{ type: "scatter" as const, data: pair.points, symbolSize: 2, itemStyle: { color: ct.colors[idx % ct.colors.length] } }],
    }));
  }, [scatterMatrix, ct, baseTooltip]);

  /* ── QC charts ── */
  const qcBarOption = useMemo(() => {
    if (!qcResult) return null;
    return {
      textStyle: { fontFamily: "Inter, sans-serif", color: ct.text },
      tooltip: { trigger: "axis" as const, ...baseTooltip },
      grid: { top: 12, right: 12, bottom: 32, left: 44 },
      xAxis: { type: "category" as const, data: qcResult.issues.map((i) => i.code), axisLabel: { color: ct.axis, fontSize: 9, rotate: 20 }, axisLine: { lineStyle: { color: ct.grid } } },
      yAxis: { type: "value" as const, name: "Count", axisLabel: { color: ct.axis, fontSize: 9 }, splitLine: { lineStyle: { color: ct.grid } } },
      series: [{ name: "Issues", type: "bar" as const, data: qcResult.issues.map((i) => i.count), itemStyle: { color: ct.colors[2] } }],
    };
  }, [qcResult, ct, baseTooltip]);

  const qcPieOption = useMemo(() => {
    if (!qcResult) return null;
    const ok = qcResult.totalPoints - qcResult.flaggedPoints - qcResult.removedPoints;
    return {
      textStyle: { fontFamily: "Inter, sans-serif", color: ct.text },
      tooltip: { trigger: "item" as const, ...baseTooltip },
      legend: { bottom: 0, textStyle: { color: ct.text, fontSize: 9 } },
      series: [{ name: "QC", type: "pie" as const, radius: ["30%", "60%"], center: ["50%", "45%"], data: [
        { name: "OK", value: ok, itemStyle: { color: ct.colors[1] } },
        { name: "Flagged", value: qcResult.flaggedPoints, itemStyle: { color: ct.colors[3] } },
        { name: "Removed", value: qcResult.removedPoints, itemStyle: { color: ct.colors[2] } },
      ], label: { color: ct.text, fontSize: 10 } }],
    };
  }, [qcResult, ct, baseTooltip]);

  /* ── Wind rose ── */
  const windRoseOption = useMemo(() => {
    if (!windRose) return null;
    const dirs = windRose.sectors.map((s) => s.direction);
    const binColors = [ct.colors[0], ct.colors[1], ct.colors[3], ct.colors[2], "#7d3c98"];
    return {
      textStyle: { fontFamily: "Inter, sans-serif", color: ct.text },
      tooltip: { trigger: "item" as const, ...baseTooltip },
      legend: { data: windRose.speedBinLabels.map((l) => `${l} m/s`), bottom: 0, textStyle: { color: ct.text, fontSize: 9 } },
      radar: { indicator: dirs.map((d) => ({ name: d, max: Math.ceil(windRose.totalPoints * 0.15) })), shape: "circle" as const, splitArea: { areaStyle: { color: "transparent" } }, splitLine: { lineStyle: { color: ct.grid } }, axisLine: { lineStyle: { color: ct.grid } }, axisName: { color: ct.text, fontSize: 9 } },
      series: windRose.speedBinLabels.map((bin, bi) => ({ name: `${bin} m/s`, type: "radar" as const, data: [{ value: windRose.sectors.map((s) => s.speedBins[bi].count), name: `${bin} m/s`, areaStyle: { opacity: 0.2 }, lineStyle: { width: 1 }, itemStyle: { color: binColors[bi % binColors.length] } }] })),
    };
  }, [windRose, ct, baseTooltip]);

  /* ── Polar plot ── */
  const polarPlotOption = useMemo(() => {
    if (!polarPlot?.points.length) return null;
    return {
      textStyle: { fontFamily: "Inter, sans-serif", color: ct.text },
      tooltip: { trigger: "item" as const, ...baseTooltip, formatter: (p: { value: number[] }) => `Wind: ${p.value[1].toFixed(1)} m/s<br/>PM2.5: ${p.value[2].toFixed(1)}` },
      angleAxis: { type: "value" as const, min: 0, max: 360, interval: 45, startAngle: 90, axisLabel: { color: ct.text, fontSize: 9, formatter: (v: number) => ({ 0: "N", 45: "NE", 90: "E", 135: "SE", 180: "S", 225: "SW", 270: "W", 315: "NW" }[v] ?? "") }, splitLine: { lineStyle: { color: ct.grid } }, axisLine: { lineStyle: { color: ct.grid } } },
      radiusAxis: { type: "value" as const, min: 0, max: Math.ceil(polarPlot.maxSpeed * 1.1), name: "m/s", nameTextStyle: { color: ct.axis, fontSize: 9 }, axisLabel: { color: ct.axis, fontSize: 8 }, splitLine: { lineStyle: { color: ct.grid } }, axisLine: { lineStyle: { color: ct.grid } } },
      polar: {},
      visualMap: { show: true, min: 0, max: Math.ceil(polarPlot.maxPm25), text: ["High", "Low"], textStyle: { color: ct.text, fontSize: 9 }, inRange: { color: ["#2e9d5b", "#f0c419", "#f2994a", "#d64545", "#7d3c98"] }, orient: "vertical" as const, right: 4, top: "center", dimension: 2, itemWidth: 10 },
      series: [{ type: "scatter" as const, coordinateSystem: "polar" as const, data: polarPlot.points, symbolSize: 3, encode: { angle: 0, radius: 1 } }],
    };
  }, [polarPlot, ct, baseTooltip]);

  if (!series) return <Loader message="Loading diagnostics..." />;

  const outlierPct = outliers ? ((outliers.outlierCount / Math.max(outliers.totalPoints, 1)) * 100).toFixed(1) : "...";

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow={`Diagnostics — Sensor ${sensorId}`}
        title="Outlier detection and channel analysis"
        subtitle="Data quality, outliers, channel agreement, and environmental correlations."
      />

      {/* Row 1: Stats */}
      <div className={styles.stats}>
        <StatCard label="Total points" value={`${outliers?.totalPoints ?? "..."}`} />
        <StatCard label="Outliers" value={`${outliers?.outlierCount ?? "..."}`} tone={outliers && outliers.outlierCount > 0 ? "warn" : "good"} />
        <StatCard label="Outlier %" value={`${outlierPct}%`} />
        <StatCard label="Slope" value={fit ? fit.slope.toFixed(4) : "..."} />
        <StatCard label="R²" value={fit ? fit.rSquared.toFixed(4) : "..."} tone={fit && fit.rSquared > 0.9 ? "good" : "warn"} />
        <StatCard label="N" value={fit ? `${fit.n}` : "..."} />
      </div>

      {/* Row 2: Outlier chart + Fit scatter side by side */}
      <div className={styles.dashRow}>
        <Card title="Outlier Detection">
          <div className={styles.actions}>
            <Button size="small" variant={replaceMode ? "accent" : "secondary"} onClick={() => { setReplaceMode((v) => !v); refetchOutliers(); }}>
              {replaceMode ? "Replace ON" : "Replace OFF"}
            </Button>
          </div>
          {outlierChartOption ? <EChart option={outlierChartOption} height={240} zoomable /> : <Loader message="Computing..." />}
        </Card>
        <Card title="A/B Regression">
          {fitChartOption ? <EChart option={fitChartOption} height={240} /> : <Loader message="Computing..." />}
        </Card>
      </div>

      {/* Row 3: Multi-panel timeseries */}
      <Card title="Multi-Panel Timeseries">
        {multiPanelOptions ? (
          <div className={styles.multiPanelStack}>
            {multiPanelOptions.map((opt, i) => (
              <EChart key={i} option={opt} height={180} zoomable />
            ))}
          </div>
        ) : <Loader message="Preparing..." />}
      </Card>

      {/* Row 4: QC + Wind side by side */}
      <div className={styles.dashRow}>
        <Card title="QC Validation">
          <div className={styles.actions}>
            <Button size="small" variant="secondary" onClick={async () => { if (!series) return; setQcLoading(true); try { setQcResult(await postJson<QcResult>("/api/qc/advanced", { series, removeOutOfSpec: true })); } finally { setQcLoading(false); } }}>
              {qcLoading ? "..." : "Run QC"}
            </Button>
          </div>
          {qcResult ? (
            <div className={styles.qcCharts}>
              {qcBarOption && <EChart option={qcBarOption} height={200} />}
              {qcPieOption && <EChart option={qcPieOption} height={200} />}
            </div>
          ) : <p className={styles.muted}>Run QC to see results.</p>}
        </Card>
        <Card title="Wind Analysis">
          <div className={styles.actions}>
            <Button size="small" variant="secondary" onClick={async () => { if (!series) return; setWindLoading(true); try { const [r, p] = await Promise.all([postJson<WindRoseData>("/api/wind-rose", { series }), postJson<PolarPlotData>("/api/polar-plot", { series })]); setWindRose(r); setPolarPlot(p); } finally { setWindLoading(false); } }}>
              {windLoading ? "..." : "Generate"}
            </Button>
          </div>
          {(windRoseOption || polarPlotOption) ? (
            <div className={styles.windCharts}>
              {windRose?.sourceLabel && <p className={styles.muted}>{windRose.sourceLabel}</p>}
              {windRoseOption && <EChart option={windRoseOption} height={280} />}
              {polarPlotOption && <EChart option={polarPlotOption} height={280} />}
            </div>
          ) : <p className={styles.muted}>Generate wind analysis.</p>}
        </Card>
      </div>

      {/* Row 5: Scatter matrix */}
      <Card title="Scatter Matrix">
        <div className={styles.actions}>
          <Button size="small" variant="secondary" onClick={async () => { if (!series) return; setScatterLoading(true); try { setScatterMatrix(await postJson<ScatterMatrixData>("/api/scatter-matrix", { series, sampleSize: 500 })); } finally { setScatterLoading(false); } }}>
            {scatterLoading ? "..." : "Generate"}
          </Button>
        </div>
        {scatterMatrixOpts ? (
          <div className={styles.scatterMatrixGrid}>
            {scatterMatrixOpts.map((opt, i) => (
              <div key={i} className={styles.scatterMatrixCell}>
                <EChart option={opt} height={140} />
              </div>
            ))}
          </div>
        ) : <p className={styles.muted}>Generate all-variable correlation matrix.</p>}
      </Card>
    </div>
  );
}
