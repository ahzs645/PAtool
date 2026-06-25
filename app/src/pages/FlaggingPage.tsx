import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  exportFlagConditions,
  flagAsnatSeries,
  type AsnatRow,
  type PatSeries,
} from "@patool/shared";

import { Card, DataTable, PageHeader, StatCard, type Column } from "../components";
import { getJson } from "../lib/api";
import { downloadCsv, suggestFilename } from "../lib/exporters";
import styles from "./ToolsetPage.module.css";

const FLAG_LABELS: Record<number, string> = {
  60: "Negative value",
  65: "Temporal order",
  70: "Sudden spike",
  71: "Sudden drop",
  72: "Daily O3 pattern",
  73: "Daily PM pattern",
  83: "Constant run",
  84: "Missing run",
  85: "Outlier (z-score)",
  86: "Hampel outlier",
  90: "Duplicate ts+location",
  95: "Bad date format",
};

function flagLabel(code: number): string {
  if (code >= 1 && code <= 79) return `User condition ${code}`;
  return FLAG_LABELS[code] ?? `Flag ${code}`;
}

function meanPm(a: number | null, b: number | null): number | null {
  if (a !== null && Number.isFinite(a) && b !== null && Number.isFinite(b)) return (a + b) / 2;
  if (a !== null && Number.isFinite(a)) return a;
  if (b !== null && Number.isFinite(b)) return b;
  return null;
}

