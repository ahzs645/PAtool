import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  MODEL_ZOO_MODEL_IDS,
  buildModelZooReport,
  type ModelZooReportRow,
  type PasCollection,
  type PasRecord,
} from "@patool/shared";

import { Card, CellStack, Chip, DataTable, Loader, PageHeader, StatCard, type Column } from "../components";
import { getJson } from "../lib/api";
import { buildOutdoorInterpolationPoints, formatMetric, percent, SENSOR_VALUE_FIELDS } from "./toolsetUtils";
import styles from "./ToolsetPage.module.css";

export default function ModelZooPage() {
  const [valueField, setValueField] = useState<keyof PasRecord>("pm25_1hr");
  const [sampleSize, setSampleSize] = useState(50);
  const [includePredictions, setIncludePredictions] = useState(false);

  const { data } = useQuery({
    queryKey: ["model-zoo-pas"],
    queryFn: () => getJson<PasCollection>("/api/pas"),
  });

  const points = useMemo(
    () => buildOutdoorInterpolationPoints(data, valueField, sampleSize),
    [data, sampleSize, valueField],
  );

  const report = useMemo(() => buildModelZooReport(points, {
    includePredictions,
    idwMaxNeighbors: 12,
    krigingMaxNeighbors: 12,
  }), [includePredictions, points]);

  const best = useMemo(() =>
    report.models
      .filter((model) => typeof model.metrics.rmse === "number")
      .sort((a, b) => (a.metrics.rmse ?? Infinity) - (b.metrics.rmse ?? Infinity))[0] ?? null,
  [report]);

  const columns: Column<ModelZooReportRow>[] = [
    {
      key: "model",
      header: "Model",
      width: 280,
      render: (row) => <CellStack primary={row.label} sub={row.modelId} />,
    },
    { key: "n", header: "N", width: 70, render: (row) => String(row.metrics.n) },
    { key: "rmse", header: "RMSE", width: 90, render: (row) => formatMetric(row.metrics.rmse) },
    { key: "mae", header: "MAE", width: 90, render: (row) => formatMetric(row.metrics.mae) },
    { key: "bias", header: "Bias", width: 90, render: (row) => formatMetric(row.metrics.bias) },
    { key: "smape", header: "SMAPE", width: 100, render: (row) => percent(row.metrics.smape, 1) },
    { key: "r2", header: "R2", width: 90, render: (row) => formatMetric(row.metrics.rSquared, 3) },
    {
      key: "status",
      header: "Status",
      width: 110,
      render: (row) => row.metrics.n > 0 ? <Chip variant="success">ready</Chip> : <Chip variant="warning">skipped</Chip>,
    },
  ];

  if (!data) return <Loader message="Loading model zoo data..." />;

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow="Model Zoo"
        title="PM2.5 surface model comparison"
        subtitle="Run a browser-safe model comparison table across spatial mean, IDW, kriging, and lightweight research-inspired approximations."
      />

      <div className={styles.stats}>
        <StatCard label="Models" value={String(MODEL_ZOO_MODEL_IDS.length)} />
        <StatCard label="Points used" value={String(report.pointsUsed)} />
        <StatCard label="Best model" value={best?.modelId ?? "-"} />
        <StatCard label="Best RMSE" value={best ? formatMetric(best.metrics.rmse) : "-"} />
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
            <span>Sample cap</span>
            <input type="number" min={12} max={120} value={sampleSize} onChange={(event) => setSampleSize(Number(event.target.value))} />
          </label>
          <label className={styles.checkbox}>
            <input type="checkbox" checked={includePredictions} onChange={(event) => setIncludePredictions(event.target.checked)} />
            <span><strong>Keep predictions</strong> Include held-out prediction rows inside the in-memory report.</span>
          </label>
        </div>
      </Card>

      <Card title="Model comparison">
        <DataTable columns={columns} data={report.models} rowKey={(row) => row.modelId} emptyMessage="No model results." />
      </Card>

      <div className={styles.splitGrid}>
        <Card title="Run notes">
          <ul className={styles.noteList}>
            {report.notes.map((note) => <li key={note}>{note}</li>)}
            <li>RFSI-lite, STRK-lite, and RFK-lite are deterministic approximations for rapid screening; they do not train random forests.</li>
          </ul>
        </Card>
        <Card title="Model notes">
          <ul className={styles.noteList}>
            {report.models.map((model) => (
              <li key={model.modelId}><strong>{model.modelId}</strong>: {model.notes.join(" ")}</li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
