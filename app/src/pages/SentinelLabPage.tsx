import { useEffect, useMemo, useState } from "react";

import {
  aggregateSentinelRecords,
  buildSentinelCollocationTable,
  buildSentinelQaTable,
  buildSourceDirectionBins,
  estimateLowerQuantileBaseline,
  inferSentinelColumnMapping,
  normalizeSentinelRows,
  parseSentinelCsv,
  renderSentinelQaReportHtml,
  summarizeSentinelQa,
  summarizeSentinelSensors,
  type SourceDirectionStatistic,
  type SentinelAggregatedRecord,
  type SentinelCanonicalField,
  type SentinelColumnMapping,
  type SentinelSensorSummary,
  type SentinelVariableStat,
} from "@patool/shared";

import { Button, Card, DataTable, PageHeader, StatCard, type Column } from "../components";
import { EChart } from "../components/EChart";
import { downloadCsv, objectsToCsv, suggestFilename } from "../lib/exporters";
import { useChartTheme } from "../hooks/useChartTheme";
import styles from "./SentinelLabPage.module.css";

const SAMPLE_CSV = `Local Date Time,Sensor ID,pid1_PPB_Calc,ws_speed,ws_direction,temp,rh_Humd,lat,long,trig.trig_activeFlag,QA
2023-06-12 00:00:00,SPOD-0001,68.24,0.3,270.6,22.5,50.9,49.25,-123.10,1,None
2023-06-12 00:01:00,SPOD-0001,60.64,0.6,221.7,22.6,50.5,49.25,-123.10,,None
2023-06-12 00:02:00,SPOD-0001,59.68,0.3,245.3,22.5,50.2,49.25,-123.10,,Calibration
2023-06-12 00:03:00,SPOD-0001,65.39,0.2,304.9,22.6,51.0,49.25,-123.10,,None
2023-06-12 00:04:00,SPOD-0001,72.10,1.4,315.0,22.7,51.2,49.25,-123.10,,None
2023-06-12 00:05:00,SPOD-0002,52.40,1.1,92.0,21.9,48.4,49.26,-123.11,,None
2023-06-12 00:06:00,SPOD-0002,56.20,1.3,101.0,22.0,48.9,49.26,-123.11,,None
2023-06-12 00:07:00,SPOD-0002,,1.5,370.0,22.1,49.0,49.26,-123.11,,None
2023-06-12 00:08:00,SPOD-0002,61.80,2.4,135.0,22.2,49.5,49.26,-123.11,2,Maintenance
2023-06-12 00:09:00,SPOD-0002,58.30,2.8,150.0,22.3,49.8,49.26,-123.11,,None`;

const FIELDS: Array<{ key: SentinelCanonicalField; label: string }> = [
  { key: "sensorId", label: "Sensor ID" },
  { key: "timestamp", label: "Timestamp" },
  { key: "signal", label: "Signal" },
  { key: "windSpeed", label: "Wind speed" },
  { key: "windDirection", label: "Wind direction" },
  { key: "temperature", label: "Temperature" },
  { key: "humidity", label: "Humidity" },
  { key: "latitude", label: "Latitude" },
  { key: "longitude", label: "Longitude" },
  { key: "canister", label: "Canister" },
  { key: "qa", label: "QA" },
];

function fmt(value: number | null | undefined, digits = 2) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "-";
}

function shortTime(value: string | null) {
  return value ? new Date(value).toLocaleString() : "-";
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
    link.remove();
  }, 1000);
}