function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export default function FlaggingPage() {
  const [sensorId, setSensorId] = useState("1001");
  const [negative, setNegative] = useState(true);
  const [temporalOrder, setTemporalOrder] = useState(false);
  const [dateFormat, setDateFormat] = useState(false);
  const [duplicateLocation, setDuplicateLocation] = useState(false);
  const [constantRun, setConstantRun] = useState(0);
  const [missingRun, setMissingRun] = useState(0);
  const [zScoreK, setZScoreK] = useState(0);
  const [hampelOn, setHampelOn] = useState(false);
  const [spikeOn, setSpikeOn] = useState(false);
  const [spikeThreshold, setSpikeThreshold] = useState(0.5);
  const [dailyPattern, setDailyPattern] = useState(false);
  const [pollutant, setPollutant] = useState<"pm" | "ozone">("pm");
  const [conditionsText, setConditionsText] = useState("value > 35\nhumidity >= 100");

  const { data: series } = useQuery({
    queryKey: ["flagging-series", sensorId],
    queryFn: () => getJson<PatSeries>(`/api/pat?id=${sensorId}&aggregate=raw`),
  });

  const rows = useMemo<AsnatRow[]>(() => {
    if (!series) return [];
    return series.points.map((point) => ({
      timestamp: point.timestamp,
      id: series.meta.sensorId,
      latitude: series.meta.latitude ?? null,
      longitude: series.meta.longitude ?? null,
      value: meanPm(point.pm25A, point.pm25B),
      humidity: point.humidity,
      temperature: point.temperature,
      pm25A: point.pm25A,
      pm25B: point.pm25B,
    }));
  }, [series]);

  const conditions = useMemo(
    () => conditionsText.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#")),
    [conditionsText],
  );

  const { flagged, error } = useMemo(() => {
    if (!rows.length) return { flagged: [], error: null as string | null };
    try {
      const result = flagAsnatSeries(rows, {
        valueField: "value",
        pollutant,
        negative,
        temporalOrder,
        dateFormat,
        duplicateLocation,
        constantRun: constantRun > 0 ? constantRun : null,
        missingRun: missingRun > 0 ? missingRun : null,
        zScore: zScoreK > 0 ? { k: zScoreK } : null,
        hampel: hampelOn ? { window: 5, threshold: 3 } : null,
        spike: spikeOn ? { window: 6, threshold: spikeThreshold } : null,
        dailyPattern,
        userExpressions: conditions,
      });
      return { flagged: result, error: null };
    } catch (err) {
      return { flagged: [], error: err instanceof Error ? err.message : "Invalid flag condition" };
    }
  }, [rows, pollutant, negative, temporalOrder, dateFormat, duplicateLocation, constantRun, missingRun, zScoreK, hampelOn, spikeOn, spikeThreshold, dailyPattern, conditions]);

  const summary = useMemo(() => {
    const counts = new Map<number, number>();
    for (const entry of flagged) for (const code of entry.flags) counts.set(code, (counts.get(code) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([code, count]) => ({ code, count, label: flagLabel(code) }));
  }, [flagged]);

  const flaggedRows = useMemo(
    () => rows.map((row, i) => ({ ...row, code: flagged[i]?.code ?? "0" })).filter((row) => row.code !== "0"),
    [rows, flagged],
  );

  const totalFlagged = flaggedRows.length;
  const flaggedPct = rows.length ? ((totalFlagged / rows.length) * 100).toFixed(1) : "0";

  const summaryColumns: Column<(typeof summary)[number]>[] = [
    { key: "code", header: "Code", width: 80, render: (row) => row.code },
    { key: "label", header: "Condition", render: (row) => row.label },
    { key: "count", header: "Rows flagged", width: 120, render: (row) => row.count },
  ];

  const rowColumns: Column<(typeof flaggedRows)[number]>[] = [
    { key: "timestamp", header: "Timestamp", render: (row) => row.timestamp },
    { key: "value", header: "Value", width: 100, render: (row) => (typeof row.value === "number" ? row.value.toFixed(1) : "—") },
    { key: "humidity", header: "RH", width: 80, render: (row) => (typeof row.humidity === "number" ? row.humidity.toFixed(0) : "—") },
    { key: "code", header: "flagged(-)", width: 120, render: (row) => row.code },
  ];

  function exportFlaggedCsv() {
    const header = "timestamp,id,value,humidity,flagged(-)";
    const body = rows.map((row, i) => [row.timestamp, row.id ?? "", row.value ?? "", row.humidity ?? "", flagged[i]?.code ?? "0"].join(","));
    downloadCsv(suggestFilename("asnat-flagged", "csv"), [header, ...body].join("\n"));
  }

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow="ASNAT flagging tab"
        title="Flag & remove anomalous data with numeric flag codes"
        subtitle="Reproduces the ASNAT flag scheme (Table S2): user Boolean conditions (codes 1-79) plus built-in flags 60/65/70-73/83-86/90/95, a flagged(-) column, and flags.txt export."
      />

      <div className={styles.stats}>
        <StatCard label="Rows" value={`${rows.length}`} />
        <StatCard label="Flagged rows" value={`${totalFlagged}`} tone={totalFlagged > 0 ? "warn" : "good"} />
        <StatCard label="Flagged %" value={`${flaggedPct}%`} />
        <StatCard label="Conditions" value={`${conditions.length}`} />
      </div>

      <Card title="Series">
        <div className={styles.controls}>
          <label className={styles.field}>
            <span>Sensor ID</span>
            <input value={sensorId} onChange={(event) => setSensorId(event.target.value)} />
          </label>
        </div>
      </Card>

      <Card title="Built-in flags">
        <div className={styles.controls}>
          <label className={styles.field}><span>Negative (60)</span><input type="checkbox" checked={negative} onChange={(e) => setNegative(e.target.checked)} /></label>
          <label className={styles.field}><span>Temporal order (65)</span><input type="checkbox" checked={temporalOrder} onChange={(e) => setTemporalOrder(e.target.checked)} /></label>
          <label className={styles.field}><span>Bad date format (95)</span><input type="checkbox" checked={dateFormat} onChange={(e) => setDateFormat(e.target.checked)} /></label>
          <label className={styles.field}><span>Duplicate ts+loc (90)</span><input type="checkbox" checked={duplicateLocation} onChange={(e) => setDuplicateLocation(e.target.checked)} /></label>
          <label className={styles.field}><span>Constant run ≥ (83)</span><input type="number" min={0} value={constantRun} onChange={(e) => setConstantRun(Number(e.target.value))} /></label>
          <label className={styles.field}><span>Missing run ≥ (84)</span><input type="number" min={0} value={missingRun} onChange={(e) => setMissingRun(Number(e.target.value))} /></label>
          <label className={styles.field}><span>Outlier k·SD (85)</span><input type="number" min={0} step={0.5} value={zScoreK} onChange={(e) => setZScoreK(Number(e.target.value))} /></label>
          <label className={styles.field}><span>Hampel (86)</span><input type="checkbox" checked={hampelOn} onChange={(e) => setHampelOn(e.target.checked)} /></label>
          <label className={styles.field}><span>Spike/drop (70/71)</span><input type="checkbox" checked={spikeOn} onChange={(e) => setSpikeOn(e.target.checked)} /></label>
          <label className={styles.field}><span>Spike threshold</span><input type="number" min={0} step={0.1} value={spikeThreshold} onChange={(e) => setSpikeThreshold(Number(e.target.value))} /></label>
          <label className={styles.field}><span>Daily pattern (72/73)</span><input type="checkbox" checked={dailyPattern} onChange={(e) => setDailyPattern(e.target.checked)} /></label>
          <label className={styles.field}>
            <span>Pollutant</span>
            <select value={pollutant} onChange={(e) => setPollutant(e.target.value as "pm" | "ozone")}>
              <option value="pm">PM</option>
              <option value="ozone">Ozone</option>
            </select>
          </label>
        </div>
      </Card>

      <Card title="User Boolean conditions (codes 1-79)">
        <p>One condition per line. Column names are operands; operators: <code>= != &lt; &lt;= &gt; &gt;= and or ( ) + - * / ^</code>. Example: <code>(id = 44275 or id = 99449) and humidity &gt;= 100</code></p>
        <textarea
          value={conditionsText}
          onChange={(event) => setConditionsText(event.target.value)}
          rows={4}
          style={{ width: "100%", fontFamily: "monospace" }}
        />
        {error && <p style={{ color: "var(--color-danger, #d64545)" }}>Condition error: {error}</p>}
        <div className={styles.controls}>
          <button type="button" onClick={exportFlaggedCsv} disabled={!rows.length}>Download flagged CSV</button>
          <button type="button" onClick={() => downloadText(suggestFilename("flags", "txt"), exportFlagConditions(conditions))} disabled={!conditions.length}>Save flags.txt</button>
        </div>
      </Card>

      <Card title="Flag summary">
        <DataTable columns={summaryColumns} data={summary} rowKey={(row) => String(row.code)} pageSize={20} />
      </Card>

      <Card title={`Flagged rows (${totalFlagged})`}>
        <DataTable columns={rowColumns} data={flaggedRows} rowKey={(row) => row.timestamp} pageSize={15} />
      </Card>
    </div>
  );
}
