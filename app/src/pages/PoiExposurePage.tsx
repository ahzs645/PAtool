import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  createOrdinaryKrigingModel,
  idwEstimateAtPoints,
  krigingEstimateAtPoints,
  pm25ToAqi,
  pm25ToAqiBand,
  type InterpolationPoint,
  type PasCollection,
  type PointEstimate,
  type PointEstimateQuery,
  type PointEstimateSource,
} from "@patool/shared";

import { Button, Card, CellStack, Chip, DataTable, Loader, PageHeader, StatCard, type Column } from "../components";
import { getJson } from "../lib/api";
import styles from "./PoiExposurePage.module.css";

type Method = "idw" | "kriging";

type PoiInput = {
  rowNumber: number;
  id: string;
  name: string;
  latitude: number;
  longitude: number;
};

type PoiResult = PoiInput & {
  estimate: PointEstimate;
};

const SAMPLE_CSV = `id,name,latitude,longitude
school-001,Lincoln Elementary,44.0805,-103.2310
school-002,Roosevelt Middle,44.0918,-103.2076
school-003,Jefferson High,44.0700,-103.2540
poi-park-01,City Park,44.0815,-103.2200`;

function parseCsv(text: string): { rows: PoiInput[]; warnings: string[] } {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  const warnings: string[] = [];
  if (lines.length === 0) return { rows: [], warnings: ["CSV is empty."] };

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const idx = (key: string) => header.indexOf(key);
  const idIdx = idx("id");
  const nameIdx = idx("name") >= 0 ? idx("name") : idx("label");
  const latIdx = idx("latitude") >= 0 ? idx("latitude") : idx("lat");
  const lonIdx = idx("longitude") >= 0 ? idx("longitude") : idx("lon");

  if (latIdx < 0 || lonIdx < 0) {
    return { rows: [], warnings: ["CSV must include latitude and longitude columns."] };
  }

  const rows: PoiInput[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    const lat = Number(cols[latIdx]);
    const lon = Number(cols[lonIdx]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      warnings.push(`Row ${i + 1}: skipping (invalid coordinates).`);
      continue;
    }
    rows.push({
      rowNumber: i + 1,
      id: idIdx >= 0 ? cols[idIdx] || `row-${i}` : `row-${i}`,
      name: nameIdx >= 0 ? cols[nameIdx] || cols[idIdx] || `Row ${i}` : cols[idIdx] || `Row ${i}`,
      latitude: lat,
      longitude: lon,
    });
  }
  return { rows, warnings };
}

function buildKnownPoints(collection: PasCollection | undefined, valueField: string): InterpolationPoint[] {
  if (!collection) return [];
  const out: InterpolationPoint[] = [];
  for (const record of collection.records) {
    const raw = (record as unknown as Record<string, number | null | undefined>)[valueField];
    if (raw === null || raw === undefined || !Number.isFinite(raw)) continue;
    if (!Number.isFinite(record.latitude) || !Number.isFinite(record.longitude)) continue;
    if (record.locationType === "inside") continue;
    out.push({
      id: record.uniqueId ?? record.id,
      x: record.longitude,
      y: record.latitude,
      value: raw,
    });
  }
  return out;
}

