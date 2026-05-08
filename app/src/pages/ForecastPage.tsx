import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  diurnalClimatologyForecast,
  exponentialSmoothingForecast,
  FORECAST_METHOD_NOTES,
  persistenceForecast,
  type ForecastPoint,
  type ForecastSamplePoint,
  type PatSeries,
} from "@patool/shared";

import { Card, CellStack, DataTable, Loader, PageHeader, StatCard, type Column } from "../components";
import { getJson } from "../lib/api";
import { downloadCsv, objectsToCsv, suggestFilename } from "../lib/exporters";
import { Button } from "../components";
import styles from "./ToolsetPage.module.css";

const METHODS = ["persistence", "diurnal-climatology", "exponential-smoothing"] as const;
type Method = typeof METHODS[number];

function meanPm(point: { pm25A: number | null; pm25B: number | null }): number | null {
  if (point.pm25A !== null && point.pm25B !== null) return (point.pm25A + point.pm25B) / 2;
  return point.pm25A ?? point.pm25B;
}

export default function ForecastPage() {
  const [sensorId, setSensorId] = useState("1001");
  const [method, setMethod] = useState<Method>("persistence");
  const [horizon, setHorizon] = useState(24);

  const { data: series, isLoading } = useQuery({
    queryKey: ["forecast-series", sensorId],
    queryFn: () => getJson<PatSeries>(`/api/pat?id=${sensorId}&aggregate=hourly`),
  });

  const history: ForecastSamplePoint[] = useMemo(() => {
    if (!series) return [];
    return series.points
      .map((point) => ({ timestamp: point.timestamp, pm25: meanPm(point) ?? Number.NaN }))
      .filter((point) => Number.isFinite(point.pm25));
  }, [series]);

  const forecast: ForecastPoint[] = useMemo(() => {
    const input = { history, horizonHours: horizon };
    switch (method) {
      case "persistence":
        return persistenceForecast(input);
      case "diurnal-climatology":
        return diurnalClimatologyForecast(input);
      case "exponential-smoothing":
        return exponentialSmoothingForecast(input);
    }
  }, [history, horizon, method]);

  const columns: Column<ForecastPoint>[] = [
    { key: "ts", header: "Timestamp (UTC)", width: 200, render: (row) => row.timestamp.replace("T", " ").slice(0, 16) },
    { key: "pm25", header: "PM2.5 (µg/m³)", width: 130, render: (row) => row.pm25.toFixed(2) },
    { key: "pi", header: "95% PI half-width", width: 140, render: (row) => `± ${row.pi95Half.toFixed(2)}` },
    { key: "source", header: "Source", width: 160, render: (row) => row.source },
  ];

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow="Forecast"
        title="PM2.5 short-horizon baselines"
        subtitle="Browser-side forecast baselines for any sensor in the loaded dataset. The ML-backed graph forecast lands as a swap of the same `ForecastPoint[]` interface."
      />

      <div className={styles.stats}>
        <StatCard label="Sensor" value={sensorId} />
        <StatCard label="Method" value={method} />
        <StatCard label="History (hours)" value={String(history.length)} />
        <StatCard label="Forecast (hours)" value={String(forecast.length)} />
      </div>

      <Card title="Configuration">
        <div className={styles.controls}>
          <label className={styles.field}>
            <span>Sensor ID</span>
            <input value={sensorId} onChange={(event) => setSensorId(event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Method</span>
            <select value={method} onChange={(event) => setMethod(event.target.value as Method)}>
              {METHODS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Horizon (hours)</span>
            <input
              type="number"
              min={1}
              max={168}
              value={horizon}
              onChange={(event) => setHorizon(Math.max(1, Number(event.target.value) || 24))}
            />
          </label>
        </div>
      </Card>

      <Card title={FORECAST_METHOD_NOTES[method].title}>
        <p>{FORECAST_METHOD_NOTES[method].summary}</p>
      </Card>

      <Card title="Planned ML upgrade">
        <p>{FORECAST_METHOD_NOTES["ml-stgnn"].summary}</p>
      </Card>

      <Card title="Forecast">
        {isLoading ? (
          <Loader message="Loading sensor history..." />
        ) : (
          <>
            <div className={styles.controls}>
              <Button
                variant="secondary"
                disabled={forecast.length === 0}
                onClick={() => {
                  const rows = forecast.map((point) => ({
                    timestamp: point.timestamp,
                    pm25: point.pm25,
                    pi95_half: point.pi95Half,
                    source: point.source,
                    method,
                    sensorId,
                  }));
                  downloadCsv(suggestFilename(`forecast-${sensorId}-${method}`, "csv"), objectsToCsv(rows));
                }}
              >
                Download CSV
              </Button>
            </div>
            <DataTable
              columns={columns}
              data={forecast}
              rowKey={(row) => row.timestamp}
              emptyMessage="No forecast yet."
              pageSize={24}
              footer={<CellStack primary={`Method: ${method}`} sub={`Horizon: ${horizon} h`} />}
            />
          </>
        )}
      </Card>
    </div>
  );
}