export default function SentinelLabPage() {
  const ct = useChartTheme();
  const [csvText, setCsvText] = useState(SAMPLE_CSV);
  const [skipRows, setSkipRows] = useState(0);
  const [windSpeedUnit, setWindSpeedUnit] = useState<"m/s" | "mph">("m/s");
  const [qaPassOnly, setQaPassOnly] = useState(false);
  const [minWind, setMinWind] = useState(0);
  const [sourceStatistic, setSourceStatistic] = useState<SourceDirectionStatistic>("median");
  const [activeSensorId, setActiveSensorId] = useState("");
  const [mappingOverrides, setMappingOverrides] = useState<SentinelColumnMapping>({});

  const rows = useMemo(() => parseSentinelCsv(csvText, { skipRows }), [csvText, skipRows]);
  const headers = useMemo(() => Object.keys(rows[0] ?? {}), [rows]);
  const inferredMapping = useMemo(() => inferSentinelColumnMapping(headers), [headers]);
  const mapping = useMemo(() => ({ ...inferredMapping, ...mappingOverrides }), [inferredMapping, mappingOverrides]);
  const normalized = useMemo(
    () => normalizeSentinelRows(rows, { mapping, windSpeedUnit, autoQa: true }),
    [rows, mapping, windSpeedUnit],
  );
  const baseline = useMemo(
    () => estimateLowerQuantileBaseline(normalized.map((row) => row.signal), { windowSize: 5 }),
    [normalized],
  );
  const aggregated = useMemo(() => aggregateSentinelRecords(normalized, { intervalMinutes: 5 }), [normalized]);
  const filteredAggregated = useMemo(
    () =>
      aggregated.filter((row) => {
        if (qaPassOnly && row.qaFlags.length > 0) return false;
        if (minWind > 0 && (row.windSpeed === null || row.windSpeed < minWind)) return false;
        return true;
      }),
    [aggregated, qaPassOnly, minWind],
  );
  const qaSummary = useMemo(() => summarizeSentinelQa(normalized), [normalized]);
  const sensorSummaries = useMemo(() => summarizeSentinelSensors(aggregated), [aggregated]);
  const sensorIds = useMemo(() => sensorSummaries.map((summary) => summary.sensorId), [sensorSummaries]);
  const resolvedActiveSensorId = activeSensorId || sensorIds[0] || "";
  const activeRows = useMemo(
    () => filteredAggregated.filter((row) => !resolvedActiveSensorId || row.sensorId === resolvedActiveSensorId),
    [filteredAggregated, resolvedActiveSensorId],
  );
  const qaTable = useMemo(() => buildSentinelQaTable(activeRows), [activeRows]);
  const collocationTable = useMemo(() => {
    const [a, b] = sensorSummaries.map((summary) => summary.sensorId);
    if (!a || !b) return [];
    return buildSentinelCollocationTable(
      filteredAggregated.filter((row) => row.sensorId === a),
      filteredAggregated.filter((row) => row.sensorId === b),
    );
  }, [filteredAggregated, sensorSummaries]);
  const sourceBins = useMemo(
    () => buildSourceDirectionBins(activeRows, { minWindSpeed: minWind, statistic: sourceStatistic }),
    [activeRows, minWind, sourceStatistic],
  );

  useEffect(() => {
    if (activeSensorId && sensorIds.includes(activeSensorId)) return;
    setActiveSensorId(sensorIds[0] ?? "");
  }, [activeSensorId, sensorIds]);

  const baselineOption = useMemo(() => ({
    textStyle: { fontFamily: "Inter, sans-serif", color: ct.text },
    tooltip: { trigger: "axis" as const, backgroundColor: ct.tooltipBg, borderColor: ct.tooltipBorder, textStyle: { color: ct.tooltipText } },
    legend: { top: 0, textStyle: { color: ct.text, fontSize: 10 } },
    grid: { top: 30, right: 12, bottom: 34, left: 46 },
    xAxis: { type: "category" as const, data: normalized.map((row) => new Date(row.timestamp).toLocaleTimeString()), axisLabel: { color: ct.axis, fontSize: 9 }, axisLine: { lineStyle: { color: ct.grid } } },
    yAxis: { type: "value" as const, name: "Signal", axisLabel: { color: ct.axis, fontSize: 9 }, splitLine: { lineStyle: { color: ct.grid } } },
    series: [
      { name: "Raw", type: "line" as const, data: normalized.map((row) => row.signal), color: ct.colors[0], symbol: "none" },
      { name: "Baseline", type: "line" as const, data: baseline.baseline, color: ct.colors[2], symbol: "none" },
      { name: "Corrected", type: "line" as const, data: baseline.corrected, color: ct.colors[3], symbol: "none" },
    ],
  }), [baseline, ct, normalized]);

  const sourceOption = useMemo(() => ({
    textStyle: { fontFamily: "Inter, sans-serif", color: ct.text },
    tooltip: {
      trigger: "item" as const,
      backgroundColor: ct.tooltipBg,
      borderColor: ct.tooltipBorder,
      textStyle: { color: ct.tooltipText },
      formatter: (p: { value: Array<number | string> }) => `Direction: ${Number(p.value[0]).toFixed(0)} deg<br/>Speed bin: ${p.value[1]}<br/>${sourceStatistic}: ${Number(p.value[2]).toFixed(1)}`,
    },
    angleAxis: { type: "value" as const, min: 0, max: 360, interval: 45, startAngle: 90, axisLabel: { color: ct.text, fontSize: 9 }, splitLine: { lineStyle: { color: ct.grid } } },
    radiusAxis: { type: "category" as const, data: ["0-1", "1-2", "2-4", "4-6", "6+"], axisLabel: { color: ct.axis, fontSize: 9 }, splitLine: { lineStyle: { color: ct.grid } } },
    polar: {},
    visualMap: { min: 0, max: Math.max(1, ...sourceBins.map((bin) => bin.value)), dimension: 2, right: 4, top: "middle", itemWidth: 10, textStyle: { color: ct.text, fontSize: 9 }, inRange: { color: ["#2f8f83", "#e7c24f", "#d96f32", "#bd3b43"] } },
    series: [{ type: "scatter" as const, coordinateSystem: "polar" as const, data: sourceBins.filter((bin) => bin.count > 0).map((bin) => [bin.directionDeg, bin.speedBin, bin.value]), symbolSize: (value: number[]) => Math.max(5, Math.min(22, value[2] / 3)) }],
  }), [ct, sourceBins, sourceStatistic]);

  const frequencyOption = useMemo(() => {
    const byDirection = new Map<string, number>();
    for (const bin of sourceBins) byDirection.set(bin.direction, (byDirection.get(bin.direction) ?? 0) + bin.count);
    const directions = [...byDirection.keys()];
    return {
      textStyle: { fontFamily: "Inter, sans-serif", color: ct.text },
      tooltip: { trigger: "axis" as const, backgroundColor: ct.tooltipBg, borderColor: ct.tooltipBorder, textStyle: { color: ct.tooltipText } },
      grid: { top: 16, right: 12, bottom: 32, left: 38 },
      xAxis: { type: "category" as const, data: directions, axisLabel: { color: ct.axis, fontSize: 9 }, axisLine: { lineStyle: { color: ct.grid } } },
      yAxis: { type: "value" as const, name: "Count", axisLabel: { color: ct.axis, fontSize: 9 }, splitLine: { lineStyle: { color: ct.grid } } },
      series: [{ name: "Frequency", type: "bar" as const, data: directions.map((direction) => byDirection.get(direction) ?? 0), color: ct.colors[1] }],
    };
  }, [ct, sourceBins]);

  const eventOption = useMemo(() => {
    const times = activeRows.map((row) => new Date(row.timestamp).toLocaleTimeString());
    return {
      textStyle: { fontFamily: "Inter, sans-serif", color: ct.text },
      tooltip: { trigger: "axis" as const, backgroundColor: ct.tooltipBg, borderColor: ct.tooltipBorder, textStyle: { color: ct.tooltipText } },
      legend: { top: 0, textStyle: { color: ct.text, fontSize: 10 } },
      grid: { top: 30, right: 18, bottom: 34, left: 46 },
      xAxis: { type: "category" as const, data: times, axisLabel: { color: ct.axis, fontSize: 9 }, axisLine: { lineStyle: { color: ct.grid } } },
      yAxis: { type: "value" as const, name: "Signal", axisLabel: { color: ct.axis, fontSize: 9 }, splitLine: { lineStyle: { color: ct.grid } } },
      series: [
        { name: "Signal", type: "line" as const, data: activeRows.map((row) => row.signal), color: ct.colors[0], symbol: "none" },
        {
          name: "QA / events",
          type: "scatter" as const,
          data: activeRows.map((row) => (row.qaFlags.length || row.canister ? row.signal : null)),
          itemStyle: { color: ct.colors[3] },
          symbolSize: 8,
        },
      ],
    };
  }, [activeRows, ct]);

  const sensorColumns: Column<SentinelSensorSummary>[] = [
    { key: "sensor", header: "Sensor", render: (row) => row.sensorId, sortable: true },
    { key: "start", header: "Start", render: (row) => shortTime(row.startTime), sortable: true },
    { key: "end", header: "End", render: (row) => shortTime(row.endTime), sortable: true },
    { key: "count", header: "5-min bins", render: (row) => row.count, sortable: true },
    { key: "qa", header: "QA flags", render: (row) => row.qaFlags.join(", ") || "None" },
  ];
  const qaColumns: Column<SentinelVariableStat>[] = [
    { key: "variable", header: "Variable", render: (row) => row.variable, sortable: true },
    { key: "mean", header: "Mean", render: (row) => fmt(row.mean), sortable: true, sortValue: (row) => row.mean },
    { key: "std", header: "SD", render: (row) => fmt(row.std), sortable: true, sortValue: (row) => row.std },
    { key: "median", header: "Median", render: (row) => fmt(row.median), sortable: true, sortValue: (row) => row.median },
    { key: "min", header: "Min", render: (row) => fmt(row.min), sortable: true, sortValue: (row) => row.min },
    { key: "max", header: "Max", render: (row) => fmt(row.max), sortable: true, sortValue: (row) => row.max },
    { key: "complete", header: "% Complete", render: (row) => fmt(row.completeness, 1), sortable: true, sortValue: (row) => row.completeness },
  ];
  const processedColumns: Column<SentinelAggregatedRecord>[] = [
    { key: "time", header: "Time", render: (row) => shortTime(row.timestamp), sortable: true },
    { key: "sensor", header: "Sensor", render: (row) => row.sensorId, sortable: true },
    { key: "signal", header: "Signal", render: (row) => fmt(row.signal), sortable: true, sortValue: (row) => row.signal },
    { key: "ws", header: "WS", render: (row) => fmt(row.windSpeed), sortable: true, sortValue: (row) => row.windSpeed },
    { key: "wd", header: "WD", render: (row) => fmt(row.windDirection), sortable: true, sortValue: (row) => row.windDirection },
    { key: "qa", header: "QA", render: (row) => row.qaFlags.join(", ") || "None" },
  ];

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow="SENTINEL import lab"
        title="Fenceline sensor QA, rollups, and source direction"
        subtitle="Bring arbitrary sensor CSVs into PAtool, normalize fields, apply QA flags, aggregate to 5-minute records, and generate source-direction diagnostics."
      />

      <div className={styles.stats}>
        <StatCard label="Raw rows" value={rows.length.toLocaleString()} />
        <StatCard label="5-min bins" value={aggregated.length.toLocaleString()} />
        <StatCard label="Sensors" value={sensorSummaries.length.toLocaleString()} />
        <StatCard label="QA flagged" value={qaSummary.flaggedRows.toLocaleString()} tone={qaSummary.flaggedRows ? "warn" : "good"} />
        <StatCard label="QA pass" value={qaSummary.passRows.toLocaleString()} tone="good" />
      </div>

      <div className={styles.grid}>
        <Card title="Import and mapping">
          <div className={styles.controls}>
            <label className={styles.field}>
              CSV file
              <input
                type="file"
                accept=".csv,text/csv,text/plain"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (!file) return;
                  file.text().then((text) => {
                    setCsvText(text);
                    setMappingOverrides({});
                  });
                }}
              />
            </label>
            <label className={styles.field}>
              CSV data
              <textarea value={csvText} onChange={(event) => setCsvText(event.target.value)} spellCheck={false} />
            </label>
            <div className={styles.controlRow}>
              <label className={styles.field}>
                Header rows to skip
                <input type="number" min={0} value={skipRows} onChange={(event) => setSkipRows(Number(event.target.value))} />
              </label>
              <label className={styles.field}>
                Wind speed units
                <select value={windSpeedUnit} onChange={(event) => setWindSpeedUnit(event.target.value as "m/s" | "mph")}>
                  <option value="m/s">m/s</option>
                  <option value="mph">mph</option>
                </select>
              </label>
            </div>
            <div className={styles.controlRow}>
              <label className={styles.field}>
                Minimum wind speed
                <input type="number" min={0} step={0.1} value={minWind} onChange={(event) => setMinWind(Number(event.target.value))} />
              </label>
              <label className={styles.field}>
                QA filter
                <select value={qaPassOnly ? "pass" : "all"} onChange={(event) => setQaPassOnly(event.target.value === "pass")}>
                  <option value="all">All rows</option>
                  <option value="pass">QA pass only</option>
                </select>
              </label>
            </div>
            <div className={styles.controlRow}>
              <label className={styles.field}>
                Active sensor
                <select value={resolvedActiveSensorId} onChange={(event) => setActiveSensorId(event.target.value)}>
                  {sensorIds.map((id) => <option key={id} value={id}>{id}</option>)}
                </select>
              </label>
              <label className={styles.field}>
                Source statistic
                <select value={sourceStatistic} onChange={(event) => setSourceStatistic(event.target.value as SourceDirectionStatistic)}>
                  <option value="median">Median</option>
                  <option value="mean">Mean</option>
                  <option value="max">Maximum</option>
                  <option value="frequency">Frequency</option>
                </select>
              </label>
            </div>
            <div className={styles.mapping}>
              {FIELDS.map((field) => (
                <label key={field.key} className={styles.field}>
                  {field.label}
                  <select
                    value={mapping[field.key] ?? ""}
                    onChange={(event) => setMappingOverrides((previous) => ({ ...previous, [field.key]: event.target.value || undefined }))}
                  >
                    <option value="">Not mapped</option>
                    {headers.map((header) => <option key={header} value={header}>{header}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <div className={styles.actions}>
              <Button
                size="small"
                variant="secondary"
                onClick={() => downloadCsv(suggestFilename("sentinel-processed-5min", "csv"), objectsToCsv(aggregated.map<Record<string, string | number | null>>((row) => {
                  const { qaFlags, ...csvRow } = row;
                  return { ...csvRow, qaFlags: qaFlags.join("; ") };
                })))}
                disabled={!aggregated.length}
              >
                Processed CSV
              </Button>
              <Button
                size="small"
                variant="secondary"
                onClick={() => downloadCsv(suggestFilename("sentinel-qa-table", "csv"), objectsToCsv(qaTable))}
                disabled={!qaTable.length}
              >
                QA table CSV
              </Button>
              <Button
                size="small"
                variant="secondary"
                onClick={() => {
                  const html = renderSentinelQaReportHtml({
                    title: "SENTINEL QA report",
                    sensorId: resolvedActiveSensorId,
                    sensorSummaries,
                    qaTable,
                    collocationTable,
                  });
                  downloadBlob(new Blob([html], { type: "text/html" }), suggestFilename("sentinel-qa-report", "html"));
                }}
                disabled={!qaTable.length}
              >
                HTML report
              </Button>
            </div>
          </div>
        </Card>

        <div className={styles.charts}>
          <Card title="Baseline correction">
            {normalized.length ? <EChart option={baselineOption} height={300} zoomable /> : <p className={styles.muted}>Paste CSV data to compute a baseline.</p>}
          </Card>
          <Card title="Source direction indicator">
            {sourceBins.some((bin) => bin.count > 0) ? <EChart option={sourceOption} height={300} /> : <p className={styles.muted}>Mapped wind direction, wind speed, and signal are required.</p>}
          </Card>
          <Card title="Wind frequency">
            {sourceBins.some((bin) => bin.count > 0) ? <EChart option={frequencyOption} height={240} /> : <p className={styles.muted}>Mapped wind data is required.</p>}
          </Card>
          <Card title="QA and event markers">
            {activeRows.length ? <EChart option={eventOption} height={240} zoomable /> : <p className={styles.muted}>Processed rows are required.</p>}
          </Card>
        </div>
      </div>

      <div className={styles.tables}>
        <Card title="Sensor check summary">
          <DataTable columns={sensorColumns} data={sensorSummaries} rowKey={(row) => row.sensorId} pageSize={6} />
        </Card>
        <Card title={`Single-node QA table${resolvedActiveSensorId ? `: ${resolvedActiveSensorId}` : ""}`}>
          <DataTable columns={qaColumns} data={qaTable} rowKey={(row) => row.variable} />
        </Card>
        <Card title="Processed 5-minute data">
          <DataTable columns={processedColumns} data={filteredAggregated} rowKey={(row) => `${row.sensorId}-${row.timestamp}`} pageSize={10} />
        </Card>
        {collocationTable.length > 0 && (
          <Card title="Collocated-node comparison">
            <DataTable
              columns={[
                { key: "variable", header: "Variable", render: (row) => row.variable, sortable: true },
                { key: "a", header: "Sensor A mean", render: (row) => fmt(row.sensorA.mean), sortable: true, sortValue: (row) => row.sensorA.mean },
                { key: "b", header: "Sensor B mean", render: (row) => fmt(row.sensorB.mean), sortable: true, sortValue: (row) => row.sensorB.mean },
                { key: "delta", header: "Mean delta", render: (row) => fmt(row.meanDelta), sortable: true, sortValue: (row) => row.meanDelta },
                { key: "medianDelta", header: "Median delta", render: (row) => fmt(row.medianDelta), sortable: true, sortValue: (row) => row.medianDelta },
              ]}
              data={collocationTable}
              rowKey={(row) => row.variable}
            />
          </Card>
        )}
      </div>
    </div>
  );
}
