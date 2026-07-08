import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { importPurpleAirCsv, type PurpleAirImportResult } from "@patool/shared";

import { Button, Card, PageHeader, StatCard } from "../components";
import { useActiveDataset } from "../hooks/useActiveDataset";
import { clearActiveDataset, setActiveDataset } from "../lib/datasetStore";
import styles from "./ImportDataPage.module.css";

function fmtRange(start: string | null, end: string | null): string {
  if (!start || !end) return "—";
  return `${start.slice(0, 10)} → ${end.slice(0, 10)}`;
}

export default function ImportDataPage() {
  const active = useActiveDataset();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [preview, setPreview] = useState<{ result: PurpleAirImportResult; fileName: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = useCallback(async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = [...fileList].filter((f) => /\.csv$/i.test(f.name) || f.type === "text/csv");
    if (files.length === 0) {
      setError("No .csv files found in the selection.");
      setPreview(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const contents = await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() })));
      const result = importPurpleAirCsv(contents);
      const fileName = files.length === 1 ? files[0].name : `${files.length} files`;
      setPreview({ result, fileName });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to parse the uploaded files.");
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }, []);

  const activate = useCallback(async () => {
    if (!preview) return;
    const { result, fileName } = preview;
    await setActiveDataset({
      name: fileName,
      importedAt: new Date().toISOString(),
      summary: result.summary,
      warnings: result.warnings,
      collection: result.collection,
      seriesById: Object.fromEntries(result.series.map((s) => [s.meta.sensorId, s])),
      network: result.network,
    });
    await queryClient.invalidateQueries();
    setPreview(null);
    navigate("/");
  }, [preview, queryClient, navigate]);

  const revert = useCallback(async () => {
    await clearActiveDataset();
    await queryClient.invalidateQueries();
  }, [queryClient]);

  const summary = preview?.result.summary;

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow="Your data"
        title="Upload PurpleAir data"
        subtitle="Drop your PurpleAir daily/hourly export CSVs to run the entire app on your own sensor network. Everything stays in your browser — nothing is uploaded to a server."
      />

      {active && (
        <Card title="Active dataset">
          <div className={styles.stats}>
            <StatCard label="Source" value={active.name} />
            <StatCard label="Sensors" value={String(active.summary.sensorCount)} tone="good" />
            <StatCard label="Date range" value={fmtRange(active.summary.start, active.summary.end)} />
            <StatCard label="Points" value={active.summary.pointCount.toLocaleString()} />
          </div>
          <p className={styles.hint}>PAtool is currently serving your uploaded data across every page.</p>
          <div className={styles.actions}>
            <Button variant="secondary" onClick={revert}>Revert to demo data</Button>
          </div>
        </Card>
      )}

      <Card title={active ? "Replace with new data" : "Upload"}>
        <div
          className={`${styles.dropzone} ${dragOver ? styles.dropzoneActive : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); void handleFiles(e.dataTransfer.files); }}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            multiple
            className={styles.fileInput}
            onChange={(e) => void handleFiles(e.target.files)}
          />
          <p className={styles.dropTitle}>{busy ? "Parsing…" : "Drop CSV files here or click to browse"}</p>
          <p className={styles.dropSub}>
            Expected columns: time_stamp, sensor_number, latitude, longitude, pm2.5_cf_1, humidity, temperature, pressure
          </p>
        </div>
        {error && <p className={styles.error} role="alert">{error}</p>}
      </Card>

      {preview && summary && (
        <Card title="Preview">
          <div className={styles.stats}>
            <StatCard label="Files" value={String(summary.fileCount)} />
            <StatCard label="Sensors" value={String(summary.sensorCount)} tone="good" />
            <StatCard label="Rows" value={summary.rowCount.toLocaleString()} />
            <StatCard label="Hourly points" value={summary.pointCount.toLocaleString()} />
            <StatCard label="Date range" value={fmtRange(summary.start, summary.end)} />
          </div>
          {preview.result.warnings.length > 0 && (
            <ul className={styles.warnings}>
              {preview.result.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <div className={styles.actions}>
            <Button onClick={activate}>Use this dataset</Button>
            <Button variant="tertiary" onClick={() => setPreview(null)}>Discard</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
