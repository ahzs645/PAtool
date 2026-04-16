import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

import { type PatSeries, type QcResult, type SensorRecord, type SohIndexResult } from "@patool/shared";

import { Loader, PageHeader, StatCard, Card, DataTable, Chip, Button } from "../components";
import { EChart } from "../components/EChart";
import type { Column } from "../components";
import { getJson, postJson } from "../lib/api";
import { useChartTheme } from "../hooks/useChartTheme";
import styles from "./SensorDetailPage.module.css";

interface QcIssue {
  code: string;
  message: string;
  count: number;
}

const issueColumns: Column<QcIssue>[] = [
  {
    key: "code",
    header: "Code",
    width: 180,
    render: (r) => <Chip variant="accent">{r.code}</Chip>,
  },
  {
    key: "message",
    header: "Description",
    render: (r) => r.message,
  },
  {
    key: "count",
    header: "Count",
    width: 80,
    render: (r) => <Chip variant={r.count > 5 ? "warning" : "default"}>{r.count}</Chip>,
  },
];

interface RollingMeanResult {
  meta: PatSeries["meta"];
  points: Array<{
    timestamp: string;
    pm25A: number | null;
    pm25B: number | null;
  }>;
}

export default function SensorDetailPage() {
  const { id = "1001" } = useParams();
  const ct = useChartTheme();
  const [rollingMean, setRollingMean] = useState<RollingMeanResult | null>(null);
  const [rollingMeanLoading, setRollingMeanLoading] = useState(false);
  const [rollingMeanEnabled, setRollingMeanEnabled] = useState(false);

  const { data: sensor } = useQuery({
    queryKey: ["sensor", id],
    queryFn: () => getJson<SensorRecord>(`/api/sensor/${id}?period=latest`)
  });

  const { data: series } = useQuery({
    queryKey: ["pat", id],
    queryFn: () => getJson<PatSeries>(`/api/pat?id=${id}&aggregate=raw`)
  });

  const { data: qc } = useQuery({
    queryKey: ["qc", id, series?.points.length],
    enabled: Boolean(series),
    queryFn: () => postJson<QcResult>("/api/qc/hourly-ab", { series, removeOutOfSpec: true })
  });

  const { data: soh } = useQuery({
    queryKey: ["soh-index", id, series?.points.length],
    enabled: Boolean(series),
    queryFn: () => postJson<SohIndexResult>("/api/soh/index", { series })
  });

  const toggleRollingMean = async () => {
    if (rollingMeanEnabled) {
      setRollingMeanEnabled(false);
      return;
    }
    if (!series) return;
    if (!rollingMean) {
      setRollingMeanLoading(true);
      try {
        const result = await postJson<RollingMeanResult>("/api/rolling-mean", {
          series,
          windowSize: 5,
        });
        setRollingMean(result);
      } finally {
        setRollingMeanLoading(false);
      }
    }
    setRollingMeanEnabled(true);
  };

  const chartOption = useMemo(() => {
    if (!series) return null;
    const baseSeries = [
      { name: "PM2.5 A", type: "line" as const, smooth: true, data: series.points.map((p) => p.pm25A), color: ct.colors[0], symbol: "none" as const },
      { name: "PM2.5 B", type: "line" as const, smooth: true, data: series.points.map((p) => p.pm25B), color: ct.colors[2], symbol: "none" as const },
    ];

    if (rollingMeanEnabled && rollingMean) {
      baseSeries.push(
        {
          name: "PM2.5 A (rolling)",
          type: "line" as const,
          smooth: true,
          data: rollingMean.points.map((p) => p.pm25A) as (number | null)[],
          color: ct.colors[3],
          symbol: "none" as const,
          // @ts-expect-error -- lineStyle is valid for ECharts line series
          lineStyle: { type: "dashed", width: 2 },
        },
        {
          name: "PM2.5 B (rolling)",
          type: "line" as const,
          smooth: true,
          data: rollingMean.points.map((p) => p.pm25B) as (number | null)[],
          color: ct.colors[4],
          symbol: "none" as const,
          lineStyle: { type: "dashed", width: 2 },
        }
      );
    }

    return {
      textStyle: { fontFamily: "Inter, sans-serif", color: ct.text },
      tooltip: {
        trigger: "axis" as const,
        backgroundColor: ct.tooltipBg,
        borderColor: ct.tooltipBorder,
        textStyle: { color: ct.tooltipText }
      },
      legend: { top: 0, textStyle: { color: ct.text } },
      grid: { top: 30, right: 16, bottom: 24, left: 48 },
      xAxis: {
        type: "category" as const,
        data: series.points.map((p) => p.timestamp.slice(11, 16)),
        axisLabel: { color: ct.axis },
        axisLine: { lineStyle: { color: ct.grid } },
        splitLine: { lineStyle: { color: ct.grid } }
      },
      yAxis: {
        type: "value" as const,
        axisLabel: { color: ct.axis },
        splitLine: { lineStyle: { color: ct.grid } }
      },
      series: baseSeries
    };
  }, [series, ct, rollingMeanEnabled, rollingMean]);

  const sohOption = useMemo(() => {
    if (!soh) return null;
    return {
      textStyle: { fontFamily: "Inter, sans-serif", color: ct.text },
      tooltip: {
        trigger: "axis" as const,
        backgroundColor: ct.tooltipBg,
        borderColor: ct.tooltipBorder,
        textStyle: { color: ct.tooltipText }
      },
      legend: { top: 0, textStyle: { color: ct.text } },
      grid: { top: 30, right: 16, bottom: 24, left: 48 },
      xAxis: {
        type: "category" as const,
        data: soh.metrics.map((m) => m.date),
        axisLabel: { color: ct.axis },
        axisLine: { lineStyle: { color: ct.grid } },
        splitLine: { lineStyle: { color: ct.grid } }
      },
      yAxis: {
        type: "value" as const,
        max: 100,
        axisLabel: { color: ct.axis },
        splitLine: { lineStyle: { color: ct.grid } }
      },
      series: [
        { name: "Reporting", type: "bar" as const, data: soh.metrics.map((m) => m.pctReporting), color: ct.colors[3] },
        { name: "Agreement", type: "line" as const, data: soh.metrics.map((m) => m.channelAgreementScore), color: ct.colors[1] }
      ]
    };
  }, [soh, ct]);

  if (!sensor || !series || !qc || !soh || !chartOption || !sohOption) {
    return <Loader message="Loading sensor detail..." />;
  }

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow="PAT Detail"
        title={sensor.meta.label}
        subtitle="Channel-level history, QC results, and state-of-health summary."
      />

      <div className={styles.chartActions}>
        <Link to={`/diagnostics/${id}`}>
          <Button variant="secondary" size="small">Diagnostics</Button>
        </Link>
        <Link to={`/health/${id}`}>
          <Button variant="secondary" size="small">Health</Button>
        </Link>
      </div>

      <div className={styles.stats}>
        <StatCard label="Latest PM2.5 A" value={`${sensor.latest.pm25A ?? 0} ug/m3`} />
        <StatCard label="QC flagged points" value={`${qc.flaggedPoints}`} tone={qc.flaggedPoints ? "warn" : "good"} />
        <StatCard label="SoH index" value={`${soh.index}`} tone={soh.status === "excellent" ? "good" : "warn"} />
      </div>

      <div className={styles.chartGrid}>
        <Card title="Timeseries">
          <div className={styles.chartActions}>
            <Button
              variant="secondary"
              size="small"
              onClick={toggleRollingMean}
            >
              {rollingMeanLoading ? "Loading..." : "Toggle Rolling Mean"}
            </Button>
          </div>
          <EChart option={chartOption} zoomable />
        </Card>
        <Card title="Daily state of health">
          <EChart option={sohOption} zoomable />
        </Card>
      </div>

      <Card title="QC summary">
        <DataTable
          columns={issueColumns}
          data={qc.issues}
          rowKey={(r) => r.code}
          emptyMessage="No QC issues found"
          footer={<span>{qc.issues.length} issues &middot; {qc.flaggedPoints} flagged points</span>}
        />
      </Card>
    </div>
  );
}
