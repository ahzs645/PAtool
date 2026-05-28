import { useMemo, useState } from "react";

import {
  importTraj,
  trajCluster,
  trajLevel,
  trajPlot,
} from "@patool/shared";

import { Card, DataTable, EChart, PageHeader, StatCard, type Column } from "../components";
import styles from "./ToolsetPage.module.css";

const SAMPLE_CSV = `receptor,date,hour_inc,lat,lon
ABC,2024-06-01T00:00:00Z,0,47.6,-122.3
ABC,2024-06-01T00:00:00Z,-6,48.0,-121.6
ABC,2024-06-01T00:00:00Z,-12,48.6,-120.9
ABC,2024-06-01T00:00:00Z,-24,49.5,-119.6
ABC,2024-06-02T00:00:00Z,0,47.6,-122.3
ABC,2024-06-02T00:00:00Z,-6,46.8,-121.1
ABC,2024-06-02T00:00:00Z,-12,45.6,-120.0
ABC,2024-06-02T00:00:00Z,-24,44.3,-118.4
ABC,2024-06-03T00:00:00Z,0,47.6,-122.3
ABC,2024-06-03T00:00:00Z,-6,47.5,-121.1
ABC,2024-06-03T00:00:00Z,-12,47.4,-119.6
ABC,2024-06-03T00:00:00Z,-24,47.0,-117.5
`;

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = cells[i] ?? ""; });
    return row;
  });
}

export default function TrajectoryPage() {
  const [text, setText] = useState(SAMPLE_CSV);
  const trajectories = useMemo(() => importTraj(parseCsv(text)), [text]);
  const clusters = useMemo(() => trajCluster(trajectories, 2), [trajectories]);
  const polylines = useMemo(() => trajPlot(trajectories), [trajectories]);
  const values = useMemo(() => {
    const map: Record<string, number> = {};
    trajectories.forEach((t, i) => { map[t.id] = 8 + i * 1.2; });
    return map;
  }, [trajectories]);
  const levelCells = useMemo(() => trajLevel(trajectories, values, 0.5), [trajectories, values]);

  const cols: Column<typeof clusters.clusters[number]>[] = [
    { key: "id", header: "Cluster", render: (c) => c.label },
    { key: "n", header: "Size", render: (c) => c.size },
    { key: "lat", header: "Centroid lat[0]", render: (c) => c.centroidLat[0]?.toFixed(2) ?? "—" },
    { key: "lon", header: "Centroid lon[0]", render: (c) => c.centroidLon[0]?.toFixed(2) ?? "—" },
  ];

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow="Openair trajectories"
        title="HYSPLIT-style trajectory cluster and overlay"
        subtitle="Import → cluster → trajLevel. Paste CSV with columns receptor, date, hour_inc, lat, lon (any HYSPLIT export converted to CSV works)."
      />
      <div className={styles.stats}>
        <StatCard label="Trajectories" value={String(trajectories.length)} />
        <StatCard label="Clusters" value={String(clusters.clusters.length)} />
        <StatCard label="Grid cells" value={String(levelCells.length)} />
        <StatCard label="Polylines" value={String(polylines.length)} />
      </div>

      <Card title="Trajectory CSV">
        <textarea
          rows={8}
          spellCheck={false}
          className={styles.textarea}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </Card>

      <Card title="Cluster centroids">
        <DataTable columns={cols} data={clusters.clusters} rowKey={(c) => String(c.id)} pageSize={6} />
      </Card>

      <Card title="Trajectory paths (lon/lat scatter)">
        <EChart
          option={{
            tooltip: {},
            xAxis: { type: "value", name: "Longitude" },
            yAxis: { type: "value", name: "Latitude" },
            series: polylines.map((line) => ({
              name: line.id,
              type: "line",
              showSymbol: false,
              data: line.coords.map(([lat, lon]) => [lon, lat]),
            })),
          }}
          height={360}
        />
      </Card>

      <Card title="Trajectory level cells (CWT proxy)">
        <EChart
          option={{
            tooltip: {},
            xAxis: { type: "value", name: "Longitude" },
            yAxis: { type: "value", name: "Latitude" },
            visualMap: { min: 0, max: Math.max(0.001, ...levelCells.map((c) => c.meanValue)), calculable: true, orient: "horizontal", bottom: 0 },
            series: [{ type: "scatter", symbolSize: 14, data: levelCells.map((c) => [c.lon, c.lat, c.meanValue]) }],
          }}
          height={320}
        />
      </Card>
    </div>
  );
}
