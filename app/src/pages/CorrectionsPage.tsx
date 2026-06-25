import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  developCorrection,
  exportCorrection,
  type CorrectionForm,
  type CorrectionInputRow,
  type CorrectionOrder,
  type PatSeries,
} from "@patool/shared";

import { Card, DataTable, EChart, PageHeader, StatCard, type Column } from "../components";
import { getJson } from "../lib/api";
import { downloadJson, suggestFilename } from "../lib/exporters";
import styles from "./ToolsetPage.module.css";

type ComparisonPair = { timestamp: string; referencePm25: number | null; sensorPm25Mean: number | null };
type ComparisonResponse = { pairs?: ComparisonPair[] };

export default function CorrectionsPage() {
  const [sensorId, setSensorId] = useState("1001");
  const [source, setSource] = useState<"airnow" | "aqs" | "openaq">("airnow");
  const [form, setForm] = useState<CorrectionForm>("single");
  const [order, setOrder] = useState<CorrectionOrder>("linear");
  const [useThirdVariable, setUseThirdVariable] = useState(true);

  const { data: series } = useQuery({
    queryKey: ["corrections-series", sensorId],
    queryFn: () => getJson<PatSeries>(`/api/pat?id=${sensorId}&aggregate=raw`),
  });

  const comparePath = useMemo(() => {
    if (!series || series.points.length === 0) return null;
    const params = new URLSearchParams({
      sensorId: series.meta.sensorId,
      latitude: String(series.meta.latitude ?? ""),
      longitude: String(series.meta.longitude ?? ""),
      start: series.points[0].timestamp,
      end: series.points[series.points.length - 1].timestamp,
      source,
    });
    return `/api/reference/compare?${params.toString()}`;
  }, [series, source]);

  const { data: comparison } = useQuery({
    queryKey: ["corrections-comparison", comparePath],
    enabled: comparePath !== null,
    queryFn: () => getJson<ComparisonResponse>(comparePath!),
  });

  const humidityByTimestamp = useMemo(() => {
    const map = new Map<string, number>();
    for (const point of series?.points ?? []) {
      if (typeof point.humidity === "number" && Number.isFinite(point.humidity)) map.set(point.timestamp, point.humidity);
    }
    return map;
  }, [series]);

  const rows = useMemo<CorrectionInputRow[]>(() => {
    return (comparison?.pairs ?? [])
      .filter((pair) => typeof pair.referencePm25 === "number" && typeof pair.sensorPm25Mean === "number")
      .map((pair) => ({
        x: pair.sensorPm25Mean,
        y: pair.referencePm25,
        z: humidityByTimestamp.get(pair.timestamp) ?? null,
      }));
  }, [comparison, humidityByTimestamp]);

  const result = useMemo(() => developCorrection(rows, { form, order, useThirdVariable }), [rows, form, order, useThirdVariable]);

  const scatterOption = useMemo(() => {
    if (!rows.length) return null;
    const points = rows.map((row) => [row.x as number, row.y as number]);
    const meanZ = result.usedThirdVariable
      ? rows.reduce((sum, row) => sum + (typeof row.z === "number" ? row.z : 0), 0) / rows.length
      : 0;
    const xs = rows.map((row) => row.x as number);
    const min = Math.min(...xs);
    const max = Math.max(...xs);
    const line: Array<[number, number]> = [];
    if (result.canComputeR2) {
      for (let i = 0; i <= 40; i += 1) {
        const x = min + ((max - min) * i) / 40;
        line.push([x, result.predict(x, meanZ)]);
      }
    }
    return {
      tooltip: {},
      xAxis: { type: "value", name: "Sensor PM2.5" },
      yAxis: { type: "value", name: "Reference PM2.5" },
      series: [
        { type: "scatter", symbolSize: 5, data: points },
        { type: "line", data: line, showSymbol: false, lineStyle: { width: 2 } },
      ],
    };
  }, [rows, result]);

  const gateColumns: Column<(typeof result.gates)[number]>[] = [
    { key: "id", header: "Gate", render: (row) => row.id },
    { key: "pass", header: "Status", width: 90, render: (row) => (row.pass ? "pass" : "fail") },
    { key: "detail", header: "Detail", render: (row) => row.detail },
  ];

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow="ASNAT corrections tab"
        title="Develop sensor corrections (single / additive / interactive)"
        subtitle="Fits y ~ f(sensor [, RH]) in linear / quadratic / cubic forms with the paper's completeness and minimum-sample gates, then exports the correction."
      />

      <div className={styles.stats}>
        <StatCard label="Rows used" value={`${result.n}`} />
        <StatCard label="R²" value={Number.isFinite(result.r2) ? result.r2.toFixed(3) : "—"} tone={result.r2 >= 0.7 ? "good" : "neutral"} />
        <StatCard label="RMSE" value={Number.isFinite(result.rmse) ? result.rmse.toFixed(2) : "—"} />
        <StatCard label="NMBE" value={Number.isFinite(result.nmbe) ? `${(result.nmbe * 100).toFixed(1)}%` : "—"} />
      </div>

      <Card title="Correction configuration">
        <div className={styles.controls}>
          <label className={styles.field}>
            <span>Sensor ID</span>
            <input value={sensorId} onChange={(event) => setSensorId(event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Reference</span>
            <select value={source} onChange={(event) => setSource(event.target.value as typeof source)}>
              <option value="airnow">AirNow</option>
              <option value="aqs">AQS</option>
              <option value="openaq">OpenAQ</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Form</span>
            <select value={form} onChange={(event) => setForm(event.target.value as CorrectionForm)}>
              <option value="single">Single-variable</option>
              <option value="additive">Multivariable additive</option>
              <option value="interactive">Multivariable interactive</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Order</span>
            <select value={order} onChange={(event) => setOrder(event.target.value as CorrectionOrder)}>
              <option value="linear">Linear</option>
              <option value="quadratic">Quadratic</option>
              <option value="cubic">Cubic</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Use RH (3rd var)</span>
            <input type="checkbox" checked={useThirdVariable} onChange={(event) => setUseThirdVariable(event.target.checked)} />
          </label>
        </div>
        <p>
          Fitted model: <code>{result.equation}</code>
          {result.form !== form && " (fell back to single-variable: 3rd variable below 50% completeness)"}
        </p>
        <div className={styles.controls}>
          <button
            type="button"
            disabled={!result.canGenerateCoefficients}
            onClick={() => downloadJson(suggestFilename("asnat-correction", "json"), JSON.parse(exportCorrection(result, { sensorId, source })))}
          >
            Export correction
          </button>
          {!result.canGenerateCoefficients && <span>Not enough rows to export coefficients (see gates).</span>}
        </div>
      </Card>

      <Card title="Correction completeness gates">
        <DataTable columns={gateColumns} data={result.gates} rowKey={(row) => row.id} pageSize={10} />
      </Card>

      {scatterOption && (
        <Card title="Sensor vs reference (with fitted correction)">
          <EChart option={scatterOption} height={320} />
        </Card>
      )}
    </div>
  );
}
