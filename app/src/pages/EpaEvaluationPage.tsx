import { useMemo, useState } from "react";
import {
  bundleToHtml,
  createAnalysisBundle,
  evaluateEpaSensorPerformance,
  IMPORT_PRESETS,
  inferImportMapping,
  objectsToCsvBundleFile,
  QC_PROFILES,
  type EvaluationPollutant,
  type ImportColumnMapping,
  type QcProfileId,
} from "@patool/shared";

import { Button, Card, DataTable, PageHeader, StatCard, type Column } from "../components";
import { downloadCsv, suggestFilename } from "../lib/exporters";
import { readUploadedCsv, rowsToPairs, type UploadedMeasurementFile } from "./measurementError/csv";
import styles from "./ToolsetPage.module.css";

const POLLUTANTS: EvaluationPollutant[] = ["PM2.5", "PM10", "O3", "NO2", "CO", "SO2"];
const DEMO_ROWS = [
  { timestamp: "2026-01-01T00:00:00Z", reference: "6.2", sensor: "7.1" },
  { timestamp: "2026-01-01T01:00:00Z", reference: "8.4", sensor: "9.2" },
  { timestamp: "2026-01-01T02:00:00Z", reference: "10.1", sensor: "11.0" },
  { timestamp: "2026-01-01T03:00:00Z", reference: "18.6", sensor: "20.2" },
  { timestamp: "2026-01-01T04:00:00Z", reference: "25.2", sensor: "26.0" },
  { timestamp: "2026-01-01T05:00:00Z", reference: "32.5", sensor: "35.4" },
  { timestamp: "2026-01-01T06:00:00Z", reference: "41.1", sensor: "45.0" },
  { timestamp: "2026-01-01T07:00:00Z", reference: "37.5", sensor: "39.2" },
  { timestamp: "2026-01-01T08:00:00Z", reference: "21.2", sensor: "20.1" },
  { timestamp: "2026-01-01T09:00:00Z", reference: "12.2", sensor: "11.4" },
  { timestamp: "2026-01-01T10:00:00Z", reference: "9.2", sensor: "9.8" },
  { timestamp: "2026-01-01T11:00:00Z", reference: "7.5", sensor: "7.1" },
  { timestamp: "2026-01-01T12:00:00Z", reference: "5.1", sensor: "5.5" },
  { timestamp: "2026-01-01T13:00:00Z", reference: "4.8", sensor: "5.1" },
  { timestamp: "2026-01-01T14:00:00Z", reference: "6.9", sensor: "7.4" },
  { timestamp: "2026-01-01T15:00:00Z", reference: "8.8", sensor: "9.3" },
  { timestamp: "2026-01-01T16:00:00Z", reference: "11.4", sensor: "12.2" },
  { timestamp: "2026-01-01T17:00:00Z", reference: "14.5", sensor: "15.8" },
  { timestamp: "2026-01-01T18:00:00Z", reference: "17.9", sensor: "18.1" },
  { timestamp: "2026-01-01T19:00:00Z", reference: "20.2", sensor: "21.4" },
  { timestamp: "2026-01-01T20:00:00Z", reference: "23.1", sensor: "24.6" },
  { timestamp: "2026-01-01T21:00:00Z", reference: "26.8", sensor: "28.1" },
  { timestamp: "2026-01-01T22:00:00Z", reference: "30.2", sensor: "32.9" },
  { timestamp: "2026-01-01T23:00:00Z", reference: "28.6", sensor: "29.7" },
];

