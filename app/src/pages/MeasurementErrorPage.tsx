import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  applyLinearBiasCorrection,
  blandAltman,
  densityPoints,
  linearFit,
  relativeExpandedUncertainty,
  type LinearFit,
  type MeasurementPair,
} from "@patool/shared";

import { Card, Loader, PageHeader, StatCard } from "../components";
import { EChart } from "../components/EChart";
import { useChartTheme } from "../hooks/useChartTheme";
import { formatMetric } from "./toolsetUtils";
import styles from "./ToolsetPage.module.css";

type CsvRow = Record<string, string>;

type ExampleDataset = {
  id: string;
  label: string;
  pollutant: string;
  units: string;
  path: string;
  reference: string;
  sensor: string;
  dqObjective?: number;
  limitValue?: number;
  corrected?: {
    path: string;
    reference: string;
    sensor: string;
  };
};

const DATASETS: ExampleDataset[] = [
  {
    id: "no2-lcs",
    label: "NO2 low-cost sensor",
    pollutant: "NO2",
    units: "ppb",
    path: "/examples/measurement-errors/Fig5.csv",
    reference: "NO2",
    sensor: "LCS1",
    dqObjective: 25,
  },
  {
    id: "o3-lcs",
    label: "O3 low-cost sensor",
    pollutant: "O3",
    units: "ppb",
    path: "/examples/measurement-errors/Fig5.csv",
    reference: "O3",
    sensor: "LCS2",
    dqObjective: 30,
  },
  {
    id: "pm25-transfer",
    label: "PM2.5 transfer correction",
    pollutant: "PM2.5",
    units: "ug/m3",
    path: "/examples/measurement-errors/Fig6b.csv",
    reference: "PM2.5_Fidas200",
    sensor: "LCS3",
    dqObjective: 50,
    corrected: {
      path: "/examples/measurement-errors/FigS2_b.csv",
      reference: "PM2.5_Fidas200",
      sensor: "LCS3*",
    },
  },
  {
    id: "no2-reference",
    label: "NO2 reference-vs-reference",
    pollutant: "NO2",
    units: "ppb",
    path: "/examples/measurement-errors/Fig7_panel_b.csv",
    reference: "NO2_T500",
    sensor: "T200U(b)",
    dqObjective: 15,
  },
  {
    id: "o3-reference",
    label: "O3 reference-vs-reference",
    pollutant: "O3",
    units: "ppb",
    path: "/examples/measurement-errors/FigS3_panel_b.csv",
    reference: "O3_49i",
    sensor: "2B",
    dqObjective: 15,
  },
];

function parseCsv(text: string): CsvRow[] {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0]?.split(",") ?? [];
  return lines.slice(1).map((line) => {
    const values = line.split(",");
    const row: CsvRow = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    return row;
  });
}

