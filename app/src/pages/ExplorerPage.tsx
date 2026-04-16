import { startTransition, useCallback, useDeferredValue, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import {
  pasFilter,
  pm25ToAqiBand,
  type PasCollection,
  type PasRecord,
  type PatSeries,
  type EnhancedSohIndexResult,
  type OutlierResult,
} from "@patool/shared";
import { useChartTheme } from "../hooks/useChartTheme";

type Pm25Window = "pm25Current" | "pm25_10min" | "pm25_30min" | "pm25_1hr" | "pm25_6hr" | "pm25_1day" | "pm25_1week";

const pm25WindowOptions: { value: Pm25Window; label: string }[] = [
  { value: "pm25Current", label: "Current" },
  { value: "pm25_10min", label: "10min" },
  { value: "pm25_30min", label: "30min" },
  { value: "pm25_1hr", label: "1hr" },
  { value: "pm25_6hr", label: "6hr" },
  { value: "pm25_1day", label: "1day" },
  { value: "pm25_1week", label: "1week" },
];

import { PageHeader, StatCard, Card, Button, DataTable, CellStack, Chip, Loader } from "../components";
import type { Column } from "../components";
import { EChart } from "../components/EChart";
import { getJson, postJson } from "../lib/api";
import styles from "./ExplorerPage.module.css";

/* ── Inline SVG Icons (16x16, stroke-based) ── */

function IconMapPin() {
  return (
    <svg className={styles.fieldIcon} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 8.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
      <path d="M8 14s5-3.5 5-7.5a5 5 0 1 0-10 0C3 10.5 8 14 8 14Z" />
    </svg>
  );
}

function IconBuilding() {
  return (
    <svg className={styles.fieldIcon} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="12" height="12" rx="1" />
      <path d="M5 5h2v2H5zM9 5h2v2H9zM5 9h2v2H5zM9 9h2v2H9z" />
    </svg>
  );
}

function IconGauge() {
  return (
    <svg className={styles.fieldIcon} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 14A6 6 0 1 1 8 2a6 6 0 0 1 0 12Z" />
      <path d="M8 5v3l2 2" />
    </svg>
  );
}

function IconMap() {
  return (
    <svg className={styles.fieldIcon} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 3.5l4.5-1.5 5 2 4.5-1.5v11l-4.5 1.5-5-2L1 14.5z" />
      <path d="M5.5 2v11M10.5 4v11" />
    </svg>
  );
}

function IconClock() {
  return (
    <svg className={styles.fieldIcon} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.5 1.5" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

function IconHome() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 8l6-6 6 6" />
      <path d="M4 7v6a1 1 0 001 1h6a1 1 0 001-1V7" />
    </svg>
  );
}

function IconTimeseries() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1,12 4,7 7,9 10,4 13,6 15,2" />
      <line x1="1" y1="14" x2="15" y2="14" />
    </svg>
  );
}

function IconHeart() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 14s-5.5-3.5-5.5-7A3 3 0 0 1 8 4.5 3 3 0 0 1 13.5 7C13.5 10.5 8 14 8 14Z" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="7" r="4.5" />
      <line x1="10.5" y1="10.5" x2="14" y2="14" />
    </svg>
  );
}

/* ── Helpers ── */

function buildColumns(pm25Window: Pm25Window): Column<PasRecord>[] {
  const windowLabel = pm25WindowOptions.find((o) => o.value === pm25Window)?.label ?? "1hr";
  return [
    {
      key: "label",
      header: "Sensor",
      width: "40%",
      render: (r: PasRecord) => <CellStack primary={r.label} sub={`#${r.id}`} />,
    },
    {
      key: "state",
      header: "State",
      width: 80,
      render: (r: PasRecord) => r.stateCode ?? "NA",
    },
    {
      key: "pm25",
      header: `PM2.5 (${windowLabel})`,
      width: 120,
      render: (r: PasRecord) => {
        const val = getPm25ForWindow(r, pm25Window);
        const band = pm25ToAqiBand(val);
        const variant = band.label === "Good" ? "success" : band.label === "Moderate" ? "warning" : "danger";
        return <Chip variant={variant}>{val.toFixed(2)}</Chip>;
      },
    },
    {
      key: "mode",
      header: "Mode",
      width: 100,
      render: (r: PasRecord) => <Chip>{r.locationType}</Chip>,
    },
  ];
}

