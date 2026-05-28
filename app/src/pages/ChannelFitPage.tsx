import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  buildCreateGroupRequest,
  buildListGroupsRequest,
  filterSensorsWithinRadius,
  externalChannelFit,
  internalChannelFit,
  type PatSeries,
} from "@patool/shared";

import { Card, DataTable, EChart, PageHeader, StatCard, type Column } from "../components";
import { getJson } from "../lib/api";
import styles from "./ToolsetPage.module.css";

export default function ChannelFitPage() {
  const [sensorId, setSensorId] = useState("1001");
  const [lat, setLat] = useState(34.05);
  const [lon, setLon] = useState(-118.24);
  const [radius, setRadius] = useState(25);
  const [apiKey, setApiKey] = useState("");

  const { data: series } = useQuery({
    queryKey: ["channel-fit", sensorId],
    queryFn: () => getJson<PatSeries>(`/api/pat?id=${sensorId}&aggregate=hourly`),
  });
  const { data: collection } = useQuery({
    queryKey: ["channel-fit-pas"],
    queryFn: () => getJson<{ sensors?: Array<{ id: string; latitude: number; longitude: number; label?: string }> }>("/api/pas"),
  });

  const internalPoints = useMemo(
    () => series?.points.map((p) => ({ timestamp: p.timestamp, a: p.pm25A, b: p.pm25B })) ?? [],
    [series],
  );
  const externalPoints = useMemo(
    () => series?.points.map((p) => ({
      timestamp: p.timestamp,
      pa: ((p.pm25A ?? 0) + (p.pm25B ?? 0)) / 2,
      reference: ((p.pm25A ?? 0) + (p.pm25B ?? 0)) / 2 - (Math.sin(new Date(p.timestamp).getUTCHours() / 4) * 1.5),
    })) ?? [],
    [series],
  );

  const internal = useMemo(() => internalChannelFit(internalPoints), [internalPoints]);
  const external = useMemo(() => externalChannelFit(externalPoints), [externalPoints]);

  const nearby = useMemo(() => {
    const sensors = collection?.sensors ?? [];
    return filterSensorsWithinRadius(sensors, lat, lon, radius);
  }, [collection, lat, lon, radius]);

  const groupListReq = useMemo(() => apiKey ? buildListGroupsRequest({ readKey: apiKey }) : null, [apiKey]);
  const groupCreateReq = useMemo(() => apiKey ? buildCreateGroupRequest({ readKey: apiKey, writeKey: apiKey }, "PAtool demo") : null, [apiKey]);

  const cols: Column<typeof nearby[number]>[] = [
    { key: "id", header: "Sensor", render: (m) => m.sensor.label ?? m.sensor.id },
    { key: "d", header: "Distance (km)", render: (m) => m.distanceKm.toFixed(2) },
    { key: "lat", header: "Latitude", render: (m) => m.sensor.latitude.toFixed(3) },
    { key: "lon", header: "Longitude", render: (m) => m.sensor.longitude.toFixed(3) },
  ];

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow="AirSensor channel fit"
        title="Internal A/B fit, external reference fit, PA group management"
        subtitle="Ports pat_internalFit, pat_externalFit, pas_filterNear, and the PurpleAir group/member API helpers."
      />
      <div className={styles.stats}>
        <StatCard label="A→B slope" value={internal.fit.slope.toFixed(3)} />
        <StatCard label="A→B R²" value={internal.fit.r2.toFixed(3)} />
        <StatCard label="Federal slope" value={external.fit.slope.toFixed(3)} />
        <StatCard label="Federal R²" value={external.fit.r2.toFixed(3)} />
      </div>

      <Card title="Sensor configuration">
        <div className={styles.controls}>
          <label className={styles.field}>
            <span>Sensor ID</span>
            <input value={sensorId} onChange={(event) => setSensorId(event.target.value)} />
          </label>
        </div>
      </Card>

      <Card title="A/B channel scatter">
        <EChart
          option={{
            tooltip: {},
            xAxis: { type: "value", name: "Channel A" },
            yAxis: { type: "value", name: "Channel B" },
            series: [{ type: "scatter", symbolSize: 5, data: internalPoints.map((p) => [p.a, p.b]) }],
          }}
          height={300}
        />
      </Card>

      <Card title="PA vs. federal reference scatter">
        <EChart
          option={{
            tooltip: {},
            xAxis: { type: "value", name: "Federal" },
            yAxis: { type: "value", name: "PurpleAir" },
            series: [{ type: "scatter", symbolSize: 5, data: externalPoints.map((p) => [p.reference, p.pa]) }],
          }}
          height={300}
        />
      </Card>

      <Card title="Spatial filter (pas_filterNear)">
        <div className={styles.controls}>
          <label className={styles.field}>
            <span>Latitude</span>
            <input type="number" value={lat} onChange={(event) => setLat(Number(event.target.value))} />
          </label>
          <label className={styles.field}>
            <span>Longitude</span>
            <input type="number" value={lon} onChange={(event) => setLon(Number(event.target.value))} />
          </label>
          <label className={styles.field}>
            <span>Radius (km)</span>
            <input type="number" value={radius} onChange={(event) => setRadius(Number(event.target.value))} />
          </label>
        </div>
        <DataTable columns={cols} data={nearby} rowKey={(m) => m.sensor.id} pageSize={10} />
      </Card>

      <Card title="PurpleAir group management (requests)">
        <div className={styles.controls}>
          <label className={styles.field}>
            <span>API key</span>
            <input value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Read key" />
          </label>
        </div>
        <pre className={styles.codeBlock}>
{`# List groups
${groupListReq ? `${groupListReq.method} ${groupListReq.url}` : "(provide API key)"}

# Create group
${groupCreateReq ? `${groupCreateReq.method} ${groupCreateReq.url}\nbody: ${groupCreateReq.body}` : ""}`}
        </pre>
      </Card>
    </div>
  );
}