export default function EpaEvaluationPage() {
  const [uploaded, setUploaded] = useState<UploadedMeasurementFile | null>(null);
  const rows = uploaded?.rows ?? DEMO_ROWS;
  const columns = uploaded?.columns ?? Object.keys(DEMO_ROWS[0]);
  const [presetId, setPresetId] = useState("epa-collocation");
  const [pollutant, setPollutant] = useState<EvaluationPollutant>("PM2.5");
  const [profileId, setProfileId] = useState<QcProfileId>("epa-collocation");
  const [mapping, setMapping] = useState<ImportColumnMapping>(() => inferImportMapping(columns, "epa-collocation"));

  const pairs = useMemo(() => rowsToPairs(rows, {
    time: mapping.timestamp ?? "",
    reference: mapping.referencePollutant ?? mapping.pollutant ?? "",
    sensor: mapping.sensorPollutant ?? "",
  }), [mapping, rows]);
  const result = useMemo(
    () => evaluateEpaSensorPerformance(pairs, { pollutant, profileId }),
    [pairs, pollutant, profileId],
  );

  async function handleUpload(file: File | undefined) {
    if (!file) return;
    const next = await readUploadedCsv(file);
    const nextMapping = inferImportMapping(next.columns, presetId);
    setUploaded(next);
    setMapping(nextMapping);
  }

  function reinfer(nextPresetId: string) {
    setPresetId(nextPresetId);
    setMapping(inferImportMapping(columns, nextPresetId));
  }

  function downloadBundle() {
    const bundle = createAnalysisBundle({
      title: `EPA evaluation - ${pollutant}`,
      source: uploaded?.name ?? "built-in demo",
      provenance: { pollutant, presetId, profileId, mapping, target: result.target },
      files: [
        objectsToCsvBundleFile("cleaned-pairs.csv", result.pairs.map((pair) => ({ time: pair.time ?? "", reference: pair.reference, sensor: pair.sensor }))),
        objectsToCsvBundleFile("qc-flags.csv", result.qc.rows.map((row) => ({ time: String(row.time ?? ""), reference: row.reference, sensor: row.sensor, qcPass: row.qcPass, qcFlags: row.qcFlags.join("|") }))),
        objectsToCsvBundleFile("summary-metrics.csv", [{
          pollutant,
          n: result.fit.n,
          r2: result.fit.r2,
          rmse: result.fit.rmse,
          mae: result.fit.mae,
          bias: result.fit.bias,
          normalizedMeanBias: result.normalizedMeanBias,
          normalizedRmse: result.normalizedRmse,
          medianReu: result.medianReu,
          pass: result.pass,
        }]),
        objectsToCsvBundleFile("aqi-validation.csv", result.aqiValidation),
      ],
    });
    downloadCsv(suggestFilename("epa-evaluation-bundle", "html"), bundleToHtml(bundle));
  }

  const decisionColumns: Column<(typeof result.decisions)[number]>[] = [
    { key: "criterion", header: "Criterion", render: (row) => row.criterion },
    { key: "value", header: "Value", render: (row) => row.value === null ? "--" : row.value.toFixed(3) },
    { key: "threshold", header: "Threshold", render: (row) => `${row.threshold}${row.units ?? ""}` },
    { key: "pass", header: "Result", render: (row) => row.pass ? "Pass" : "Review" },
  ];

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow="EPA Evaluation"
        title="Sensor performance wizard"
        subtitle="Map uploaded columns, apply named QA/QC profiles, compute EPA-style validation metrics, review AQI-bin errors, and export a provenance bundle."
      />

      <div className={styles.stats}>
        <StatCard label="Valid pairs" value={String(result.fit.n)} />
        <StatCard label="R2" value={format(result.fit.r2)} tone={result.fit.r2 >= (result.target.minR2 ?? 0) ? "good" : "warn"} />
        <StatCard label="NRMSE" value={format(result.normalizedRmse)} />
        <StatCard label="Median REU" value={format(result.medianReu)} />
        <StatCard label="QC pass" value={`${result.qc.passed}/${result.qc.total}`} />
        <StatCard label="Decision" value={result.pass ? "Pass" : "Review"} tone={result.pass ? "good" : "warn"} />
      </div>

      <Card title="Import mapping">
        <div className={styles.controls}>
          <label className={styles.field}>
            <span>Upload CSV</span>
            <input type="file" accept=".csv,text/csv" onChange={(event) => void handleUpload(event.target.files?.[0])} />
          </label>
          <label className={styles.field}>
            <span>Preset</span>
            <select value={presetId} onChange={(event) => reinfer(event.target.value)}>
              {IMPORT_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
            </select>
          </label>
          <label className={styles.field}>
            <span>Pollutant</span>
            <select value={pollutant} onChange={(event) => setPollutant(event.target.value as EvaluationPollutant)}>
              {POLLUTANTS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className={styles.field}>
            <span>QA/QC profile</span>
            <select value={profileId} onChange={(event) => setProfileId(event.target.value as QcProfileId)}>
              {QC_PROFILES.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
            </select>
          </label>
        </div>
        <div className={styles.controls}>
          <ColumnSelect label="Timestamp" columns={columns} value={mapping.timestamp} onChange={(value) => setMapping((current) => ({ ...current, timestamp: value }))} />
          <ColumnSelect label="Reference" columns={columns} value={mapping.referencePollutant} onChange={(value) => setMapping((current) => ({ ...current, referencePollutant: value }))} />
          <ColumnSelect label="Candidate" columns={columns} value={mapping.sensorPollutant} onChange={(value) => setMapping((current) => ({ ...current, sensorPollutant: value }))} />
          <Button variant="secondary" onClick={downloadBundle}>Export bundle HTML</Button>
        </div>
      </Card>

      <Card title="EPA target decision">
        <DataTable columns={decisionColumns} data={result.decisions} rowKey={(row) => row.criterion} pageSize={8} />
      </Card>

      <Card title="QA/QC profile results">
        <div className={styles.metricGrid}>
          {result.qc.byRule.length ? result.qc.byRule.map((row) => (
            <div className={styles.metricRow} key={row.rule}>
              <span className={styles.metricLabel}>{row.rule}</span>
              <strong>{row.count}</strong>
            </div>
          )) : <p className={styles.muted}>No QA flags were raised.</p>}
        </div>
      </Card>

      <Card title="AQI-binned validation">
        <DataTable
          columns={[
            { key: "category", header: "AQI category", render: (row) => row.category },
            { key: "count", header: "Count", render: (row) => row.count },
            { key: "bias", header: "Bias", render: (row) => row.meanBias.toFixed(2) },
            { key: "nrmse", header: "NRMSE", render: (row) => format(row.normalizedRmse) },
            { key: "agreement", header: "Agreement", render: (row) => `${(row.categoryAgreement * 100).toFixed(1)}%` },
            { key: "falseHigh", header: "False high", render: (row) => row.falseHigh },
            { key: "falseLow", header: "False low", render: (row) => row.falseLow },
          ]}
          data={result.aqiValidation}
          rowKey={(row) => row.category}
          emptyMessage="AQI-binned validation is currently available for PM2.5."
        />
      </Card>
    </div>
  );
}

function ColumnSelect({ label, columns, value, onChange }: { label: string; columns: string[]; value?: string; onChange: (value: string) => void }) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <select value={value ?? ""} onChange={(event) => onChange(event.target.value)}>
        <option value="">Unmapped</option>
        {columns.map((column) => <option key={column} value={column}>{column}</option>)}
      </select>
    </label>
  );
}

function format(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(3) : "--";
}