function getPm25ForWindow(record: PasRecord, window: Pm25Window): number {
  return record[window] ?? record.pm25Current ?? 0;
}

function formatPm25(value: number | null | undefined): string {
  if (value == null) return "N/A";
  return `${value.toFixed(2)} ug/m3`;
}

type SidePanelTab = "home" | "timeseries" | "health" | "diagnostics";

/* ── Side Panel Sub-components ── */

function SidePanelHomeTab({ sensor }: { sensor: PasRecord }) {
  return (
    <div className={styles.fieldGroup}>
      <div className={styles.fieldGroupTitle}>General</div>

      <div className={styles.fieldRow}>
        <IconMapPin />
        <span className={styles.fieldLabel}>State</span>
        <span className={styles.fieldValue}>{sensor.stateCode ?? "N/A"}</span>
      </div>
      <div className={styles.fieldRow}>
        <IconBuilding />
        <span className={styles.fieldLabel}>Location Type</span>
        <span className={styles.fieldValue}>{sensor.locationType}</span>
      </div>
      <div className={styles.fieldRow}>
        <IconGauge />
        <span className={styles.fieldLabel}>PM2.5 Current</span>
        <span className={styles.fieldValue}>{formatPm25(sensor.pm25Current)}</span>
      </div>
      <div className={styles.fieldRow}>
        <IconGauge />
        <span className={styles.fieldLabel}>PM2.5 1hr</span>
        <span className={styles.fieldValue}>{formatPm25(sensor.pm25_1hr)}</span>
      </div>
      <div className={styles.fieldRow}>
        <IconGauge />
        <span className={styles.fieldLabel}>PM2.5 6hr</span>
        <span className={styles.fieldValue}>{formatPm25(sensor.pm25_6hr)}</span>
      </div>
      <div className={styles.fieldRow}>
        <IconGauge />
        <span className={styles.fieldLabel}>PM2.5 1day</span>
        <span className={styles.fieldValue}>{formatPm25(sensor.pm25_1day)}</span>
      </div>
      <div className={styles.fieldRow}>
        <IconGauge />
        <span className={styles.fieldLabel}>PM2.5 1week</span>
        <span className={styles.fieldValue}>{formatPm25(sensor.pm25_1week)}</span>
      </div>
      <div className={styles.fieldRow}>
        <IconMap />
        <span className={styles.fieldLabel}>Latitude</span>
        <span className={styles.fieldValue}>{sensor.latitude.toFixed(4)}</span>
      </div>
      <div className={styles.fieldRow}>
        <IconMap />
        <span className={styles.fieldLabel}>Longitude</span>
        <span className={styles.fieldValue}>{sensor.longitude.toFixed(4)}</span>
      </div>
      <div className={styles.fieldRow}>
        <IconClock />
        <span className={styles.fieldLabel}>Timezone</span>
        <span className={styles.fieldValue}>{sensor.timezone ?? "N/A"}</span>
      </div>
    </div>
  );
}

