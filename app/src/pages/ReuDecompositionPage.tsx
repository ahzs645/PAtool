import { useMemo, useState } from "react";

import {
  gaussianKde2d,
  loadQuantBenchmarkDatasets,
  reuWithDecomposition,
  type QuantBenchmarkDataset,
} from "@patool/shared";

import { Card, DataTable, EChart, PageHeader, StatCard, type Column } from "../components";
import styles from "./ToolsetPage.module.css";

const DATASETS: QuantBenchmarkDataset[] = loadQuantBenchmarkDatasets();

export default function ReuDecompositionPage() {
  const [datasetId, setDatasetId] = useState<string>(DATASETS[0]?.id ?? "");
  const [dqo, setDqo] = useState(25);
  const dataset = useMemo(() => DATASETS.find((d) => d.id === datasetId) ?? DATASETS[0], [datasetId]);
  const reu = useMemo(() => reuWithDecomposition(dataset.rows, { dqoPercent: dqo, k: 2 }), [dataset, dqo]);
  const kde = useMemo(
    () => gaussianKde2d(dataset.rows.map((r) => ({ x: r.reference, y: r.sensor }))),
    [dataset],
  );

  const cols: Column<typeof reu.points[number]>[] = [
    { key: "ref", header: "Reference", render: (r) => r.reference.toFixed(2) },
    { key: "sensor", header: "Sensor", render: (r) => r.sensor.toFixed(2) },
    { key: "reu", header: "REU %", render: (r) => r.reuPercent.toFixed(1) },
    { key: "rand", header: "Random", render: (r) => r.randomComponent.toFixed(1) },
    { key: "ref2", header: "Reference", render: (r) => r.referenceComponent.toFixed(1) },
    { key: "bias", header: "Bias", render: (r) => r.biasComponent.toFixed(1) },
  ];

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow="REU decomposition"
        title="Relative expanded uncertainty with random/reference/bias split"
        subtitle="Ported from quantpy/quantr (Crilley et al.). Each datapoint's REU is decomposed into three additive components, with a DQO line for quick screening."
      />
      <div className={styles.stats}>
        <StatCard label="Dataset" value={dataset.label.split(" — ")[0]} />
        <StatCard label="N" value={String(reu.n)} />
        <StatCard label="DQO" value={`${dqo.toFixed(0)} %`} />
        <StatCard label="Above DQO" value={`${(reu.shareAboveDqo * 100).toFixed(1)} %`} />
      </div>

      <Card title="Configuration">
        <div className={styles.controls}>
          <label className={styles.field}>
            <span>Dataset</span>
            <select value={datasetId} onChange={(event) => setDatasetId(event.target.value)}>
              {DATASETS.map((d) => (
                <option key={d.id} value={d.id}>{d.label}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>DQO threshold (%)</span>
            <input type="number" min={1} max={100} step={1} value={dqo} onChange={(event) => setDqo(Number(event.target.value))} />
          </label>
        </div>
      </Card>

      <Card title="REU vs. reference concentration">
        <EChart
          option={{
            tooltip: {},
            xAxis: { type: "value", name: `Reference (${dataset.units})` },
            yAxis: { type: "value", name: "REU %" },
            series: [
              {
                type: "scatter",
                symbolSize: 8,
                data: reu.points.map((p) => [p.reference, p.reuPercent]),
              },
              {
                type: "line",
                showSymbol: false,
                markLine: { silent: true, data: [{ yAxis: dqo, name: "DQO" }], lineStyle: { color: "#c33", type: "dashed" } },
                data: [],
              },
            ],
          }}
          height={300}
        />
      </Card>

      <Card title="Scatter density (Gaussian KDE)">
        <EChart
          option={{
            tooltip: {},
            xAxis: { type: "value", name: "Reference" },
            yAxis: { type: "value", name: "Sensor" },
            visualMap: { min: 0, max: Math.max(0.001, ...kde.map((p) => p.density)), calculable: true, orient: "horizontal", bottom: 0 },
            series: [{ type: "scatter", symbolSize: 8, data: kde.map((p) => [p.x, p.y, p.density]) }],
          }}
          height={320}
        />
      </Card>

      <Card title="Per-point decomposition">
        <DataTable columns={cols} data={reu.points} rowKey={(r) => `${r.reference}:${r.sensor}`} pageSize={12} />
      </Card>
    </div>
  );
}
