import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  leaveLocationOutCrossValidate,
  moransI,
  predictionIntervalCoverage,
  residualSemivariogram,
  spatialBlockCrossValidate,
  type InterpolationMethod,
  type PasCollection,
  type PasRecord,
  type ValidationCvResult,
} from "@patool/shared";

import { Card, CellStack, Chip, DataTable, Loader, PageHeader, StatCard, type Column } from "../components";
import { EChart } from "../components/EChart";
import { useChartTheme } from "../hooks/useChartTheme";
import { getJson } from "../lib/api";
import { buildOutdoorInterpolationPoints, formatMetric, percent, SENSOR_VALUE_FIELDS } from "./toolsetUtils";
import styles from "./ToolsetPage.module.css";

type ResultRow = {
  id: string;
  label: string;
  result: ValidationCvResult;
};

function methodLabel(method: InterpolationMethod): string {
  return method === "kriging" ? "Ordinary kriging" : "IDW";
}

export default function ValidationLabPage() {
  const ct = useChartTheme();
  const [valueField, setValueField] = useState<keyof PasRecord>("pm25_1hr");
  const [method, setMethod] = useState<InterpolationMethod>("idw");
  const [sampleSize, setSampleSize] = useState(60);
  const [blockSize, setBlockSize] = useState(0.4);

  const { data } = useQuery({
    queryKey: ["validation-lab-pas"],
    queryFn: () => getJson<PasCollection>("/api/pas"),
  });

  const points = useMemo(
    () => buildOutdoorInterpolationPoints(data, valueField, sampleSize),
    [data, sampleSize, valueField],
  );

  const results = useMemo<ResultRow[]>(() => {
    if (points.length < 3) return [];
    const options = {
      method,
      idw: { power: 2, maxNeighbors: 12 },
      kriging: { maxNeighbors: 12 },
    };
    return [
      {
        id: "location",
        label: "Leave-location-out",
        result: leaveLocationOutCrossValidate(points, options),
      },
      {
        id: "block",
        label: "Spatial block",
        result: spatialBlockCrossValidate(points, {
          ...options,
          cellSizeLon: blockSize,
          cellSizeLat: blockSize,
        }),
      },
    ];
  }, [blockSize, method, points]);

  const primary = results[0]?.result;
  const residualPoints = useMemo(
    () => primary?.predictions.map((prediction) => ({
      id: prediction.id,
      x: prediction.x,
      y: prediction.y,
      residual: prediction.residual,
    })) ?? [],
    [primary],
  );
  const moran = useMemo(() => moransI(residualPoints, { kNearest: 6 }), [residualPoints]);
  const semivariogram = useMemo(() => residualSemivariogram(residualPoints, { binCount: 8 }), [residualPoints]);
  const coverage = useMemo(() => {
    if (!primary || primary.rmse === 0) return predictionIntervalCoverage([]);
    const width = 1.96 * primary.rmse;
    return predictionIntervalCoverage(primary.predictions.map((prediction) => ({
      observed: prediction.observed,
      lower: prediction.predicted - width,
      upper: prediction.predicted + width,
    })));
  }, [primary]);

  const chartOption = useMemo(() => ({
    textStyle: { fontFamily: "Inter, sans-serif", color: ct.text },
    tooltip: {
      trigger: "axis" as const,
      backgroundColor: ct.tooltipBg,
      borderColor: ct.tooltipBorder,
      textStyle: { color: ct.tooltipText },
    },
    grid: { top: 16, right: 16, bottom: 34, left: 54 },
    xAxis: {
      type: "category" as const,
      data: semivariogram.map((bin) => bin.midpoint.toFixed(2)),
      name: "Lag",
      axisLabel: { color: ct.axis },
      axisLine: { lineStyle: { color: ct.grid } },
    },
    yAxis: {
      type: "value" as const,
      name: "Semivariance",
      axisLabel: { color: ct.axis },
      splitLine: { lineStyle: { color: ct.grid } },
    },
    series: [{
      name: "Residual semivariance",
      type: "bar" as const,
      data: semivariogram.map((bin) => Number(bin.semivariance.toFixed(4))),
      itemStyle: { color: ct.colors[0] },
    }],
  }), [ct, semivariogram]);

  const columns: Column<ResultRow>[] = [
    {
      key: "method",
      header: "Validation",
      width: 190,
      render: (row) => <CellStack primary={row.label} sub={`${methodLabel(row.result.method)} - ${row.result.folds} folds`} />,
    },
    { key: "n", header: "N", width: 70, render: (row) => String(row.result.n) },
    { key: "rmse", header: "RMSE", width: 90, render: (row) => formatMetric(row.result.rmse) },
    { key: "mae", header: "MAE", width: 90, render: (row) => formatMetric(row.result.mae) },
    { key: "bias", header: "Bias", width: 90, render: (row) => formatMetric(row.result.bias) },
    { key: "smape", header: "SMAPE", width: 100, render: (row) => percent(row.result.smape, 1) },
  ];

  if (!data) return <Loader message="Loading validation data..." />;

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow="Validation Lab"
        title="Cross-validation and residual diagnostics"
        subtitle="Compare PM2.5 surface accuracy with location-held-out folds, spatial blocks, residual autocorrelation, and interval coverage."
      />

      <div className={styles.stats}>
        <StatCard label="Sensors evaluated" value={String(points.length)} />
        <StatCard label="LLOCV RMSE" value={primary ? formatMetric(primary.rmse) : "-"} />
        <StatCard label="Moran I" value={formatMetric(moran.i, 3)} />
        <StatCard label="95% coverage" value={coverage.n ? percent(coverage.coverage, 0) : "-"} />
      </div>

      <Card title="Configuration">
        <div className={styles.controls}>
          <label className={styles.field}>
            <span>Sensor field</span>
            <select value={String(valueField)} onChange={(event) => setValueField(event.target.value as keyof PasRecord)}>
              {SENSOR_VALUE_FIELDS.map((field) => (
                <option key={String(field.value)} value={String(field.value)}>{field.label}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Method</span>
            <select value={method} onChange={(event) => setMethod(event.target.value as InterpolationMethod)}>
              <option value="idw">IDW</option>
              <option value="kriging">Ordinary kriging</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Sample cap</span>
            <input type="number" min={12} max={160} value={sampleSize} onChange={(event) => setSampleSize(Number(event.target.value))} />
          </label>
          <label className={styles.field}>
            <span>Block size (deg)</span>
            <input type="number" min={0.05} step={0.05} value={blockSize} onChange={(event) => setBlockSize(Number(event.target.value))} />
          </label>
        </div>
      </Card>

      <Card title="Validation results">
        <DataTable columns={columns} data={results} rowKey={(row) => row.id} emptyMessage="Not enough sensor points for validation." />
      </Card>

      <div className={styles.splitGrid}>
        <Card title="Residual semivariogram">
          {semivariogram.length ? <EChart option={chartOption} height={280} /> : <p className={styles.muted}>No residual pairs available.</p>}
        </Card>
        <Card title="Residual checks">
          <div className={styles.metricGrid}>
            <div className={styles.metricRow}><span>Residual rows</span><strong>{residualPoints.length}</strong></div>
            <div className={styles.metricRow}><span>Moran weight sum</span><strong>{formatMetric(moran.weightSum, 2)}</strong></div>
            <div className={styles.metricRow}><span>Interval mean width</span><strong>{formatMetric(coverage.meanWidth, 2)}</strong></div>
            <div className={styles.metricRow}><span>Outside interval</span><strong>{coverage.below + coverage.above}</strong></div>
          </div>
          <ul className={styles.noteList}>
            <li><Chip>SMAPE</Chip> Error is reported as a symmetric percent-like score.</li>
            <li><Chip variant="accent">Blocks</Chip> Spatial blocks are simple lon/lat grid cells for quick browser checks.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