function SidePanelTimeseriesTab({ sensor, patData, isLoading }: { sensor: PasRecord; patData: PatSeries | undefined; isLoading: boolean }) {
  const chartTheme = useChartTheme();

  const pm25Option = useMemo(() => {
    if (!patData) return null;
    const timestamps = patData.points.map((p) => p.timestamp);
    return {
      tooltip: {
        trigger: "axis" as const,
        backgroundColor: chartTheme.tooltipBg,
        borderColor: chartTheme.tooltipBorder,
        textStyle: { color: chartTheme.tooltipText, fontSize: 12 },
      },
      legend: {
        data: ["PM2.5 A", "PM2.5 B"],
        textStyle: { color: chartTheme.text, fontSize: 11 },
        top: 0,
      },
      grid: { left: 40, right: 12, top: 28, bottom: 24 },
      dataZoom: [{ type: "inside" as const }],
      xAxis: {
        type: "category" as const,
        data: timestamps,
        axisLine: { lineStyle: { color: chartTheme.axis } },
        axisLabel: { fontSize: 9, color: chartTheme.text, rotate: 30, formatter: (v: string) => v.slice(5, 16) },
      },
      yAxis: {
        type: "value" as const,
        name: "ug/m3",
        nameTextStyle: { color: chartTheme.text, fontSize: 10 },
        axisLine: { lineStyle: { color: chartTheme.axis } },
        axisLabel: { fontSize: 10, color: chartTheme.text },
        splitLine: { lineStyle: { color: chartTheme.grid } },
      },
      series: [
        {
          name: "PM2.5 A",
          type: "line" as const,
          data: patData.points.map((p) => p.pm25A),
          symbol: "none",
          lineStyle: { width: 1.5 },
          itemStyle: { color: chartTheme.colors[0] },
        },
        {
          name: "PM2.5 B",
          type: "line" as const,
          data: patData.points.map((p) => p.pm25B),
          symbol: "none",
          lineStyle: { width: 1.5 },
          itemStyle: { color: chartTheme.colors[1] },
        },
      ],
    };
  }, [patData, chartTheme]);

  const tempOption = useMemo(() => {
    if (!patData) return null;
    const timestamps = patData.points.map((p) => p.timestamp);
    return {
      tooltip: {
        trigger: "axis" as const,
        backgroundColor: chartTheme.tooltipBg,
        borderColor: chartTheme.tooltipBorder,
        textStyle: { color: chartTheme.tooltipText, fontSize: 12 },
      },
      grid: { left: 40, right: 12, top: 12, bottom: 24 },
      dataZoom: [{ type: "inside" as const }],
      xAxis: {
        type: "category" as const,
        data: timestamps,
        axisLine: { lineStyle: { color: chartTheme.axis } },
        axisLabel: { fontSize: 9, color: chartTheme.text, rotate: 30, formatter: (v: string) => v.slice(5, 16) },
      },
      yAxis: {
        type: "value" as const,
        name: "F",
        nameTextStyle: { color: chartTheme.text, fontSize: 10 },
        axisLine: { lineStyle: { color: chartTheme.axis } },
        axisLabel: { fontSize: 10, color: chartTheme.text },
        splitLine: { lineStyle: { color: chartTheme.grid } },
      },
      series: [
        {
          type: "line" as const,
          data: patData.points.map((p) => p.temperature),
          symbol: "none",
          lineStyle: { width: 1.5 },
          itemStyle: { color: chartTheme.colors[3] },
        },
      ],
    };
  }, [patData, chartTheme]);

  const humidityOption = useMemo(() => {
    if (!patData) return null;
    const timestamps = patData.points.map((p) => p.timestamp);
    return {
      tooltip: {
        trigger: "axis" as const,
        backgroundColor: chartTheme.tooltipBg,
        borderColor: chartTheme.tooltipBorder,
        textStyle: { color: chartTheme.tooltipText, fontSize: 12 },
      },
      grid: { left: 40, right: 12, top: 12, bottom: 24 },
      dataZoom: [{ type: "inside" as const }],
      xAxis: {
        type: "category" as const,
        data: timestamps,
        axisLine: { lineStyle: { color: chartTheme.axis } },
        axisLabel: { fontSize: 9, color: chartTheme.text, rotate: 30, formatter: (v: string) => v.slice(5, 16) },
      },
      yAxis: {
        type: "value" as const,
        name: "%",
        nameTextStyle: { color: chartTheme.text, fontSize: 10 },
        axisLine: { lineStyle: { color: chartTheme.axis } },
        axisLabel: { fontSize: 10, color: chartTheme.text },
        splitLine: { lineStyle: { color: chartTheme.grid } },
      },
      series: [
        {
          type: "line" as const,
          data: patData.points.map((p) => p.humidity),
          symbol: "none",
          lineStyle: { width: 1.5 },
          itemStyle: { color: chartTheme.colors[2] },
        },
      ],
    };
  }, [patData, chartTheme]);

  if (isLoading) {
    return <div className={styles.tabLoading}><Loader message="Loading timeseries..." /></div>;
  }

  if (!patData || !pm25Option || !tempOption || !humidityOption) {
    return <div className={styles.chartsContent}><p>No timeseries data available for sensor #{sensor.id}.</p></div>;
  }

  return (
    <div className={styles.chartsContent}>
      <div className={styles.chartSection}>
        <div className={styles.chartSectionTitle}>PM2.5 A vs B</div>
        <EChart option={pm25Option} height={220} />
      </div>
      <div className={styles.chartSection}>
        <div className={styles.chartSectionTitle}>Temperature</div>
        <EChart option={tempOption} height={150} />
      </div>
      <div className={styles.chartSection}>
        <div className={styles.chartSectionTitle}>Humidity</div>
        <EChart option={humidityOption} height={150} />
      </div>
    </div>
  );
}