async function loadCsv(path: string): Promise<CsvRow[]> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Unable to load ${path}`);
  return parseCsv(await response.text());
}

function rowsToPairs(rows: CsvRow[], dataset: Pick<ExampleDataset, "reference" | "sensor">): MeasurementPair[] {
  return rows.map((row) => ({
    time: row.Timestamp,
    reference: Number(row[dataset.reference]),
    sensor: Number(row[dataset.sensor]),
  }));
}

function formatEquation(fit: LinearFit): string {
  const sign = fit.intercept >= 0 ? "+" : "-";
  return `y = ${fit.slope.toFixed(2)}x ${sign} ${Math.abs(fit.intercept).toFixed(2)}`;
}

function lineEndpoints(maxValue: number, fit: LinearFit) {
  return [
    [0, fit.intercept],
    [maxValue, fit.intercept + fit.slope * maxValue],
  ];
}

export default function MeasurementErrorPage() {
  const ct = useChartTheme();
  const [datasetId, setDatasetId] = useState(DATASETS[2].id);
  const [showCorrected, setShowCorrected] = useState(true);
  const dataset = DATASETS.find((item) => item.id === datasetId) ?? DATASETS[0];

  const { data: rawRows, isLoading } = useQuery({
    queryKey: ["measurement-error-csv", dataset.path],
    queryFn: () => loadCsv(dataset.path),
  });
  const { data: correctedRows } = useQuery({
    queryKey: ["measurement-error-csv", dataset.corrected?.path],
    queryFn: () => dataset.corrected ? loadCsv(dataset.corrected.path) : Promise.resolve([]),
    enabled: Boolean(dataset.corrected),
  });

  const pairs = useMemo(() => rowsToPairs(rawRows ?? [], dataset), [dataset, rawRows]);
  const correctedPairs = useMemo(() => {
    if (dataset.corrected && correctedRows) return rowsToPairs(correctedRows, dataset.corrected);
    if (!dataset.corrected && showCorrected) return applyLinearBiasCorrection(pairs).pairs;
    return [];
  }, [correctedRows, dataset.corrected, pairs, showCorrected]);

  const fit = useMemo(() => linearFit(pairs), [pairs]);
  const correctedFit = useMemo(() => linearFit(correctedPairs), [correctedPairs]);
  const agreement = useMemo(() => blandAltman(pairs), [pairs]);
  const reu = useMemo(() => relativeExpandedUncertainty(pairs, { k: 2, minSamples: 10 }), [pairs]);

  const finitePairs = useMemo(
    () => pairs.filter((pair) => Number.isFinite(pair.reference) && Number.isFinite(pair.sensor)),
    [pairs],
  );
  const maxValue = useMemo(() => {
    const values = finitePairs.flatMap((pair) => [pair.reference, pair.sensor]);
    return values.length ? Math.ceil(Math.max(...values) * 1.05) : 1;
  }, [finitePairs]);

  const scatterOption = useMemo(() => {
    const density = densityPoints(finitePairs.map((pair) => ({ x: pair.reference, y: pair.sensor })));
    const correctedDensity = densityPoints(correctedPairs.map((pair) => ({ x: pair.reference, y: pair.sensor })));
    return {
      textStyle: { fontFamily: "Inter, sans-serif", color: ct.text },
      tooltip: {
        trigger: "item",
        backgroundColor: ct.tooltipBg,
        borderColor: ct.tooltipBorder,
        textStyle: { color: ct.tooltipText },
      },
      legend: { top: 0, textStyle: { color: ct.text } },
      grid: { top: 42, right: 22, bottom: 42, left: 56 },
      xAxis: {
        type: "value",
        name: `Reference (${dataset.units})`,
        min: 0,
        max: maxValue,
        axisLabel: { color: ct.axis },
        splitLine: { lineStyle: { color: ct.grid } },
      },
      yAxis: {
        type: "value",
        name: `Candidate (${dataset.units})`,
        min: 0,
        max: maxValue,
        axisLabel: { color: ct.axis },
        splitLine: { lineStyle: { color: ct.grid } },
      },
      visualMap: {
        show: false,
        min: 1,
        max: Math.max(1, ...density.map((point) => point.value)),
        inRange: { color: [ct.colors[1], ct.colors[0], ct.colors[2]] },
      },
      series: [
        {
          name: "Observed",
          type: "scatter",
          symbolSize: 5,
          data: density.map((point) => [point.x, point.y, point.value]),
        },
        ...(showCorrected && correctedDensity.length ? [{
          name: "Corrected",
          type: "scatter",
          symbolSize: 4,
          itemStyle: { color: ct.colors[1], opacity: 0.55 },
          data: correctedDensity.map((point) => [point.x, point.y]),
        }] : []),
        {
          name: "1:1",
          type: "line",
          symbol: "none",
          lineStyle: { color: ct.text, width: 1.5 },
          data: [[0, 0], [maxValue, maxValue]],
        },
        {
          name: "OLS",
          type: "line",
          symbol: "none",
          lineStyle: { color: ct.colors[2], width: 2, type: "dashed" },
          data: lineEndpoints(maxValue, fit),
        },
      ],
    };
  }, [correctedPairs, ct, dataset.units, finitePairs, fit, maxValue, showCorrected]);

  const blandAltmanOption = useMemo(() => ({
    textStyle: { fontFamily: "Inter, sans-serif", color: ct.text },
    tooltip: {
      trigger: "item",
      backgroundColor: ct.tooltipBg,
      borderColor: ct.tooltipBorder,
      textStyle: { color: ct.tooltipText },
    },
    grid: { top: 18, right: 18, bottom: 42, left: 58 },
    xAxis: {
      type: "value",
      name: `Average (${dataset.units})`,
      axisLabel: { color: ct.axis },
      splitLine: { lineStyle: { color: ct.grid } },
    },
    yAxis: {
      type: "value",
      name: "Sensor - reference",
      axisLabel: { color: ct.axis },
      splitLine: { lineStyle: { color: ct.grid } },
    },
    series: [
      {
        name: "Agreement",
        type: "scatter",
        symbolSize: 5,
        itemStyle: { color: ct.colors[0], opacity: 0.7 },
        data: agreement.points.map((point) => [point.average, point.difference]),
      },
      ...[
        ["Mean", agreement.meanDifference, ct.colors[1]],
        ["Upper", agreement.upperLimit, ct.colors[2]],
        ["Lower", agreement.lowerLimit, ct.colors[2]],
      ].map(([name, value, color]) => ({
        name,
        type: "line",
        symbol: "none",
        lineStyle: { color, width: 1.5, type: name === "Mean" ? "solid" : "dashed" },
        data: [[0, value], [maxValue, value]],
      })),
    ],
  }), [agreement, ct, dataset.units, maxValue]);

  const reuOption = useMemo(() => ({
    textStyle: { fontFamily: "Inter, sans-serif", color: ct.text },
    tooltip: {
      trigger: "item",
      backgroundColor: ct.tooltipBg,
      borderColor: ct.tooltipBorder,
      textStyle: { color: ct.tooltipText },
    },
    grid: { top: 18, right: 18, bottom: 42, left: 58 },
    xAxis: {
      type: "value",
      name: `Reference (${dataset.units})`,
      axisLabel: { color: ct.axis },
      splitLine: { lineStyle: { color: ct.grid } },
    },
    yAxis: {
      type: "value",
      name: "REU (%)",
      min: 0,
      max: 200,
      axisLabel: { color: ct.axis },
      splitLine: { lineStyle: { color: ct.grid } },
    },
    series: [
      {
        name: "REU",
        type: "scatter",
        symbolSize: 5,
        itemStyle: { color: ct.colors[3], opacity: 0.7 },
        data: reu.points.map((point) => [point.reference, point.reu]),
      },
      ...(dataset.dqObjective ? [{
        name: "DQO",
        type: "line",
        symbol: "none",
        lineStyle: { color: ct.colors[1], width: 2, type: "dashed" },
        data: [[0, dataset.dqObjective], [maxValue, dataset.dqObjective]],
      }] : []),
      ...(dataset.limitValue ? [{
        name: "Limit value",
        type: "line",
        symbol: "none",
        lineStyle: { color: ct.colors[2], width: 2, type: "dashed" },
        data: [[dataset.limitValue, 0], [dataset.limitValue, 200]],
      }] : []),
    ],
  }), [ct, dataset.dqObjective, dataset.limitValue, dataset.units, maxValue, reu.points]);

  const timeSeriesOption = useMemo(() => ({
    textStyle: { fontFamily: "Inter, sans-serif", color: ct.text },
    tooltip: {
      trigger: "axis",
      backgroundColor: ct.tooltipBg,
      borderColor: ct.tooltipBorder,
      textStyle: { color: ct.tooltipText },
    },
    legend: { top: 0, textStyle: { color: ct.text } },
    grid: { top: 42, right: 18, bottom: 42, left: 56 },
    xAxis: {
      type: "category",
      data: finitePairs.map((pair) => String(pair.time ?? pair.reference)),
      axisLabel: { color: ct.axis },
      axisLine: { lineStyle: { color: ct.grid } },
    },
    yAxis: {
      type: "value",
      name: `${dataset.pollutant} (${dataset.units})`,
      axisLabel: { color: ct.axis },
      splitLine: { lineStyle: { color: ct.grid } },
    },
    series: [
      {
        name: "Reference",
        type: "line",
        symbol: "none",
        lineStyle: { color: ct.text, width: 1.5 },
        data: finitePairs.map((pair) => pair.reference),
      },
      {
        name: "Candidate",
        type: "line",
        symbol: "none",
        lineStyle: { color: ct.colors[2], width: 1.2, opacity: 0.75 },
        data: finitePairs.map((pair) => pair.sensor),
      },
    ],
  }), [ct, dataset.pollutant, dataset.units, finitePairs]);

  if (isLoading) return <Loader message="Loading measurement examples..." />;

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow="Measurement Error"
        title="Instrument validation workbench"
        subtitle="Reference-vs-candidate QA for low-cost sensors, regulatory monitors, and corrected calibration runs."
      />

      <div className={styles.stats}>
        <StatCard label="Pairs" value={String(fit.n)} />
        <StatCard label="R2" value={formatMetric(fit.r2, 3)} />
        <StatCard label="RMSE" value={formatMetric(fit.rmse, 2)} />
        <StatCard label="MAE" value={formatMetric(fit.mae, 2)} />
        <StatCard label="Mean bias" value={formatMetric(fit.bias, 2)} tone={Math.abs(fit.bias) < fit.mae ? "good" : "warn"} />
        <StatCard label="Median REU" value={formatMetric([...reu.points].sort((a, b) => a.reu - b.reu)[Math.floor(reu.points.length / 2)]?.reu, 1)} />
      </div>

      <Card title="Configuration">
        <div className={styles.controls}>
          <label className={styles.field}>
            <span>Example dataset</span>
            <select value={datasetId} onChange={(event) => setDatasetId(event.target.value)}>
              {DATASETS.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Reference</span>
            <input value={dataset.reference} readOnly />
          </label>
          <label className={styles.field}>
            <span>Candidate</span>
            <input value={dataset.sensor} readOnly />
          </label>
          <label className={styles.checkbox}>
            <input type="checkbox" checked={showCorrected} onChange={(event) => setShowCorrected(event.target.checked)} />
            <span>
              <strong>Show correction</strong>
              Use shipped corrected examples when available, otherwise apply inverse OLS correction.
            </span>
          </label>
        </div>
      </Card>

      <div className={styles.splitGrid}>
        <Card title={`Scatter: ${formatEquation(fit)}`}>
          <EChart option={scatterOption} height={340} />
        </Card>
        <Card title="Paired time series">
          <EChart option={timeSeriesOption} height={340} zoomable />
        </Card>
      </div>

      <div className={styles.splitGrid}>
        <Card title="Bland-Altman agreement">
          <EChart option={blandAltmanOption} height={320} />
        </Card>
        <Card title="Relative expanded uncertainty">
          <EChart option={reuOption} height={320} />
        </Card>
      </div>

      <Card title="Correction readout">
        <div className={styles.metricGrid}>
          <div className={styles.metricRow}><span>Raw RMSE</span><strong>{formatMetric(fit.rmse, 2)}</strong></div>
          <div className={styles.metricRow}><span>Corrected RMSE</span><strong>{correctedPairs.length ? formatMetric(correctedFit.rmse, 2) : "-"}</strong></div>
          <div className={styles.metricRow}><span>Raw MAE</span><strong>{formatMetric(fit.mae, 2)}</strong></div>
          <div className={styles.metricRow}><span>Corrected MAE</span><strong>{correctedPairs.length ? formatMetric(correctedFit.mae, 2) : "-"}</strong></div>
          <div className={styles.metricRow}><span>Agreement limits</span><strong>{formatMetric(agreement.lowerLimit, 1)} to {formatMetric(agreement.upperLimit, 1)}</strong></div>
          <div className={styles.metricRow}><span>REU regression</span><strong>{formatEquation({ ...fit, slope: reu.slope, intercept: reu.intercept })}</strong></div>
        </div>
      </Card>
    </div>
  );
}
