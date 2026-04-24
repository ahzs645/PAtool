import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  summarizeSensorReliability,
  type PasCollection,
  type PatSeries,
  type SensorReliabilityCategory,
  type SensorReliabilityIssue,
} from "@patool/shared";

import { Card, CellStack, Chip, DataTable, Loader, PageHeader, StatCard, type Column } from "../components";
import { getJson } from "../lib/api";
import { formatMetric, percent } from "./toolsetUtils";
import styles from "./ToolsetPage.module.css";

function chipForCategory(category: SensorReliabilityCategory) {
  if (category === "pass") return <Chip variant="success">pass</Chip>;
  if (category === "watch") return <Chip variant="warning">watch</Chip>;
  return <Chip variant="danger">fail</Chip>;
}

export default function ReliabilityReportsPage() {
  const [sensorId, setSensorId] = useState("1001");

  const { data: collection } = useQuery({
    queryKey: ["reliability-pas"],
    queryFn: () => getJson<PasCollection>("/api/pas"),
  });

  const sensorOptions = useMemo(() =>
    collection?.records
      .filter((record) => record.locationType !== "inside")
      .slice(0, 120)
      .map((record) => ({ id: record.id, label: record.label })) ?? [],
  [collection]);

  const activeSensorId = sensorOptions.some((sensor) => sensor.id === sensorId)
    ? sensorId
    : sensorOptions[0]?.id ?? sensorId;

  const { data: series } = useQuery({
    queryKey: ["reliability-series", activeSensorId],
    enabled: Boolean(activeSensorId),
    queryFn: () => getJson<PatSeries>(`/api/pat?id=${activeSensorId}&aggregate=raw`),
  });

  const report = useMemo(() => series ? summarizeSensorReliability(series) : null, [series]);

  const issueColumns: Column<SensorReliabilityIssue>[] = [
    {
      key: "issue",
      header: "Issue",
      width: 220,
      render: (row) => <CellStack primary={row.code} sub={row.message} />,
    },
    { key: "severity", header: "Severity", width: 110, render: (row) => chipForCategory(row.severity) },
    { key: "count", header: "Count", width: 90, render: (row) => row.count === undefined ? "-" : String(row.count) },
  ];

  if (!collection || !report) return <Loader message="Building reliability report..." />;

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow="Reliability Reports"
        title="EPA and AirSensor-style sensor report"
        subtitle="Summarize completeness, A/B channel agreement, RMA regression, Barkjohn correction readiness, drift, and state-of-health."
      />

      <div className={styles.stats}>
        <StatCard label="Category" value={report.category} tone={report.category === "pass" ? "good" : "warn"} />
        <StatCard label="SOH index" value={String(report.sohIndex.index)} />
        <StatCard label="Paired complete" value={percent(report.completeness.pairedCompleteness, 0)} />
        <StatCard label="A/B agreement" value={percent(report.agreement.agreementFraction, 0)} />
      </div>

      <Card title="Sensor">
        <div className={styles.controls}>
          <label className={styles.field}>
            <span>Sensor</span>
            <select value={activeSensorId} onChange={(event) => setSensorId(event.target.value)}>
              {sensorOptions.map((sensor) => (
                <option key={sensor.id} value={sensor.id}>{sensor.label}</option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      <div className={styles.splitGrid}>
        <Card title="Completeness and correction">
          <div className={styles.metricGrid}>
            <div className={styles.metricRow}><span>Observed points</span><strong>{report.completeness.observedPoints}</strong></div>
            <div className={styles.metricRow}><span>Expected points</span><strong>{report.completeness.expectedPoints}</strong></div>
            <div className={styles.metricRow}><span>Humidity complete</span><strong>{percent(report.completeness.humidityCompleteness, 0)}</strong></div>
            <div className={styles.metricRow}><span>Barkjohn ready</span><strong>{percent(report.barkjohn.correctedAvailability, 0)}</strong></div>
          </div>
        </Card>
        <Card title="Agreement and drift">
          <div className={styles.metricGrid}>
            <div className={styles.metricRow}><span>Valid A/B pairs</span><strong>{report.agreement.validPairs}</strong></div>
            <div className={styles.metricRow}><span>Invalid A/B pairs</span><strong>{report.agreement.invalidPairs}</strong></div>
            <div className={styles.metricRow}><span>RMA slope</span><strong>{formatMetric(report.rmaRegression?.slope, 3)}</strong></div>
            <div className={styles.metricRow}><span>Drift/day</span><strong>{formatMetric(report.drift.slopePerDay, 4)}</strong></div>
          </div>
        </Card>
      </div>

      <Card title="Issues">
        <DataTable
          columns={issueColumns}
          data={report.issues}
          rowKey={(row) => row.code}
          emptyMessage="No reliability issues for this sensor."
        />
      </Card>
    </div>
  );
}
