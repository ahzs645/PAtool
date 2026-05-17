import { useMemo } from "react";
import { compareNeighborMeasurements, neighborPairStatistics } from "@patool/shared";

import { Card, DataTable, PageHeader, StatCard, type Column } from "../components";
import styles from "./ToolsetPage.module.css";

const REFERENCES = Array.from({ length: 24 }, (_, hour) => ({
  id: "reference-a",
  timestamp: `2026-01-01T${String(hour).padStart(2, "0")}:00:00Z`,
  latitude: 45.52,
  longitude: -122.68,
  value: 8 + Math.sin(hour / 3) * 5 + hour * 0.4,
}));

const SENSORS = [
  ...REFERENCES.map((row) => ({
    ...row,
    id: "sensor-near-good",
    latitude: 45.521,
    longitude: -122.681,
    value: row.value * 1.08 + 0.8,
  })),
  ...REFERENCES.map((row) => ({
    ...row,
    id: "sensor-near-biased",
    latitude: 45.523,
    longitude: -122.683,
    value: row.value * 1.65 + 8,
  })),
];

export default function NetworkQaPage() {
  const pairs = useMemo(() => compareNeighborMeasurements(REFERENCES, SENSORS, {
    maxDistanceMeters: 800,
    maxAbsoluteDifference: 10,
    maxSymmetricPercentDifference: 45,
    minRSquared: 0.65,
  }), []);
  const stats = useMemo(() => neighborPairStatistics(pairs), [pairs]);
  const flagged = pairs.filter((pair) => pair.flags.length > 0).length;

  const columns: Column<(typeof stats)[number]>[] = [
    { key: "reference", header: "Reference", render: (row) => row.referenceId },
    { key: "sensor", header: "Sensor", render: (row) => row.sensorId },
    { key: "n", header: "Pairs", render: (row) => row.n },
    { key: "distance", header: "Distance m", render: (row) => row.distanceMeters.toFixed(0) },
    { key: "r2", header: "R2", render: (row) => row.r2.toFixed(3) },
    { key: "rmse", header: "RMSE", render: (row) => row.rmse.toFixed(2) },
    { key: "nrmse", header: "NRMSE", render: (row) => row.nrmse === null ? "--" : `${row.nrmse.toFixed(1)}%` },
    { key: "bias", header: "Bias", render: (row) => row.bias.toFixed(2) },
  ];

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow="Network QA"
        title="Neighbor consistency workbench"
        subtitle="ASNAT-style spatial/time neighbor comparison with distance windows, difference flags, R2, RMSE, NRMSE, and bias."
      />
      <div className={styles.stats}>
        <StatCard label="Pairs" value={String(pairs.length)} />
        <StatCard label="Flagged pairs" value={String(flagged)} tone={flagged ? "warn" : "good"} />
        <StatCard label="Pair groups" value={String(stats.length)} />
      </div>
      <Card title="Pair statistics">
        <DataTable columns={columns} data={stats} rowKey={(row) => `${row.referenceId}-${row.sensorId}`} pageSize={12} />
      </Card>
      <Card title="Flagged observations">
        <DataTable
          columns={[
            { key: "time", header: "Time", render: (row) => row.timestamp },
            { key: "sensor", header: "Sensor", render: (row) => row.sensorId },
            { key: "reference", header: "Reference", render: (row) => row.referenceValue.toFixed(2) },
            { key: "candidate", header: "Candidate", render: (row) => row.sensorValue.toFixed(2) },
            { key: "flags", header: "Flags", render: (row) => row.flags.join(", ") },
          ]}
          data={pairs.filter((pair) => pair.flags.length)}
          rowKey={(row) => `${row.timestamp}-${row.sensorId}`}
          pageSize={12}
        />
      </Card>
    </div>
  );
}
