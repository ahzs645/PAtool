import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";

import {
  type PatSeries,
  type EnhancedSohIndexResult,
  type EnhancedSohDailyMetrics,
} from "@patool/shared";

import {
  Loader,
  PageHeader,
  StatCard,
  Card,
  EChart,
  DataTable,
  Chip,
} from "../components";
import type { Column } from "../components";
import { getJson, postJson } from "../lib/api";
import { useChartTheme } from "../hooks/useChartTheme";
import styles from "./HealthPage.module.css";

const dailyColumns: Column<EnhancedSohDailyMetrics>[] = [
  {
    key: "date",
    header: "Date",
    width: 110,
    render: (r) => r.date,
  },
  {
    key: "pctReporting",
    header: "Reporting%",
    width: 100,
    render: (r) => `${r.pctReporting.toFixed(1)}%`,
  },
  {
    key: "pctValid",
    header: "Valid%",
    width: 90,
    render: (r) => `${r.pctValid.toFixed(1)}%`,
  },
  {
    key: "pctDC",
    header: "DC%",
    width: 80,
    render: (r) => (
      <Chip variant={r.pctDC > 10 ? "warning" : "default"}>
        {r.pctDC.toFixed(1)}%
      </Chip>
    ),
  },
  {
    key: "channelAgreementScore",
    header: "Agreement",
    width: 100,
    render: (r) => r.channelAgreementScore.toFixed(1),
  },
  {
    key: "abFit",
    header: "R\u00B2",
    width: 80,
    render: (r) => (r.abFit ? r.abFit.rSquared.toFixed(4) : "\u2014"),
  },
  {
    key: "abTTest",
    header: "T-test p",
    width: 100,
    render: (r) =>
      r.abTTest ? (
        <Chip variant={r.abTTest.p < 0.05 ? "warning" : "success"}>
          {r.abTTest.p < 0.001 ? "<0.001" : r.abTTest.p.toFixed(4)}
        </Chip>
      ) : (
        "\u2014"
      ),
  },
];

