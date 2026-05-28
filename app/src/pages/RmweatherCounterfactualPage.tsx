import { useMemo, useState } from "react";

import {
  loadLondonFixture,
  meteorologicalYearDecomposition,
  partialDependenceTrainingOnly,
  strucchangeBreakpoints,
} from "@patool/shared";

import { Card, DataTable, EChart, PageHeader, StatCard, type Column } from "../components";
import styles from "./ToolsetPage.module.css";

const LONDON = loadLondonFixture();

export default function RmweatherCounterfactualPage() {
  const [referenceYear, setReferenceYear] = useState(2019);
  const series = useMemo(() => LONDON.map((r) => ({
    timestamp: `${r.date}T00:00:00Z`,
    observed: r.no2,
    meteorology: { ws: r.ws, wd: r.wd, air_temp: r.air_temp, rh: r.rh },
  })), []);

  const predict = (m: Record<string, number>) =>
    18 + 0.4 * (m.air_temp ?? 10) - 1.1 * (m.ws ?? 3) + 0.05 * (m.rh ?? 60);

  const decomposition = useMemo(
    () => meteorologicalYearDecomposition(series, { referenceYear, predict }),
    [series, referenceYear],
  );

  const breakpoints = useMemo(
    () => strucchangeBreakpoints(series.map((p) => p.observed), { maxBreakpoints: 3, minSegmentSize: 4 }),
    [series],
  );

  const pd = useMemo(() => partialDependenceTrainingOnly({
    variable: "air_temp",
    trainingValues: series.map((p) => p.meteorology.air_temp),
    predict: (v) => predict({ air_temp: v, ws: 4, rh: 65 }),
  }), [series]);

  const cols: Column<typeof breakpoints[number]>[] = [
    { key: "i", header: "Index", render: (r) => r.index },
    { key: "left", header: "Left mean", render: (r) => r.splitMean.left.toFixed(2) },
    { key: "right", header: "Right mean", render: (r) => r.splitMean.right.toFixed(2) },
    { key: "imp", header: "RSS improvement", render: (r) => r.improvement.toFixed(2) },
  ];

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow="rmweather extensions"
        title="Meteorological-year counterfactual + breakpoints"
        subtitle="Predict the alternate timeline 'what if every year had the reference year's meteorology?', plus binary-segmentation breakpoint detection on the observed series."
      />
      <div className={styles.stats}>
        <StatCard label="Series" value={String(series.length)} />
        <StatCard label="Reference year" value={String(referenceYear)} />
        <StatCard label="Breakpoints" value={String(breakpoints.length)} />
        <StatCard label="PD points" value={String(pd.length)} />
      </div>

      <Card title="Configuration">
        <div className={styles.controls}>
          <label className={styles.field}>
            <span>Reference year</span>
            <input type="number" min={2014} max={2019} value={referenceYear} onChange={(event) => setReferenceYear(Number(event.target.value))} />
          </label>
        </div>
      </Card>

      <Card title="Observed vs counterfactual (rmw_predict_nested_sets_by_year)">
        <EChart
          option={{
            tooltip: { trigger: "axis" },
            xAxis: { type: "category", data: decomposition.map((d) => d.timestamp.slice(0, 10)) },
            yAxis: { type: "value", name: "NO₂ (µg/m³)" },
            series: [
              { name: "Observed", type: "line", data: decomposition.map((d) => d.observed) },
              { name: "Counterfactual", type: "line", data: decomposition.map((d) => Number(d.counterfactual.toFixed(2))) },
              { name: "Reference predict", type: "line", lineStyle: { type: "dashed" }, data: decomposition.map((d) => Number(d.reference.toFixed(2))) },
            ],
          }}
          height={320}
        />
      </Card>

      <Card title="Partial dependence (training-only envelope)">
        <EChart
          option={{
            tooltip: {},
            xAxis: { type: "value", name: "air_temp °C" },
            yAxis: { type: "value", name: "Partial NO₂" },
            series: [{ type: "line", showSymbol: false, data: pd.map((p) => [p.value, p.partialDependency]) }],
          }}
          height={280}
        />
      </Card>

      <Card title="Breakpoints (binary segmentation)">
        <DataTable columns={cols} data={breakpoints} rowKey={(r) => String(r.index)} pageSize={6} />
      </Card>
    </div>
  );
}
