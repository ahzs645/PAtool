import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Button, Card, Loader, PageHeader, StatCard } from "../components";
import { EChart } from "../components/EChart";
import { useChartTheme } from "../hooks/useChartTheme";
import { downloadCsv, objectsToCsv, suggestFilename } from "../lib/exporters";
import { formatMetric } from "./toolsetUtils";
import {
  buildBlandAltmanOption,
  buildReuOption,
  buildScatterOption,
  buildTimeSeriesOption,
  formatEquation,
} from "./measurementError/chartOptions";
import { inferMeasurementColumns, loadCsv, readUploadedCsv, rowsToPairs, type UploadedMeasurementFile } from "./measurementError/csv";
import { MEASUREMENT_ERROR_EXAMPLES } from "./measurementError/examples";
import { analyzeMeasurements } from "./measurementError/summary";
import styles from "./ToolsetPage.module.css";

const DEFAULT_EXAMPLE = "pm25-transfer";

export default function MeasurementErrorPage() {
  const chartTheme = useChartTheme();
  const [datasetId, setDatasetId] = useState(DEFAULT_EXAMPLE);
  const [uploaded, setUploaded] = useState<UploadedMeasurementFile | null>(null);
  const [customColumns, setCustomColumns] = useState({ time: "", reference: "", sensor: "" });
  const [customPollutant, setCustomPollutant] = useState("Custom");
  const [customUnits, setCustomUnits] = useState("units");
  const [showCorrected, setShowCorrected] = useState(true);

  const example = MEASUREMENT_ERROR_EXAMPLES.find((item) => item.id === datasetId) ?? MEASUREMENT_ERROR_EXAMPLES[0];
  const activeCustom = uploaded !== null;

  const { data: rawRows, isLoading } = useQuery({
    queryKey: ["measurement-error-csv", example.path],
    queryFn: () => loadCsv(example.path),
    enabled: !activeCustom,
  });
  const { data: correctedRows } = useQuery({
    queryKey: ["measurement-error-csv", example.corrected?.path],
    queryFn: () => example.corrected ? loadCsv(example.corrected.path) : Promise.resolve([]),
    enabled: !activeCustom && Boolean(example.corrected),
  });

  const pairs = useMemo(() => {
    if (uploaded) return rowsToPairs(uploaded.rows, customColumns);
    return rowsToPairs(rawRows ?? [], example);
  }, [customColumns, example, rawRows, uploaded]);

  const shippedCorrectedPairs = useMemo(() => {
    if (uploaded || !example.corrected || !correctedRows) return [];
    return rowsToPairs(correctedRows, example.corrected);
  }, [correctedRows, example.corrected, uploaded]);

  const analysis = useMemo(
    () => analyzeMeasurements(pairs, showCorrected ? shippedCorrectedPairs : [], showCorrected),
    [pairs, shippedCorrectedPairs, showCorrected],
  );

  const pollutant = uploaded ? customPollutant : example.pollutant;
  const units = uploaded ? customUnits : example.units;
  const chartContext = {
    theme: chartTheme,
    pollutant,
    units,
    maxValue: analysis.maxValue,
  };

  const scatterOption = useMemo(
    () => buildScatterOption(analysis.finitePairs, showCorrected ? analysis.correctedPairs : [], analysis.fit, chartContext),
    [analysis.correctedPairs, analysis.finitePairs, analysis.fit, chartContext, showCorrected],
  );
  const timeSeriesOption = useMemo(
    () => buildTimeSeriesOption(analysis.finitePairs, chartContext),
    [analysis.finitePairs, chartContext],
  );
  const blandAltmanOption = useMemo(
    () => buildBlandAltmanOption(analysis.agreement, chartContext),
    [analysis.agreement, chartContext],
  );
  const reuOption = useMemo(
    () => buildReuOption(analysis.reu, {
      ...chartContext,
      dqObjective: uploaded ? undefined : example.dqObjective,
      limitValue: uploaded ? undefined : example.limitValue,
    }),
    [analysis.reu, chartContext, example.dqObjective, example.limitValue, uploaded],
  );

  async function handleUpload(file: File | undefined) {
    if (!file) return;
    const next = await readUploadedCsv(file);
    const inferred = inferMeasurementColumns(next.columns);
    setUploaded(next);
    setCustomColumns(inferred);
    setCustomPollutant(file.name.replace(/\.[^.]+$/, "") || "Custom");
  }

  if (isLoading && !uploaded) return <Loader message="Loading measurement examples..." />;

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow="Measurement Error"
        title="Instrument validation workbench"
        subtitle="Reference-vs-candidate QA for low-cost sensors, regulatory monitors, uploaded CSVs, and corrected calibration runs."
      />

      <div className={styles.stats}>
        <StatCard label="Pairs" value={String(analysis.fit.n)} />
        <StatCard label="R2" value={formatMetric(analysis.fit.r2, 3)} />
        <StatCard label="RMSE" value={formatMetric(analysis.fit.rmse, 2)} />
        <StatCard label="MAE" value={formatMetric(analysis.fit.mae, 2)} />
        <StatCard label="Mean bias" value={formatMetric(analysis.fit.bias, 2)} tone={Math.abs(analysis.fit.bias) < analysis.fit.mae ? "good" : "warn"} />
        <StatCard label="Median REU" value={formatMetric(analysis.medianReu, 1)} />
      </div>

      <Card title="Data source">
        <div className={styles.controls}>
          <label className={styles.field}>
            <span>Example dataset</span>
            <select
              value={datasetId}
              disabled={activeCustom}
              onChange={(event) => setDatasetId(event.target.value)}
            >
              {MEASUREMENT_ERROR_EXAMPLES.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Upload CSV</span>
            <input type="file" accept=".csv,text/csv" onChange={(event) => void handleUpload(event.target.files?.[0])} />
          </label>
          <label className={styles.field}>
            <span>Pollutant</span>
            <input value={pollutant} onChange={(event) => setCustomPollutant(event.target.value)} readOnly={!activeCustom} />
          </label>
          <label className={styles.field}>
            <span>Units</span>
            <input value={units} onChange={(event) => setCustomUnits(event.target.value)} readOnly={!activeCustom} />
          </label>
        </div>
        {activeCustom && (
          <div className={styles.controls}>
            <label className={styles.field}>
              <span>Timestamp column</span>
              <select value={customColumns.time} onChange={(event) => setCustomColumns((current) => ({ ...current, time: event.target.value }))}>
                {uploaded.columns.map((column) => <option key={column} value={column}>{column}</option>)}
              </select>
            </label>
            <label className={styles.field}>
              <span>Reference column</span>
              <select value={customColumns.reference} onChange={(event) => setCustomColumns((current) => ({ ...current, reference: event.target.value }))}>
                {uploaded.columns.map((column) => <option key={column} value={column}>{column}</option>)}
              </select>
            </label>
            <label className={styles.field}>
              <span>Candidate column</span>
              <select value={customColumns.sensor} onChange={(event) => setCustomColumns((current) => ({ ...current, sensor: event.target.value }))}>
                {uploaded.columns.map((column) => <option key={column} value={column}>{column}</option>)}
              </select>
            </label>
            <Button variant="secondary" onClick={() => setUploaded(null)}>Return to examples</Button>
          </div>
        )}
      </Card>

      <Card title="Configuration">
        <div className={styles.controls}>
          <label className={styles.field}>
            <span>Reference</span>
            <input value={activeCustom ? customColumns.reference : example.reference} readOnly />
          </label>
          <label className={styles.field}>
            <span>Candidate</span>
            <input value={activeCustom ? customColumns.sensor : example.sensor} readOnly />
          </label>
          <label className={styles.checkbox}>
            <input type="checkbox" checked={showCorrected} onChange={(event) => setShowCorrected(event.target.checked)} />
            <span>
              <strong>Show correction</strong>
              Use shipped corrected examples when available, otherwise apply inverse OLS correction.
            </span>
          </label>
          <Button
            variant="secondary"
            onClick={() => {
              const summary = [{
                source: uploaded?.name ?? example.label,
                reference: activeCustom ? customColumns.reference : example.reference,
                candidate: activeCustom ? customColumns.sensor : example.sensor,
                n: analysis.fit.n,
                slope: analysis.fit.slope,
                intercept: analysis.fit.intercept,
                r2: analysis.fit.r2,
                rmse: analysis.fit.rmse,
                mae: analysis.fit.mae,
                bias: analysis.fit.bias,
                medianReu: analysis.medianReu ?? "",
                agreementLower: analysis.agreement.lowerLimit,
                agreementUpper: analysis.agreement.upperLimit,
              }];
              downloadCsv(suggestFilename("measurement-error-summary", "csv"), objectsToCsv(summary));
            }}
          >
            Download summary CSV
          </Button>
        </div>
      </Card>

      <div className={styles.splitGrid}>
        <Card title={`Scatter: ${formatEquation(analysis.fit)}`}>
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
          <div className={styles.metricRow}><span>Raw RMSE</span><strong>{formatMetric(analysis.fit.rmse, 2)}</strong></div>
          <div className={styles.metricRow}><span>Corrected RMSE</span><strong>{analysis.correctedPairs.length ? formatMetric(analysis.correctedFit.rmse, 2) : "-"}</strong></div>
          <div className={styles.metricRow}><span>Raw MAE</span><strong>{formatMetric(analysis.fit.mae, 2)}</strong></div>
          <div className={styles.metricRow}><span>Corrected MAE</span><strong>{analysis.correctedPairs.length ? formatMetric(analysis.correctedFit.mae, 2) : "-"}</strong></div>
          <div className={styles.metricRow}><span>Agreement limits</span><strong>{formatMetric(analysis.agreement.lowerLimit, 1)} to {formatMetric(analysis.agreement.upperLimit, 1)}</strong></div>
          <div className={styles.metricRow}><span>REU regression</span><strong>{formatEquation({ slope: analysis.reu.slope, intercept: analysis.reu.intercept })}</strong></div>
        </div>
      </Card>
    </div>
  );
}
