import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EChartsCoreOption } from "echarts/core";

import {
  aqiComposition,
  aggregateStandardMeasurements,
  autoQaQcFlags,
  computeDailySummaries,
  parseStandardMeasurementTable,
  pm25ToAqiBand,
  summarizeSites,
  type PasCollection,
  type PasRecord,
  type PatSeries,
} from "@patool/shared";

import { Button, Card, CellStack, Chip, DataTable, Loader, PageHeader, StatCard } from "../components";
import type { Column } from "../components";
import { EChart } from "../components/EChart";
import { getJson } from "../lib/api";
import { downloadCsv, objectsToCsv, suggestFilename } from "../lib/exporters";
import { useChartTheme } from "../hooks/useChartTheme";
import styles from "./NetworkSummaryPage.module.css";

const DEFAULT_SENSOR_ID = "1001";

type RankedSensor = {
  id: string;
  label: string;
  pm25: number;
  aqiLabel: ReturnType<typeof pm25ToAqiBand>["label"];
  latitude: number;
  longitude: number;
};

type ImportedSummaryRow = ReturnType<typeof summarizeSites>[number];

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sensorPm25(record: PasRecord): number | null {
  const candidates = [
    record.pm25Current,
    record.pm25_1hr,
    record.pm25_10min,
    record.pm25_1day,
    record.pm25Atm,
    record.pm25Cf1,
  ];
  return candidates.find(finiteNumber) ?? null;
}

function fmt(value: number | null | undefined, digits = 1): string {
  return finiteNumber(value) ? value.toFixed(digits) : "Unavailable";
}

function chipVariant(label: string): "default" | "success" | "warning" | "danger" | "accent" {
  if (label === "Good") return "success";
  if (label === "Moderate") return "warning";
  if (label.includes("Unhealthy")) return "accent";
  if (label === "Hazardous") return "danger";
  return "default";
}

const columns: Column<RankedSensor>[] = [
  {
    key: "sensor",
    header: "Sensor",
    width: 240,
    render: (row) => <CellStack primary={row.label} sub={row.id} />,
  },
  {
    key: "pm25",
    header: "PM2.5",
    width: 110,
    render: (row) => `${fmt(row.pm25)} ug/m3`,
  },
  {
    key: "aqi",
    header: "AQI band",
    width: 130,
    render: (row) => <Chip variant={chipVariant(row.aqiLabel)}>{row.aqiLabel}</Chip>,
  },
  {
    key: "coords",
    header: "Coordinates",
    width: 170,
    render: (row) => `${row.latitude.toFixed(4)}, ${row.longitude.toFixed(4)}`,
  },
];

const importedSummaryColumns: Column<ImportedSummaryRow>[] = [
  {
    key: "site",
    header: "Site",
    width: 140,
    render: (row) => row.id,
  },
  {
    key: "count",
    header: "Count",
    width: 80,
    render: (row) => String(row.count),
  },
  {
    key: "missing",
    header: "Missing",
    width: 100,
    render: (row) => `${row.missingPercent.toFixed(1)}%`,
  },
  {
    key: "mean",
    header: "Mean",
    width: 100,
    render: (row) => fmt(row.mean),
  },
  {
    key: "median",
    header: "Median",
    width: 100,
    render: (row) => fmt(row.median),
  },
  {
    key: "range",
    header: "Range",
    width: 130,
    render: (row) => `${fmt(row.min)} - ${fmt(row.max)}`,
  },
];