function exportToCsv(rows: PoiResult[]): string {
  const headers = [
    "id",
    "name",
    "latitude",
    "longitude",
    "pm25_estimate",
    "aqi_estimate",
    "aqi_band",
    "source",
    "neighbor_count",
  ];
  const lines: string[] = [headers.join(",")];
  for (const r of rows) {
    const v = r.estimate.value;
    const pm = v !== null && Number.isFinite(v) ? v.toFixed(2) : "";
    const aqi = v !== null && Number.isFinite(v) ? String(pm25ToAqi(v)) : "";
    const band = v !== null && Number.isFinite(v) ? pm25ToAqiBand(v).label : "";
    lines.push([
      r.id,
      JSON.stringify(r.name),
      r.latitude.toFixed(5),
      r.longitude.toFixed(5),
      pm,
      aqi,
      band,
      r.estimate.source,
      String(r.estimate.neighborCount),
    ].join(","));
  }
  return lines.join("\n");
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function chipForSource(source: PointEstimateSource) {
  switch (source) {
    case "exact":
      return <Chip variant="success">exact</Chip>;
    case "kriging":
      return <Chip variant="accent">kriging</Chip>;
    case "idw-fallback":
      return <Chip>IDW</Chip>;
    case "nearest":
      return <Chip variant="warning">nearest</Chip>;
    case "none":
    default:
      return <Chip variant="danger">none</Chip>;
  }
}

const VALUE_FIELDS: Array<{ value: string; label: string }> = [
  { value: "pm25Current", label: "PM2.5 current" },
  { value: "pm25_10min", label: "PM2.5 10 min" },
  { value: "pm25_30min", label: "PM2.5 30 min" },
  { value: "pm25_1hr", label: "PM2.5 1 hour" },
  { value: "pm25_6hr", label: "PM2.5 6 hour" },
  { value: "pm25_1day", label: "PM2.5 1 day" },
];

export default function PoiExposurePage() {
  const { data, isLoading } = useQuery({
    queryKey: ["poi-exposure-pas"],
    queryFn: () => getJson<PasCollection>("/api/pas"),
  });

  const [csv, setCsv] = useState<string>(SAMPLE_CSV);
  const [method, setMethod] = useState<Method>("idw");
  const [valueField, setValueField] = useState<string>("pm25_1hr");
  const [maxNeighbors, setMaxNeighbors] = useState<number>(12);
  const [maxDistanceKm, setMaxDistanceKm] = useState<number>(50);

  const parsed = useMemo(() => parseCsv(csv), [csv]);
  const knownPoints = useMemo(() => buildKnownPoints(data, valueField), [data, valueField]);

  const krigingModel = useMemo(() => {
    if (method !== "kriging") return null;
    if (knownPoints.length < 3) return null;
    return createOrdinaryKrigingModel(knownPoints);
  }, [method, knownPoints]);

  const results = useMemo<PoiResult[]>(() => {
    if (parsed.rows.length === 0 || knownPoints.length === 0) return [];
    const queries: PointEstimateQuery[] = parsed.rows.map((r) => ({
      id: r.id,
      x: r.longitude,
      y: r.latitude,
    }));

    let estimates: PointEstimate[];
    if (method === "kriging" && krigingModel) {
      estimates = krigingEstimateAtPoints(krigingModel, queries, { maxNeighbors });
    } else {
      estimates = idwEstimateAtPoints(knownPoints, queries, {
        power: 2,
        maxNeighbors,
        maxDistanceKm: maxDistanceKm > 0 ? maxDistanceKm : -1,
      });
    }

    return parsed.rows.map((row, i) => ({ ...row, estimate: estimates[i] }));
  }, [parsed.rows, knownPoints, method, krigingModel, maxNeighbors, maxDistanceKm]);

  const summary = useMemo(() => {
    if (results.length === 0) {
      return { total: 0, withValue: 0, mean: null as number | null, max: null as number | null };
    }
    const values: number[] = [];
    for (const r of results) {
      const v = r.estimate.value;
      if (v !== null && Number.isFinite(v)) values.push(v);
    }
    if (values.length === 0) return { total: results.length, withValue: 0, mean: null, max: null };
    let sum = 0;
    let max = -Infinity;
    for (const v of values) {
      sum += v;
      if (v > max) max = v;
    }
    return { total: results.length, withValue: values.length, mean: sum / values.length, max };
  }, [results]);

  const columns: Column<PoiResult>[] = [
    {
      key: "name",
      header: "Receptor",
      width: 220,
      render: (row) => <CellStack primary={row.name} sub={row.id} />,
    },
    {
      key: "coords",
      header: "Lat / Lon",
      width: 160,
      render: (row) => (
        <CellStack
          primary={`${row.latitude.toFixed(4)}, ${row.longitude.toFixed(4)}`}
        />
      ),
    },
    {
      key: "pm25",
      header: "PM2.5 (μg/m³)",
      width: 140,
      render: (row) => {
        const v = row.estimate.value;
        return v !== null && Number.isFinite(v) ? v.toFixed(2) : "—";
      },
    },
    {
      key: "aqi",
      header: "AQI",
      width: 140,
      render: (row) => {
        const v = row.estimate.value;
        if (v === null || !Number.isFinite(v)) return "—";
        const aqi = pm25ToAqi(v);
        const band = pm25ToAqiBand(v);
        return <CellStack primary={String(aqi)} sub={band.label} />;
      },
    },
    {
      key: "source",
      header: "Source",
      width: 120,
      render: (row) => chipForSource(row.estimate.source),
    },
    {
      key: "neighbors",
      header: "Neighbors",
      width: 100,
      render: (row) => String(row.estimate.neighborCount),
    },
  ];

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow="Receptor exposure"
        title="Schools / POIs exposure"
        subtitle="Batch interpolate PM2.5 to school, monitor, or any point-of-interest receptors"
      />

      {isLoading && <Loader message="Loading sensor snapshot..." />}

      <div className={styles.stats}>
        <StatCard label="Receptors parsed" value={String(summary.total)} />
        <StatCard
          label="With estimate"
          value={`${summary.withValue} / ${summary.total}`}
        />
        <StatCard
          label="Mean PM2.5 (μg/m³)"
          value={summary.mean !== null ? summary.mean.toFixed(1) : "—"}
        />
        <StatCard
          label="Max PM2.5 (μg/m³)"
          value={summary.max !== null && Number.isFinite(summary.max) ? summary.max.toFixed(1) : "—"}
        />
      </div>

      <Card title="Configuration">
        <div className={styles.controls}>
          <label className={styles.field}>
            <span>Sensor field</span>
            <select value={valueField} onChange={(e) => setValueField(e.target.value)}>
              {VALUE_FIELDS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Method</span>
            <select value={method} onChange={(e) => setMethod(e.target.value as Method)}>
              <option value="idw">Inverse-distance weighting</option>
              <option value="kriging">Ordinary kriging</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Max neighbors</span>
            <input
              type="number"
              min={1}
              max={64}
              value={maxNeighbors}
              onChange={(e) => setMaxNeighbors(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            />
          </label>
          <label className={styles.field}>
            <span>Max distance (km, IDW)</span>
            <input
              type="number"
              min={0}
              step={5}
              value={maxDistanceKm}
              onChange={(e) => setMaxDistanceKm(Math.max(0, Number(e.target.value) || 0))}
              disabled={method !== "idw"}
            />
          </label>
        </div>
      </Card>

      <Card title="Receptor list">
        <p className={styles.cardHint}>Paste CSV with id, name, latitude, longitude columns.</p>
        <textarea
          className={styles.csvInput}
          rows={6}
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          spellCheck={false}
        />
        {parsed.warnings.length > 0 && (
          <div className={styles.warnings}>
            {parsed.warnings.map((w, i) => (
              <div key={i} className={styles.warningRow}>{w}</div>
            ))}
          </div>
        )}
        <div className={styles.csvActions}>
          <Button
            variant="secondary"
            onClick={() => setCsv(SAMPLE_CSV)}
          >
            Reset to sample
          </Button>
          <Button
            disabled={results.length === 0}
            onClick={() => downloadText(`patool-poi-exposure-${valueField}.csv`, exportToCsv(results))}
          >
            Download CSV
          </Button>
        </div>
      </Card>

      <Card title={`Estimates (${results.length})`}>
        <p className={styles.cardHint}>
          {knownPoints.length === 0
            ? "Waiting for sensor data..."
            : `Interpolating from ${knownPoints.length} outdoor sensors using ${method === "kriging" ? "ordinary kriging" : "IDW"}.`}
        </p>
        <DataTable
          columns={columns}
          data={results}
          rowKey={(r) => r.id}
          emptyMessage={
            parsed.rows.length === 0
              ? "Paste at least one receptor row above."
              : knownPoints.length === 0
                ? "No usable sensors in current snapshot."
                : "No estimates available."
          }
          pageSize={25}
        />
      </Card>
    </div>
  );
}