function SidePanelHealthTab({ sohData, isLoading }: { sohData: EnhancedSohIndexResult | undefined; isLoading: boolean }) {
  const chartTheme = useChartTheme();

  const dailySohOption = useMemo(() => {
    if (!sohData) return null;
    const dates = sohData.metrics.map((m) => m.date);
    const scores = sohData.metrics.map((m) => m.channelAgreementScore);
    return {
      tooltip: {
        trigger: "axis" as const,
        backgroundColor: chartTheme.tooltipBg,
        borderColor: chartTheme.tooltipBorder,
        textStyle: { color: chartTheme.tooltipText, fontSize: 12 },
      },
      grid: { left: 40, right: 12, top: 12, bottom: 24 },
      xAxis: {
        type: "category" as const,
        data: dates,
        axisLine: { lineStyle: { color: chartTheme.axis } },
        axisLabel: { fontSize: 9, color: chartTheme.text, rotate: 30 },
      },
      yAxis: {
        type: "value" as const,
        min: 0,
        max: 1,
        axisLine: { lineStyle: { color: chartTheme.axis } },
        axisLabel: { fontSize: 10, color: chartTheme.text },
        splitLine: { lineStyle: { color: chartTheme.grid } },
      },
      series: [
        {
          type: "bar" as const,
          data: scores.map((s) => ({
            value: s,
            itemStyle: { color: s >= 0.8 ? chartTheme.colors[1] : s >= 0.5 ? chartTheme.colors[3] : chartTheme.colors[2] },
          })),
          barWidth: "60%",
        },
      ],
    };
  }, [sohData, chartTheme]);

  if (isLoading) {
    return <div className={styles.tabLoading}><Loader message="Loading health data..." /></div>;
  }

  if (!sohData || !dailySohOption) {
    return <div className={styles.chartsContent}><p>No health data available.</p></div>;
  }

  const statusTone = sohData.status === "excellent" || sohData.status === "good" ? "good" as const : "warn" as const;

  return (
    <div className={styles.chartsContent}>
      <div className={styles.sidePanelStats}>
        <StatCard label="SoH Index" value={sohData.index.toFixed(2)} tone={statusTone} />
        <StatCard label="Status" value={sohData.status} tone={statusTone} />
      </div>
      <div className={styles.chartSection}>
        <div className={styles.chartSectionTitle}>Daily Channel Agreement</div>
        <EChart option={dailySohOption} height={200} />
      </div>
    </div>
  );
}