export default function NetworkSummaryPage() {
  const ct = useChartTheme();
  const [standardTableText, setStandardTableText] = useState("");
  const { data: collection } = useQuery({
    queryKey: ["network-summary-pas"],
    queryFn: () => getJson<PasCollection>("/api/pas"),
  });
  const { data: series } = useQuery({
    queryKey: ["network-summary-series", DEFAULT_SENSOR_ID],
    queryFn: () => getJson<PatSeries>(`/api/pat?id=${DEFAULT_SENSOR_ID}&aggregate=raw`),
  });

  const ranked = useMemo<RankedSensor[]>(() => {
    const rows: RankedSensor[] = [];
    for (const record of collection?.records ?? []) {
        const pm25 = sensorPm25(record);
        if (!finiteNumber(pm25)) continue;
        const band = pm25ToAqiBand(pm25);
        rows.push({
          id: record.id,
          label: record.label,
          pm25,
          aqiLabel: band.label,
          latitude: record.latitude,
          longitude: record.longitude,
        });
    }
    return rows.sort((a, b) => b.pm25 - a.pm25);
  }, [collection]);

  const composition = useMemo(() => aqiComposition(ranked.map((row) => row.pm25)), [ranked]);
  const parsedStandardTable = useMemo(() => (
    standardTableText.trim()
      ? parseStandardMeasurementTable(standardTableText, { valueColumn: undefined })
      : null
  ), [standardTableText]);
  const importedSummaries = useMemo(() => (
    parsedStandardTable ? summarizeSites(parsedStandardTable.rows) : []
  ), [parsedStandardTable]);
  const importedDaily = useMemo(() => (
    parsedStandardTable ? aggregateStandardMeasurements(parsedStandardTable.rows, "day") : []
  ), [parsedStandardTable]);
  const dailySummaries = useMemo(() => (series ? computeDailySummaries(series) : []), [series]);
  const qaFlags = useMemo(() => {
    if (!series) return [];
    return autoQaQcFlags(series.points.map((point) => ({
      id: series.meta.sensorId,
      timestamp: point.timestamp,
      value: finiteNumber(point.pm25A) && finiteNumber(point.pm25B)
        ? (point.pm25A + point.pm25B) / 2
        : point.pm25A ?? point.pm25B,
    })));
  }, [series]);

  const compositionOption = useMemo<EChartsCoreOption>(() => ({
    textStyle: { fontFamily: "Inter, sans-serif", color: ct.text },
    tooltip: { trigger: "axis", backgroundColor: ct.tooltipBg, borderColor: ct.tooltipBorder, textStyle: { color: ct.tooltipText } },
    grid: { top: 16, right: 18, bottom: 42, left: 42 },
    xAxis: {
      type: "category",
      data: composition.map((row) => row.label),
      axisLabel: { color: ct.axis, fontSize: 9, interval: 0, rotate: 25 },
      axisLine: { lineStyle: { color: ct.grid } },
    },
    yAxis: {
      type: "value",
      name: "Sensors",
      axisLabel: { color: ct.axis, fontSize: 9 },
      splitLine: { lineStyle: { color: ct.grid } },
    },
    series: [{
      type: "bar",
      data: composition.map((row) => ({ value: row.count, itemStyle: { color: row.color } })),
      barMaxWidth: 40,
    }],
  }), [composition, ct]);

  const rankedOption = useMemo<EChartsCoreOption>(() => {
    const top = ranked.slice(0, 18).reverse();
    return {
      textStyle: { fontFamily: "Inter, sans-serif", color: ct.text },
      tooltip: { trigger: "axis", backgroundColor: ct.tooltipBg, borderColor: ct.tooltipBorder, textStyle: { color: ct.tooltipText } },
      grid: { top: 10, right: 24, bottom: 28, left: 150 },
      xAxis: {
        type: "value",
        name: "ug/m3",
        axisLabel: { color: ct.axis, fontSize: 9 },
        splitLine: { lineStyle: { color: ct.grid } },
      },
      yAxis: {
        type: "category",
        data: top.map((row) => row.label),
        axisLabel: { color: ct.axis, fontSize: 9, width: 136, overflow: "truncate" },
      },
      series: [{
        type: "bar",
        data: top.map((row) => row.pm25),
        itemStyle: { color: ct.colors[1] },
        barMaxWidth: 16,
      }],
    };
  }, [ranked, ct]);

  const calendarOption = useMemo<EChartsCoreOption | null>(() => {
    if (dailySummaries.length === 0) return null;
    const dates = dailySummaries.map((row) => row.date).sort();
    const start = dates[0];
    const end = dates.at(-1) ?? start;
    const values = dailySummaries
      .filter((row) => row.fullDay.mean !== null)
      .map((row) => [row.date, row.fullDay.mean]);
    return {
      textStyle: { fontFamily: "Inter, sans-serif", color: ct.text },
      tooltip: {
        backgroundColor: ct.tooltipBg,
        borderColor: ct.tooltipBorder,
        textStyle: { color: ct.tooltipText },
      },
      visualMap: {
        min: 0,
        max: Math.max(30, ...values.map((row) => Number(row[1]))),
        orient: "horizontal",
        left: "center",
        bottom: 0,
        textStyle: { color: ct.axis, fontSize: 10 },
        inRange: { color: ["#d8f3dc", "#ffd166", "#ef476f", "#6d597a"] },
      },
      calendar: {
        top: 16,
        left: 28,
        right: 28,
        bottom: 52,
        range: [start, end],
        cellSize: ["auto", 18],
        itemStyle: { borderColor: ct.grid, borderWidth: 1 },
        dayLabel: { color: ct.axis, fontSize: 9 },
        monthLabel: { color: ct.axis, fontSize: 10 },
        yearLabel: { show: false },
      },
      series: [{
        type: "heatmap",
        coordinateSystem: "calendar",
        data: values,
      }],
    };
  }, [dailySummaries, ct]);

  if (!collection || !series) {
    return <Loader message="Loading network summary..." />;
  }

  const validValues = ranked.map((row) => row.pm25);
  const mean = validValues.length ? validValues.reduce((sum, value) => sum + value, 0) / validValues.length : null;
  const max = validValues.length ? Math.max(...validValues) : null;
  const topBand = composition.reduce((best, row) => (row.count > best.count ? row : best), composition[0]);

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow="Network Summary"
        title="Network summary and ASNAT-style diagnostics"
        subtitle="A modular workbench for network-wide AQI composition, ranked sensor summaries, daily calendar heatmaps, and automatic QA flags."
      />

      <div className={styles.stats}>
        <StatCard label="Sensors with PM2.5" value={`${ranked.length}`} />
        <StatCard label="Network mean" value={`${fmt(mean)} ug/m3`} />
        <StatCard label="Network max" value={`${fmt(max)} ug/m3`} tone={max && max > 35 ? "warn" : "neutral"} />
        <StatCard label="Dominant AQI band" value={topBand?.label ?? "Unavailable"} />
        <StatCard label="QA flags in sample series" value={`${qaFlags.length}`} tone={qaFlags.length > 0 ? "warn" : "good"} />
      </div>

      <div className={styles.grid}>
        <Card title="AQI category composition" className={styles.wide}>
          <EChart option={compositionOption} height={320} />
        </Card>

        <Card title="Highest PM2.5 sensors" className={styles.wide}>
          <EChart option={rankedOption} height={320} />
        </Card>
      </div>

      <Card title={`Daily PM2.5 calendar for ${series.meta.label}`}>
        {calendarOption ? (
          <>
            <div className={styles.compactMeta}>
              <span>{dailySummaries.length} local days</span>
              <span>{series.meta.timezone}</span>
              <span>{qaFlags.length} automatic QA flags</span>
            </div>
            <EChart option={calendarOption} height={300} />
          </>
        ) : (
          <p className={styles.empty}>No daily means are available for the selected sample sensor.</p>
        )}
      </Card>

      <Card title="Ranked sensor table">
        <div className={styles.actions}>
          <Button
            size="small"
            variant="secondary"
            onClick={() => downloadCsv(
              suggestFilename("network-summary-ranked-sensors", "csv"),
              objectsToCsv(ranked.map((row) => ({
                id: row.id,
                label: row.label,
                pm25: row.pm25,
                aqiBand: row.aqiLabel,
                latitude: row.latitude,
                longitude: row.longitude,
              }))),
            )}
            disabled={ranked.length === 0}
          >
            Ranked CSV
          </Button>
          <Button
            size="small"
            variant="secondary"
            onClick={() => downloadCsv(
              suggestFilename("network-summary-aqi-composition", "csv"),
              objectsToCsv(composition.map((row) => ({
                category: row.label,
                count: row.count,
                percent: row.percent,
              }))),
            )}
            disabled={composition.length === 0}
          >
            AQI CSV
          </Button>
        </div>
        <div className={styles.tableWrap}>
          <DataTable
            columns={columns}
            data={ranked.slice(0, 40)}
            rowKey={(row) => row.id}
            emptyMessage="No sensors with finite PM2.5 values"
            footer={<span>Showing top {Math.min(40, ranked.length)} of {ranked.length} sensors</span>}
          />
        </div>
      </Card>

      <Card title="Standard table import">
        <textarea
          className={styles.importBox}
          value={standardTableText}
          onChange={(event) => setStandardTableText(event.target.value)}
          placeholder={"Paste ASNAT-style tabular data with timestamp(UTC), id(-), longitude(deg), latitude(deg), and a measurement column."}
          rows={7}
        />
        {parsedStandardTable ? (
          <>
            <div className={styles.compactMeta}>
              <span>{parsedStandardTable.rows.length} parsed rows</span>
              <span>{importedSummaries.length} sites</span>
              <span>{importedDaily.length} daily site buckets</span>
              {parsedStandardTable.warnings.map((warning) => <span key={warning}>{warning}</span>)}
            </div>
            <div className={styles.actions}>
              <Button
                size="small"
                variant="secondary"
                onClick={() => downloadCsv(
                  suggestFilename("standard-table-site-summary", "csv"),
                  objectsToCsv(importedSummaries),
                )}
                disabled={importedSummaries.length === 0}
              >
                Summary CSV
              </Button>
              <Button
                size="small"
                variant="secondary"
                onClick={() => downloadCsv(
                  suggestFilename("standard-table-daily-aggregation", "csv"),
                  objectsToCsv(importedDaily),
                )}
                disabled={importedDaily.length === 0}
              >
                Daily CSV
              </Button>
            </div>
            <div className={styles.tableWrap}>
              <DataTable
                columns={importedSummaryColumns}
                data={importedSummaries}
                rowKey={(row) => row.id}
                emptyMessage="No site summaries parsed"
                footer={<span>{importedSummaries.length} imported site summaries</span>}
              />
            </div>
          </>
        ) : (
          <p className={styles.empty}>Paste a standard table to preview site summaries and daily aggregations locally.</p>
        )}
      </Card>
    </div>
  );
}
