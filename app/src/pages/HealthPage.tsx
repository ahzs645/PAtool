import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";

import {
  buildCalendarPm25,
  calculateAirSensorDailyMetrics,
  type AirSensorSohCompatResult,
  type CalendarPm25Result,
  type PatSeries,
  type EnhancedSohIndexResult,
  type EnhancedSohDailyMetrics,
} from "@patool/shared";

import {
  Loader,
  PageHeader,
  StatCard,
  Card,
  DataTable,
  Chip,
} from "../components";
import type { Column } from "../components";
import { EChart } from "../components/EChart";
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

  const airSensorSoh = useMemo<AirSensorSohCompatResult | null>(
    () => (series ? calculateAirSensorDailyMetrics(series) : null),
    [series],
  );

  const calendar = useMemo<CalendarPm25Result | null>(
    () => (series ? buildCalendarPm25(series, { palette: "aqi", dataThreshold: 50 }) : null),
    [series],
  );

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

  const calendarChartOption = useMemo(() => {
    if (!calendar?.days.length) return null;
    const values = calendar.days.map((day) => [day.date, day.pm25]);
    const start = calendar.days[0].date;
    const end = calendar.days.at(-1)?.date ?? start;

    return {
      textStyle: { fontFamily: "Inter, sans-serif", color: ct.text },
      tooltip: {
        trigger: "item" as const,
        backgroundColor: ct.tooltipBg,
        borderColor: ct.tooltipBorder,
        textStyle: { color: ct.tooltipText },
        formatter: (params: { value: [string, number | null] }) => {
          const day = calendar.days.find((entry) => entry.date === params.value[0]);
          if (!day) return params.value[0];
          const pm = day.pm25 === null ? "insufficient" : `${day.pm25.toFixed(1)} ug/m3`;
          return `${day.date}<br/>PM2.5: ${pm}<br/>Completeness: ${day.completeness.toFixed(1)}%<br/>${day.label}`;
        },
      },
      visualMap: {
        min: 0,
        max: 80,
        show: false,
        inRange: { color: ["#2e9d5b", "#f0c419", "#f2994a", "#d64545", "#7d3c98", "#8b0000"] },
      },
      calendar: {
        range: [start, end],
        top: 24,
        left: 36,
        right: 20,
        bottom: 12,
        cellSize: ["auto", 18],
        itemStyle: { color: "transparent", borderColor: ct.grid },
        splitLine: { lineStyle: { color: ct.grid } },
        dayLabel: { color: ct.axis, fontSize: 10 },
        monthLabel: { color: ct.axis, fontSize: 10 },
        yearLabel: { show: false },
      },
      series: [
        {
          type: "heatmap" as const,
          coordinateSystem: "calendar" as const,
          data: values,
          itemStyle: {
            borderColor: ct.grid,
            borderWidth: 1,
          },
        },
      ],
    };
  }, [calendar, ct]);

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
        <StatCard
          label="AirSensor index"
          value={airSensorSoh ? `${airSensorSoh.airSensorIndex}` : "..."}
          tone={airSensorSoh && airSensorSoh.airSensorIndex >= 70 ? "good" : "warn"}
        />
        <StatCard
          label="Reporting avg"
          value={airSensorSoh ? `${airSensorSoh.averageReporting.toFixed(1)}%` : "..."}
        />
      </div>

      <div className={styles.chartGrid}>
        <Card title="Daily PM2.5 Calendar">
          {calendarChartOption ? (
            <EChart option={calendarChartOption} height={240} />
          ) : (
            <Loader message="Preparing calendar..." />
          )}
        </Card>
        <Card title="AirSensor Compatibility">
          <div className={styles.compatGrid}>
            <div>
              <span>Expected samples/day</span>
              <strong>{airSensorSoh?.expectedSamplesPerDay ?? "..."}</strong>
            </div>
            <div>
              <span>Average valid</span>
              <strong>{airSensorSoh ? `${airSensorSoh.averageValid.toFixed(1)}%` : "..."}</strong>
            </div>
            <div>
              <span>DC signal</span>
              <strong>{airSensorSoh ? `${airSensorSoh.averageDcSignal.toFixed(1)}%` : "..."}</strong>
            </div>
            <div>
              <span>Average A/B R²</span>
              <strong>{airSensorSoh?.averageAbRSquared?.toFixed(4) ?? "..."}</strong>
            </div>
          </div>
        </Card>
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