function SidePanelDiagnosticsTab({ outlierData, patData, isLoading }: { outlierData: OutlierResult | undefined; patData: PatSeries | undefined; isLoading: boolean }) {
  const chartTheme = useChartTheme();

  const scatterOption = useMemo(() => {
    if (!patData) return null;
    const points = patData.points
      .filter((p) => p.pm25A !== null && p.pm25B !== null)
      .map((p) => [p.pm25A!, p.pm25B!]);
    return {
      tooltip: {
        trigger: "item" as const,
        backgroundColor: chartTheme.tooltipBg,
        borderColor: chartTheme.tooltipBorder,
        textStyle: { color: chartTheme.tooltipText, fontSize: 12 },
        formatter: (params: { value: [number, number] }) => `A: ${params.value[0].toFixed(1)}, B: ${params.value[1].toFixed(1)}`,
      },
      grid: { left: 40, right: 12, top: 12, bottom: 32 },
      xAxis: {
        type: "value" as const,
        name: "PM2.5 A",
        nameLocation: "center" as const,
        nameGap: 20,
        nameTextStyle: { color: chartTheme.text, fontSize: 10 },
        axisLine: { lineStyle: { color: chartTheme.axis } },
        axisLabel: { fontSize: 10, color: chartTheme.text },
        splitLine: { lineStyle: { color: chartTheme.grid } },
      },
      yAxis: {
        type: "value" as const,
        name: "PM2.5 B",
        nameTextStyle: { color: chartTheme.text, fontSize: 10 },
        axisLine: { lineStyle: { color: chartTheme.axis } },
        axisLabel: { fontSize: 10, color: chartTheme.text },
        splitLine: { lineStyle: { color: chartTheme.grid } },
      },
      series: [
        {
          type: "scatter" as const,
          data: points,
          symbolSize: 4,
          itemStyle: { color: chartTheme.colors[0], opacity: 0.6 },
        },
      ],
    };
  }, [patData, chartTheme]);

  if (isLoading) {
    return <div className={styles.tabLoading}><Loader message="Loading diagnostics..." /></div>;
  }

  if (!outlierData || !scatterOption) {
    return <div className={styles.chartsContent}><p>No diagnostics data available.</p></div>;
  }

  const outlierPct = outlierData.totalPoints > 0
    ? ((outlierData.outlierCount / outlierData.totalPoints) * 100).toFixed(1)
    : "0.0";

  return (
    <div className={styles.chartsContent}>
      <div className={styles.sidePanelStats}>
        <StatCard label="Outlier Count" value={`${outlierData.outlierCount}`} />
        <StatCard label="Outlier %" value={`${outlierPct}%`} tone={Number(outlierPct) > 5 ? "warn" : "good"} />
      </div>
      <div className={styles.chartSection}>
        <div className={styles.chartSectionTitle}>Internal Fit (A vs B)</div>
        <EChart option={scatterOption} height={200} />
      </div>
    </div>
  );
}

/* ── Main Page ── */

