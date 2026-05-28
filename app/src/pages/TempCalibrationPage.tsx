import { useMemo, useState } from "react";

import { fitTempCalibration, type TempCalibrationOrder } from "@patool/shared";

import { Card, EChart, PageHeader, StatCard } from "../components";
import styles from "./ToolsetPage.module.css";

function buildRows(n = 220) {
  const rows: { sensor: number; temperature: number; reference: number }[] = [];
  for (let i = 0; i < n; i += 1) {
    const sensor = 5 + (i % 50) * 1.1;
    const temperature = 5 + (i / n) * 30;
    const ref = 1.2 + 0.85 * sensor - 0.08 * temperature + 0.004 * sensor * temperature
      + ((i * 9301 + 49297) % 233280) / 233280 - 0.5;
    rows.push({ sensor, temperature, reference: ref });
  }
  return rows;
}

export default function TempCalibrationPage() {
  const [order, setOrder] = useState<TempCalibrationOrder>("linear");
  const rows = useMemo(() => buildRows(), []);
  const fit = useMemo(() => fitTempCalibration(rows, order), [rows, order]);
  const predicted = useMemo(
    () => rows.map((r) => ({ ref: r.reference, pred: fit.predict(r.sensor, r.temperature) })),
    [rows, fit],
  );

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow="ASNAT calibration"
        title="Temperature-corrected sensor calibration"
        subtitle="Dual-variable polynomial calibration that includes temperature as a covariate. Linear, quadratic, and cubic orders supported."
      />
      <div className={styles.stats}>
        <StatCard label="N" value={String(rows.length)} />
        <StatCard label="R²" value={fit.r2.toFixed(3)} />
        <StatCard label="RMSE" value={fit.rmse.toFixed(3)} />
        <StatCard label="Features" value={String(fit.coefficients.length)} />
      </div>

      <Card title="Configuration">
        <div className={styles.controls}>
          <label className={styles.field}>
            <span>Polynomial order</span>
            <select value={order} onChange={(event) => setOrder(event.target.value as TempCalibrationOrder)}>
              <option value="linear">Linear</option>
              <option value="quadratic">Quadratic</option>
              <option value="cubic">Cubic</option>
            </select>
          </label>
        </div>
      </Card>

      <Card title="Reference vs. calibrated prediction">
        <EChart
          option={{
            tooltip: {},
            xAxis: { type: "value", name: "Reference" },
            yAxis: { type: "value", name: "Calibrated" },
            series: [
              { type: "scatter", symbolSize: 6, data: predicted.map((p) => [p.ref, p.pred]) },
              {
                type: "line",
                showSymbol: false,
                data: [
                  [Math.min(...predicted.map((p) => p.ref)), Math.min(...predicted.map((p) => p.ref))],
                  [Math.max(...predicted.map((p) => p.ref)), Math.max(...predicted.map((p) => p.ref))],
                ],
                lineStyle: { color: "#888", type: "dashed" },
              },
            ],
          }}
          height={340}
        />
      </Card>

      <Card title="Coefficients">
        <table className={styles.coefTable}>
          <thead>
            <tr>
              <th>Feature</th>
              <th>Coefficient</th>
            </tr>
          </thead>
          <tbody>
            {fit.featureNames.map((name, i) => (
              <tr key={name}>
                <td>{name}</td>
                <td>{fit.coefficients[i].toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
