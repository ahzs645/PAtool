import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  monitorNowcast,
  nowcastToAqi,
  type NowcastVariant,
  type PatSeries,
} from "@patool/shared";

import { Card, EChart, Loader, PageHeader, StatCard } from "../components";
import { getJson } from "../lib/api";
import styles from "./ToolsetPage.module.css";

export default function NowCastPage() {
  const [sensorId, setSensorId] = useState("1001");
  const [variant, setVariant] = useState<NowcastVariant>("pm");

  const { data: series, isLoading } = useQuery({
    queryKey: ["nowcast-series", sensorId],
    queryFn: () => getJson<PatSeries>(`/api/pat?id=${sensorId}&aggregate=hourly`),
  });

  const hourly = useMemo<Array<number | null>>(() => {
    if (!series) return [];
    return series.points.map((p) => {
      const a = p.pm25A ?? null;
      const b = p.pm25B ?? null;
      if (a === null && b === null) return null;
      return ((a ?? 0) + (b ?? 0)) / ((a !== null ? 1 : 0) + (b !== null ? 1 : 0) || 1);
    });
  }, [series]);

  const timestamps = useMemo(() => series?.points.map((p) => p.timestamp) ?? [], [series]);
  const nowcast = useMemo(() => monitorNowcast(hourly, { variant }), [hourly, variant]);
  const aqi = useMemo(() => nowcast.map((v) => nowcastToAqi(v)), [nowcast]);
  const validCount = nowcast.filter((v) => v !== null).length;
  const lastValid = [...aqi].reverse().find((a) => a.aqi !== null);

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow="EPA NowCast"
        title="Smoothed AQI using the EPA NowCast rule"
        subtitle="Three variants are available — the standard US PM (12-hour weighted), Asian PM (3-hour), and Ozone (8-hour trailing mean)."
      />
      <div className={styles.stats}>
        <StatCard label="Sensor" value={sensorId} />
        <StatCard label="Variant" value={variant} />
        <StatCard label="Valid NowCast hours" value={String(validCount)} />
        <StatCard label="Latest AQI" value={lastValid?.aqi !== null && lastValid?.aqi !== undefined ? String(lastValid.aqi) : "—"} />
      </div>

      <Card title="Configuration">
        <div className={styles.controls}>
          <label className={styles.field}>
            <span>Sensor ID</span>
            <input value={sensorId} onChange={(event) => setSensorId(event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Variant</span>
            <select value={variant} onChange={(event) => setVariant(event.target.value as NowcastVariant)}>
              <option value="pm">PM (US, 12h weighted)</option>
              <option value="pmAsian">PM (Asian, 3h weighted)</option>
              <option value="ozone">Ozone (8h trailing mean)</option>
            </select>
          </label>
        </div>
      </Card>

      {isLoading && <Loader message="Loading sensor history..." />}

      <Card title="Hourly value vs. NowCast">
        <EChart
          option={{
            tooltip: { trigger: "axis" },
            legend: {},
            xAxis: { type: "time" },
            yAxis: { type: "value", name: "µg/m³" },
            series: [
              { name: "Hourly PM", type: "line", showSymbol: false, data: timestamps.map((t, i) => [t, hourly[i]]) },
              { name: "NowCast", type: "line", showSymbol: false, data: timestamps.map((t, i) => [t, nowcast[i]]) },
            ],
          }}
          height={360}
          zoomable
        />
      </Card>

      <Card title="NowCast AQI category">
        <EChart
          option={{
            tooltip: { trigger: "axis" },
            xAxis: { type: "time" },
            yAxis: { type: "value", name: "AQI" },
            series: [
              { name: "AQI", type: "line", showSymbol: false, data: timestamps.map((t, i) => [t, aqi[i].aqi]) },
            ],
          }}
          height={300}
          zoomable
        />
      </Card>
    </div>
  );
}