export default function ExplorerPage() {
  const [query, setQuery] = useState("");
  const [outsideOnly, setOutsideOnly] = useState(true);
  const [pm25Window, setPm25Window] = useState<Pm25Window>("pm25_1hr");
  const [panelOpen, setPanelOpen] = useState(false);
  const [displayedSensor, setDisplayedSensor] = useState<PasRecord | null>(null);
  const [activeTab, setActiveTab] = useState<SidePanelTab>("home");
  const [panelWidth, setPanelWidth] = useState(400);
  const [isResizing, setIsResizing] = useState(false);
  const deferredQuery = useDeferredValue(query);
  const navigate = useNavigate();

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);

    const startX = e.clientX;
    const startWidth = panelWidth;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = startX - e.clientX;
      const newWidth = Math.min(600, Math.max(320, startWidth + delta));
      setPanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [panelWidth]);

  const handleRowClick = (r: PasRecord) => {
    setDisplayedSensor(r);
    setPanelOpen(true);
    setActiveTab("home");
  };

  const handleClosePanel = () => {
    setPanelOpen(false);
    // Don't clear displayedSensor immediately - let animation finish
  };

  const { data } = useQuery({
    queryKey: ["pas"],
    queryFn: () => getJson<PasCollection>("/api/pas")
  });

  const { data: patData, isLoading: patLoading } = useQuery({
    queryKey: ["side-panel-pat", displayedSensor?.id],
    queryFn: () => getJson<PatSeries>(`/api/pat?id=${displayedSensor!.id}&aggregate=raw`),
    enabled: Boolean(displayedSensor) && (activeTab === "timeseries" || activeTab === "health" || activeTab === "diagnostics"),
  });

  const { data: sohData, isLoading: sohLoading } = useQuery({
    queryKey: ["side-panel-soh", displayedSensor?.id],
    queryFn: () => postJson<EnhancedSohIndexResult>("/api/soh/enhanced", { series: patData }),
    enabled: Boolean(patData) && activeTab === "health",
  });

  const { data: outlierData, isLoading: outlierLoading } = useQuery({
    queryKey: ["side-panel-outliers", displayedSensor?.id],
    queryFn: () => postJson<OutlierResult>("/api/outliers", { series: patData, windowSize: 7, thresholdMin: 3 }),
    enabled: Boolean(patData) && activeTab === "diagnostics",
  });

  const filtered = useMemo(() => {
    if (!data) return null;
    return pasFilter(data, {
      labelQuery: deferredQuery,
      isOutside: outsideOnly ? true : undefined
    });
  }, [data, deferredQuery, outsideOnly]);

  const columns = useMemo(() => buildColumns(pm25Window), [pm25Window]);

  if (!filtered) {
    return (
      <div className={styles.grid}>
        <Card>
          <PageHeader
            eyebrow="PAS Explorer"
            title="Browse synoptic PurpleAir coverage"
            subtitle="Loading archive-backed sensor snapshots from the worker API."
          />
        </Card>
      </div>
    );
  }

  const windowLabel = pm25WindowOptions.find((o) => o.value === pm25Window)?.label ?? "1hr";
  const averagePm =
    filtered.records.reduce((sum, r) => sum + getPm25ForWindow(r, pm25Window), 0) /
    Math.max(filtered.records.length, 1);
  const meanBand = pm25ToAqiBand(averagePm);

  const sensorBand = displayedSensor ? pm25ToAqiBand(displayedSensor.pm25Current) : null;

  return (
    <div className={styles.pageLayout}>
      <div className={styles.mainContent}>
        <div className={styles.hero}>
          <PageHeader
            eyebrow="PAS Explorer"
            title="Browse synoptic PurpleAir coverage"
            subtitle="Filter live or archive-backed sensor snapshots, inspect AQI-adjacent PM2.5, and jump into a detailed timeseries workflow."
          />

          <div className={styles.controls}>
            <input
              aria-label="Sensor search"
              className={styles.search}
              placeholder="Search by label..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              aria-label="PM2.5 time window"
              className={styles.select}
              value={pm25Window}
              onChange={(e) => setPm25Window(e.target.value as Pm25Window)}
            >
              {pm25WindowOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  PM2.5 {opt.label}
                </option>
              ))}
            </select>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={outsideOnly}
                onChange={() => setOutsideOnly((v) => !v)}
              />
              Outside only
            </label>
            <Button
              onClick={() =>
                startTransition(() => {
                  const target = filtered.records[0]?.id ?? "1001";
                  navigate(`/sensor/${target}`);
                })
              }
            >
              Open first match
            </Button>
          </div>

          <div className={styles.stats}>
            <StatCard label="Visible sensors" value={`${filtered.records.length}`} />
            <StatCard
              label={`Mean PM2.5 (${windowLabel})`}
              value={`${averagePm.toFixed(2)} ug/m3`}
              tone={meanBand.label === "Good" ? "good" : "warn"}
            />
            <StatCard label="AQI band" value={meanBand.label} />
          </div>
        </div>

        <Card padded={false} className={styles.listCard}>
          <div className={styles.viewBar}>
            <div className={styles.viewBarLeft}>
              <span className={styles.viewName}>All Sensors &middot; {filtered.records.length}</span>
            </div>
            <div className={styles.viewBarRight}>
              <button className={styles.viewBarButton}>Filter</button>
              <button className={styles.viewBarButton}>Sort</button>
              <button className={styles.viewBarButton}>Options</button>
            </div>
          </div>
          <DataTable
            columns={columns}
            data={filtered.records}
            rowKey={(r) => r.id}
            onRowClick={handleRowClick}
            selectedRowKey={displayedSensor?.id ?? null}
            emptyMessage="No sensors match your filter"
            pageSize={25}
            footer={<span>{filtered.records.length} sensors</span>}
          />
        </Card>
      </div>

      {panelOpen && (
        <div
          className={`${styles.resizeHandle} ${isResizing ? styles.resizeHandleActive : ""}`}
          onMouseDown={handleMouseDown}
        />
      )}

      <div
        className={`${styles.sidePanelWrapper} ${panelOpen ? styles.sidePanelWrapperOpen : styles.sidePanelWrapperClosed}`}
        style={panelOpen ? {
          width: panelWidth,
          transition: isResizing ? 'none' : undefined
        } : undefined}
      >
        {displayedSensor && sensorBand && (
          <aside className={styles.sidePanel} style={{ width: panelWidth }}>
            {/* Close button row */}
            <div className={styles.sidePanelCloseRow}>
              <button
                className={styles.sidePanelClose}
                onClick={handleClosePanel}
                aria-label="Close detail panel"
              >
                <IconClose />
              </button>
            </div>

            {/* Header: icon + title + subtitle */}
            <div className={styles.sidePanelHeader}>
              <div
                className={styles.sidePanelIcon}
                style={{ background: sensorBand.color }}
                title={sensorBand.label}
              >
                A
              </div>
              <div className={styles.sidePanelHeaderInfo}>
                <div className={styles.sidePanelTitle}>{displayedSensor.label}</div>
                <div className={styles.sidePanelSubtitle}>
                  #{displayedSensor.id} &middot; Created by PurpleAir
                </div>
              </div>
            </div>

            {/* Tab bar */}
            <div className={styles.tabBar}>
              <button
                className={`${styles.tab} ${activeTab === "home" ? styles.tabActive : ""}`}
                onClick={() => setActiveTab("home")}
              >
                <IconHome /> Home
              </button>
              <button
                className={`${styles.tab} ${activeTab === "timeseries" ? styles.tabActive : ""}`}
                onClick={() => setActiveTab("timeseries")}
              >
                <IconTimeseries /> Timeseries
              </button>
              <button
                className={`${styles.tab} ${activeTab === "health" ? styles.tabActive : ""}`}
                onClick={() => setActiveTab("health")}
              >
                <IconHeart /> Health
              </button>
              <button
                className={`${styles.tab} ${activeTab === "diagnostics" ? styles.tabActive : ""}`}
                onClick={() => setActiveTab("diagnostics")}
              >
                <IconSearch /> Diagnostics
              </button>
            </div>

            {/* Tab content */}
            <div className={styles.sidePanelBody}>
              {activeTab === "home" && (
                <SidePanelHomeTab sensor={displayedSensor} />
              )}
              {activeTab === "timeseries" && (
                <SidePanelTimeseriesTab sensor={displayedSensor} patData={patData} isLoading={patLoading} />
              )}
              {activeTab === "health" && (
                <SidePanelHealthTab sohData={sohData} isLoading={patLoading || sohLoading} />
              )}
              {activeTab === "diagnostics" && (
                <SidePanelDiagnosticsTab outlierData={outlierData} patData={patData} isLoading={patLoading || outlierLoading} />
              )}
            </div>

            {/* Footer */}
            <div className={styles.sidePanelFooter}>
              <Button
                variant="secondary"
                size="small"
                onClick={() => navigate(`/diagnostics/${displayedSensor.id}`)}
              >
                Options
              </Button>
              <Button
                variant="accent"
                size="small"
                onClick={() => navigate(`/sensor/${displayedSensor.id}`)}
              >
                Open{" "}
                <span className={styles.kbdHint}>
                  <kbd className={styles.kbd}>&#8984;</kbd>
                  <kbd className={styles.kbd}>&#9166;</kbd>
                </span>
              </Button>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
