import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

import {
  applyPurpleAirCorrection,
  type NowCastResult,
  type PatSeries,
  type QcResult,
  type SensorHealthResult,
  type SensorRecord,
  type SohIndexResult,
} from "@patool/shared";

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

  const { data: health } = useQuery({
    queryKey: ["sensor-health", id, series?.points.length],
    enabled: Boolean(series),
    queryFn: () => postJson<SensorHealthResult>("/api/qc/sensor-health", { series, profileId: "qapp-hourly" })
  });

  const { data: nowCast } = useQuery({
    queryKey: ["nowcast", id, series?.points.length],
    enabled: Boolean(series),
    queryFn: () => postJson<NowCastResult>("/api/aqi/nowcast", { series })
  });

  const correction = useMemo(() => {
    const latest = series?.points.at(-1);
    if (!latest) return null;
    const pm25Cf1 = latest.pm25Cf1A !== null && latest.pm25Cf1A !== undefined && latest.pm25Cf1B !== null && latest.pm25Cf1B !== undefined
      ? (latest.pm25Cf1A + latest.pm25Cf1B) / 2
      : latest.pm25A !== null && latest.pm25B !== null
        ? (latest.pm25A + latest.pm25B) / 2
        : latest.pm25A ?? latest.pm25B;
    try {
      return applyPurpleAirCorrection({
        pm25: pm25Cf1,
        humidity: latest.humidity,
        inputBasis: "cf_1",
        profileId: "epa-barkjohn-2021-cf1",
      });
    } catch {
      return null;
    }
  }, [series]);

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

  const healthTone = health?.level === "good" ? "good" : "warn";
  const nowCastTone = nowCast?.status === "stable" ? "good" : nowCast?.status === "insufficient" ? "warn" : "warn";
  const latestCorrected = correction ? `${correction.pm25Corrected.toFixed(1)} ug/m3` : "Unavailable";

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
        <StatCard label="Corrected PM2.5" value={latestCorrected} tone={correction ? "good" : "warn"} />
        <StatCard label="QC flagged points" value={`${qc.flaggedPoints}`} tone={qc.flaggedPoints ? "warn" : "good"} />
        <StatCard label="Sensor health" value={health?.level ?? "Loading"} tone={healthTone} />
        <StatCard label="NowCast" value={nowCast?.aqi === null || nowCast?.aqi === undefined ? "..." : `AQI ${nowCast.aqi}`} tone={nowCastTone} />
        <StatCard label="SoH index" value={`${soh.index}`} tone={soh.status === "excellent" ? "good" : "warn"} />
      </div>

      <Card title="Provenance and confidence">
        <div className={styles.provenanceGrid}>
          <div>
            <span className={styles.provenanceLabel}>Correction</span>
            <strong>{correction?.label ?? "No correction applied"}</strong>
            <small>{correction ? `Input basis: ${correction.inputBasis}; RH ${correction.humidity ?? "missing"}%.` : "A corrected value requires compatible PurpleAir PM2.5 and humidity fields."}</small>
          </div>
          <div>
            <span className={styles.provenanceLabel}>NowCast completeness</span>
            <strong>{nowCast?.status ?? "Loading"}</strong>
            <small>{nowCast ? `${nowCast.hoursUsed}/${nowCast.hoursRequired} hourly buckets used.` : "Waiting for hourly PM2.5 history."}</small>
          </div>
          <div>
            <span className={styles.provenanceLabel}>Health profile</span>
            <strong>{health?.profileId ?? "qapp-hourly"}</strong>
            <small>{health ? `${health.channelDisagreementCount} A/B disagreements; ${health.highHumidityCount} high-RH points.` : "Computing channel agreement."}</small>
          </div>
          <div>
            <span className={styles.provenanceLabel}>Attribution</span>
            <strong>PurpleAir decision-support data</strong>
            <small>Values are not regulatory determinations. Data and derived visualizations should preserve PurpleAir attribution.</small>
          </div>
        </div>
        {health?.issues.length ? (
          <div className={styles.healthChips}>
            {health.issues.map((issue) => (
              <Chip key={issue.code} variant={issue.severity === "severe" ? "danger" : "warning"}>{issue.code}</Chip>
            ))}
          </div>
        ) : null}
      </Card>

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
