import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EChartsCoreOption } from "echarts/core";

import {
  runWeatherNormalization,
  type PatSeries,
  type WeatherModelDiagnostics,
} from "@patool/shared";

import { Button, Card, DataTable, EChart, Loader, PageHeader, StatCard, type Column } from "../components";
import { getJson } from "../lib/api";
import { downloadCsv, objectsToCsv, suggestFilename } from "../lib/exporters";
import styles from "./WeatherNormalizationPage.module.css";

const DEFAULT_SENSOR_ID = "1001";

export default function WeatherNormalizationPage() {
  const [sensorId, setSensorId] = useState(DEFAULT_SENSOR_ID);
  const [normalizationSamples, setNormalizationSamples] = useState(30);
  const [trees, setTrees] = useState(50);

  const { data: series, isLoading } = useQuery({
    queryKey: ["weather-normalization-series", sensorId],
    queryFn: () => getJson<PatSeries>(`/api/pat?id=${sensorId}&aggregate=hourly`),
  });

  const result = useMemo(() => {
    if (!series) return null;
    try {
      return {
        ok: true as const,
        value: runWeatherNormalization(series, {
          seed: 29,
          normalizationSamples,
          partialDependenceResolution: 14,
          randomForest: { numTrees: trees },
        }),
      };
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : "Could not run normalization.",
      };
    }
  }, [normalizationSamples, series, trees]);

  const metrics = result?.ok ? result.value.diagnostics.metrics : null;
  const normalized = result?.ok ? result.value.diagnostics.normalized : [];

  const columns: Column<WeatherModelDiagnostics["normalized"][number]>[] = [
    { key: "ts", header: "Timestamp (UTC)", width: 180, render: (row) => row.timestamp.replace("T", " ").slice(0, 16) },
    { key: "observed", header: "Observed", width: 110, render: (row) => row.observed.toFixed(2) },
    { key: "predicted", header: "RF predicted", width: 120, render: (row) => row.predicted.toFixed(2) },
    { key: "normalized", header: "Normalized", width: 120, render: (row) => row.normalized.toFixed(2) },
    { key: "std", header: "Weather spread", width: 130, render: (row) => row.normalizedStd.toFixed(2) },
    { key: "set", header: "Set", width: 100, render: (row) => row.set },
  ];

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow="Weather normalization"
        title="Counterfactual PM2.5 trend lab"
        subtitle="A TypeScript adaptation of rmweather-style modeling: train a random forest, shuffle weather/time covariates, and compare observed, fitted, and meteorologically normalized PM2.5."
      />

      <div className={styles.stats}>
        <StatCard label="Sensor" value={sensorId} />
        <StatCard label="Rows" value={result?.ok ? String(result.value.rows.length) : "--"} />
        <StatCard label="Trees" value={String(trees)} />
        <StatCard label="Weather samples" value={String(normalizationSamples)} />
      </div>

      <Card title="Configuration">
        <div className={styles.controls}>
          <label className={styles.field}>
            <span>Sensor ID</span>
            <input value={sensorId} onChange={(event) => setSensorId(event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>RF trees</span>
            <input
              type="number"
              min={10}
              max={200}
              value={trees}
              onChange={(event) => setTrees(clamp(Number(event.target.value) || 50, 10, 200))}
            />
          </label>
          <label className={styles.field}>
            <span>Normalization samples</span>
            <input
              type="number"
              min={1}
              max={200}
              value={normalizationSamples}
              onChange={(event) => setNormalizationSamples(clamp(Number(event.target.value) || 30, 1, 200))}
            />
          </label>
          <Button
            variant="secondary"
            disabled={!normalized.length}
            onClick={() => {
              downloadCsv(
                suggestFilename(`weather-normalized-${sensorId}`, "csv"),
                objectsToCsv(normalized),
              );
            }}
          >
            Download CSV
          </Button>
        </div>
      </Card>

      {isLoading && <Loader message="Loading sensor history..." />}

      {result && !result.ok && (
        <Card title="Run status">
          <p className={styles.error}>{result.error}</p>
        </Card>
      )}

      {result?.ok && (
        <>
          <Card title="Model diagnostics">
            <div className={styles.metricGrid}>
              <Metric label="RMSE" value={formatMetric(metrics?.rmse)} />
              <Metric label="NRMSE" value={formatPercent(metrics?.normalizedRmse)} />
              <Metric label="Bias" value={formatMetric(metrics?.bias)} />
              <Metric label="Pearson r" value={formatMetric(metrics?.pearsonR)} />
              <Metric label="R2" value={formatMetric(metrics?.rSquared)} />
              <Metric label="IOA" value={formatMetric(metrics?.indexOfAgreement)} />
            </div>
          </Card>

          <div className={styles.chartGrid}>
            <Card title="Observed, fitted, normalized">
              <EChart option={trendOption(result.value.diagnostics)} height={360} zoomable />
            </Card>
            <Card title="Observed vs predicted">
              <EChart option={scatterOption(result.value.diagnostics)} height={360} />
            </Card>
            <Card title="Permutation importance">
              <EChart option={importanceOption(result.value.diagnostics)} height={360} />
            </Card>
            <Card title="Partial dependence">
              <EChart option={partialDependenceOption(result.value.diagnostics)} height={360} />
            </Card>
          </div>

          <Card title="Prepared data audit">
            <p className={styles.muted}>
              Imputed humidity {result.value.imputed.humidity.toFixed(1)}, temperature{" "}
              {result.value.imputed.temperature.toFixed(1)}, pressure {result.value.imputed.pressure.toFixed(1)}.
              Dropped {result.value.dropped.missingPm25} rows without PM2.5 and{" "}
              {result.value.dropped.missingTimestamp} rows without timestamps. The trend feature is kept fixed during
              weather normalization.
            </p>
          </Card>

          <Card title="Normalized rows">
            <DataTable
              columns={columns}
              data={normalized}
              rowKey={(row) => row.timestamp}
              pageSize={24}
              emptyMessage="No normalized rows."
            />
          </Card>
        </>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.metricRow}>
      <span className={styles.metricLabel}>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function trendOption(diagnostics: WeatherModelDiagnostics): EChartsCoreOption {
  const rows = diagnostics.normalized;
  return {
    tooltip: { trigger: "axis" },
    legend: { top: 0 },
    grid: { left: 46, right: 24, top: 42, bottom: 36 },
    xAxis: { type: "time" },
    yAxis: { type: "value", name: "PM2.5" },
    series: [
      {
        name: "Observed",
        type: "line",
        showSymbol: false,
        data: rows.map((row) => [row.timestamp, row.observed]),
      },
      {
        name: "RF predicted",
        type: "line",
        showSymbol: false,
        data: rows.map((row) => [row.timestamp, row.predicted]),
      },
      {
        name: "Normalized",
        type: "line",
        showSymbol: false,
        lineStyle: { width: 3 },
        data: rows.map((row) => [row.timestamp, row.normalized]),
      },
      {
        name: "Normalized + spread",
        type: "line",
        showSymbol: false,
        lineStyle: { type: "dashed", width: 1 },
        data: rows.map((row) => [row.timestamp, row.normalized + row.normalizedStd]),
      },
      {
        name: "Normalized - spread",
        type: "line",
        showSymbol: false,
        lineStyle: { type: "dashed", width: 1 },
        data: rows.map((row) => [row.timestamp, Math.max(0, row.normalized - row.normalizedStd)]),
      },
    ],
  };
}

function scatterOption(diagnostics: WeatherModelDiagnostics): EChartsCoreOption {
  const rows = diagnostics.predictions;
  const values = rows.flatMap((row) => [row.observed, row.predicted]);
  const min = Math.floor(Math.min(...values));
  const max = Math.ceil(Math.max(...values));
  return {
    tooltip: { trigger: "item" },
    grid: { left: 48, right: 24, top: 24, bottom: 44 },
    xAxis: { type: "value", name: "Observed" },
    yAxis: { type: "value", name: "Predicted" },
    series: [
      {
        name: "Prediction",
        type: "scatter",
        symbolSize: 7,
        data: rows.map((row) => [row.observed, row.predicted]),
      },
      {
        name: "1:1",
        type: "line",
        showSymbol: false,
        data: [[min, min], [max, max]],
      },
    ],
  };
}

function importanceOption(diagnostics: WeatherModelDiagnostics): EChartsCoreOption {
  const rows = [...diagnostics.importance].reverse();
  return {
    tooltip: { trigger: "axis" },
    grid: { left: 112, right: 24, top: 18, bottom: 36 },
    xAxis: { type: "value", name: "RMSE lift" },
    yAxis: { type: "category", data: rows.map((row) => row.variable) },
    series: [
      {
        name: "Importance",
        type: "bar",
        data: rows.map((row) => row.importance),
      },
    ],
  };
}

function partialDependenceOption(diagnostics: WeatherModelDiagnostics): EChartsCoreOption {
  const variables = [...new Set(diagnostics.partialDependence.map((row) => row.variable))];
  return {
    tooltip: { trigger: "axis" },
    legend: { top: 0 },
    grid: { left: 48, right: 24, top: 44, bottom: 44 },
    xAxis: { type: "value", name: "Feature value" },
    yAxis: { type: "value", name: "Predicted PM2.5" },
    series: variables.map((variable) => ({
      name: variable,
      type: "line",
      showSymbol: true,
      data: diagnostics.partialDependence
        .filter((row) => row.variable === variable)
        .map((row) => [row.value, row.partialDependency]),
    })),
  };
}

function formatMetric(value: number | null | undefined): string {
  return value === null || value === undefined ? "--" : value.toFixed(3);
}

function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? "--" : `${(value * 100).toFixed(1)}%`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