export default function HealthPage() {
  const { id: routeId } = useParams();
  const sensorId = routeId ?? "1001";
  const ct = useChartTheme();

  /* ── Fetch raw PAT series ── */
  const { data: series } = useQuery({
    queryKey: ["health-series", sensorId],
    queryFn: () => getJson<PatSeries>(`/api/pat?id=${sensorId}&aggregate=raw`),
  });

  /* ── Enhanced SoH ── */
  const { data: soh } = useQuery({
    queryKey: ["soh-enhanced", series?.points.length],
    enabled: Boolean(series),
    queryFn: () =>
      postJson<EnhancedSohIndexResult>("/api/soh/enhanced", { series }),
  });

  /* ── Section B: SoH Index Trend ── */
  const trendChartOption = useMemo(() => {
    if (!soh) return null;
    const dates = soh.metrics.map((m) => m.date);

    // Compute a daily weighted SoH score per day
    const dailyScores = soh.metrics.map((m) => {
      const score =
        m.pctReporting * 0.25 +
        m.pctValid * 0.25 +
        m.pctDataCompleteness * 0.2 +
        m.channelAgreementScore * 0.2 +
        m.otherFitScore * 0.1;
      return Number(score.toFixed(2));
    });

    return {
      textStyle: { fontFamily: "Inter, sans-serif", color: ct.text },
      tooltip: {
        trigger: "axis" as const,
        backgroundColor: ct.tooltipBg,
        borderColor: ct.tooltipBorder,
        textStyle: { color: ct.tooltipText },
      },
      legend: { top: 0, textStyle: { color: ct.text } },
      grid: { top: 30, right: 16, bottom: 24, left: 48 },
      xAxis: {
        type: "category" as const,
        data: dates,
        axisLabel: { color: ct.axis },
        axisLine: { lineStyle: { color: ct.grid } },
        splitLine: { lineStyle: { color: ct.grid } },
      },
      yAxis: {
        type: "value" as const,
        max: 100,
        min: 0,
        axisLabel: { color: ct.axis },
        splitLine: { lineStyle: { color: ct.grid } },
      },
      series: [
        {
          name: "SoH Score",
          type: "line" as const,
          smooth: true,
          data: dailyScores,
          color: ct.colors[0],
          areaStyle: { color: ct.colors[0], opacity: 0.08 },
        },
        {
          name: "Excellent (85)",
          type: "line" as const,
          data: dates.map(() => 85),
          color: "#2e9d5b",
          lineStyle: { type: "dashed" as const, width: 1 },
          symbol: "none",
        },
        {
          name: "Good (70)",
          type: "line" as const,
          data: dates.map(() => 70),
          color: "#f0c419",
          lineStyle: { type: "dashed" as const, width: 1 },
          symbol: "none",
        },
        {
          name: "Watch (50)",
          type: "line" as const,
          data: dates.map(() => 50),
          color: "#d64545",
          lineStyle: { type: "dashed" as const, width: 1 },
          symbol: "none",
        },
      ],
    };
  }, [soh, ct]);

  /* ── Section C: Daily A/B Fit Details ── */
  const fitChartOption = useMemo(() => {
    if (!soh) return null;
    const dates = soh.metrics.map((m) => m.date);
    const slopes = soh.metrics.map((m) => (m.abFit ? m.abFit.slope : null));
    const rSquareds = soh.metrics.map((m) =>
      m.abFit ? m.abFit.rSquared : null
    );

    return {
      textStyle: { fontFamily: "Inter, sans-serif", color: ct.text },
      tooltip: {
        trigger: "axis" as const,
        backgroundColor: ct.tooltipBg,
        borderColor: ct.tooltipBorder,
        textStyle: { color: ct.tooltipText },
      },
      legend: { top: 0, textStyle: { color: ct.text } },
      grid: { top: 30, right: 48, bottom: 24, left: 48 },
      xAxis: {
        type: "category" as const,
        data: dates,
        axisLabel: { color: ct.axis },
        axisLine: { lineStyle: { color: ct.grid } },
        splitLine: { lineStyle: { color: ct.grid } },
      },
      yAxis: [
        {
          type: "value" as const,
          name: "Slope",
          axisLabel: { color: ct.axis },
          splitLine: { lineStyle: { color: ct.grid } },
        },
        {
          type: "value" as const,
          name: "R\u00B2",
          max: 1,
          min: 0,
          axisLabel: { color: ct.axis },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: "Slope",
          type: "bar" as const,
          data: slopes,
          color: ct.colors[3],
          yAxisIndex: 0,
        },
        {
          name: "R\u00B2",
          type: "line" as const,
          smooth: true,
          data: rSquareds,
          color: ct.colors[1],
          yAxisIndex: 1,
        },
      ],
    };
  }, [soh, ct]);

  /* ── Loading state ── */
  if (!series) {
    return <Loader message="Loading health data..." />;
  }

  const statusTone = (status: string): "good" | "warn" | "neutral" => {
    if (status === "excellent" || status === "good") return "good";
    if (status === "watch" || status === "poor") return "warn";
    return "neutral";
  };

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow={`State of Health — Sensor ${sensorId}`}
        title="Enhanced SoH overview"
        subtitle="Daily health metrics with DC signal detection, A/B regression, and t-test diagnostics."
      />

      {/* Section A: Enhanced SoH Overview */}
      <div className={styles.stats}>
        <StatCard
          label="SoH Index"
          value={soh ? `${soh.index}` : "..."}
          tone={soh ? statusTone(soh.status) : "neutral"}
        />
        <StatCard
          label="Status"
          value={soh ? soh.status : "..."}
          tone={soh ? statusTone(soh.status) : "neutral"}
        />
        <StatCard
          label="DC Signal %"
          value={
            soh
              ? `${(soh.metrics.reduce((s, m) => s + m.pctDC, 0) / Math.max(soh.metrics.length, 1)).toFixed(1)}%`
              : "..."
          }
        />
        <StatCard
          label="Avg A/B R\u00B2"
          value={
            soh
              ? (() => {
                  const fits = soh.metrics.filter((m) => m.abFit !== null);
                  if (!fits.length) return "\u2014";
                  return (
                    fits.reduce((s, m) => s + (m.abFit?.rSquared ?? 0), 0) /
                    fits.length
                  ).toFixed(4);
                })()
              : "..."
          }
        />
      </div>

      {soh ? (
        <Card title="Daily Metrics">
          <DataTable
            columns={dailyColumns}
            data={soh.metrics}
            rowKey={(r) => r.date}
            emptyMessage="No daily metrics available"
            footer={
              <span>
                {soh.metrics.length} days &middot; Overall index: {soh.index}
              </span>
            }
          />
        </Card>
      ) : (
        <Loader message="Computing enhanced SoH..." />
      )}

      {/* Section B: SoH Index Trend */}
      <div className={styles.chartGrid}>
        <Card title="SoH Index Trend">
          {trendChartOption ? (
            <EChart option={trendChartOption} />
          ) : (
            <Loader message="Loading trend..." />
          )}
        </Card>

        {/* Section C: Daily A/B Fit Details */}
        <Card title="Daily A/B Fit (Slope + R\u00B2)">
          {fitChartOption ? (
            <EChart option={fitChartOption} />
          ) : (
            <Loader message="Loading fit details..." />
          )}
        </Card>
      </div>
    </div>
  );
}
