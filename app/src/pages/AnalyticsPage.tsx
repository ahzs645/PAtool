import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { calculateSohIndex, runHourlyAbQc, type PatSeries, type SohIndexResult, type RichAggregateSeries, type RichAggregatePoint } from "@patool/shared";

import { Loader, PageHeader, StatCard, Card, Button, DataTable, CellStack, Chip } from "../components";
import type { Column } from "../components";
import { getJson, postJson } from "../lib/api";
import styles from "./AnalyticsPage.module.css";

function fmtMeanSd(mean: number | null, sd: number | null): string {
  if (mean === null) return "\u2014";
  if (sd === null) return mean.toFixed(1);
  return `${mean.toFixed(1)} \u00B1 ${sd.toFixed(1)}`;
}

const richColumns: Column<RichAggregatePoint>[] = [
  {
    key: "timestamp",
    header: "Time",
    width: 150,
    render: (r) => r.timestamp.slice(0, 16).replace("T", " "),
  },
  {
    key: "pm25A",
    header: "PM2.5 A Mean\u00B1SD",
    width: 150,
    render: (r) => (
      <CellStack
        primary={fmtMeanSd(r.pm25A.mean, r.pm25A.sd)}
      />
    ),
  },
  {
    key: "pm25B",
    header: "PM2.5 B Mean\u00B1SD",
    width: 150,
    render: (r) => (
      <CellStack
        primary={fmtMeanSd(r.pm25B.mean, r.pm25B.sd)}
      />
    ),
  },
  {
    key: "count",
    header: "Count",
    width: 70,
    render: (r) => `${r.pm25A.count}`,
  },
  {
    key: "ttest",
    header: "T-test p",
    width: 100,
    render: (r) =>
      r.abTTest ? (
        <Chip variant={r.abTTest.p < 0.05 ? "warning" : "success"}>
          {r.abTTest.p < 0.001 ? "<0.001" : r.abTTest.p.toFixed(4)}
        </Chip>
      ) : (
        "\u2014"
      ),
  },
];

export default function AnalyticsPage() {
  const { data: series } = useQuery({
    queryKey: ["analytics-series"],
    queryFn: () => getJson<PatSeries>("/api/pat?id=1001&aggregate=raw")
  });

  const [result, setResult] = useState<SohIndexResult | null>(null);
  const [richAgg, setRichAgg] = useState<RichAggregateSeries | null>(null);
  const [richLoading, setRichLoading] = useState(false);

  if (!series) {
    return <Loader message="Loading analytics..." />;
  }

  const localPreview = calculateSohIndex(series);

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow="Batch Analytics"
        title="Run QC and SoH workflows"
        subtitle="This page mirrors the API-driven analytics flow and shows the local shared-library preview alongside a server-calculated result."
      />

      <div className={styles.stats}>
        <StatCard label="Local preview index" value={`${localPreview.index}`} />
        <StatCard label="Days covered" value={`${localPreview.metrics.length}`} />
      </div>

      <Card title="Actions">
        <div className={styles.actions}>
          <Button
            onClick={async () => {
              const next = await postJson<SohIndexResult>("/api/soh/index", { series });
              setResult(next);
            }}
          >
            Compute SoH index from Worker
          </Button>
          <Button
            variant="secondary"
            onClick={async () => {
              const next = calculateSohIndex(runHourlyAbQc(series, { removeOutOfSpec: true }).cleanedSeries);
              setResult(next);
            }}
          >
            Compute SoH in shared layer
          </Button>
        </div>
      </Card>

      <Card title="Result">
        {result ? (
          <div className={styles.resultGrid}>
            <StatCard label="Index" value={`${result.index}`} tone={result.status === "excellent" ? "good" : "warn"} />
            <StatCard label="Status" value={result.status} />
            <StatCard label="Daily rows" value={`${result.metrics.length}`} />
          </div>
        ) : (
          <p className={styles.empty}>No result yet. Run one of the workflows above.</p>
        )}
      </Card>

      <Card title="Rich Aggregation">
        <div className={styles.actions}>
          <Button
            onClick={async () => {
              setRichLoading(true);
              try {
                const data = await postJson<RichAggregateSeries>(
                  "/api/aggregate/rich",
                  { series, intervalMinutes: 60 }
                );
                setRichAgg(data);
              } finally {
                setRichLoading(false);
              }
            }}
          >
            Show Rich Aggregation
          </Button>
        </div>
        {richLoading ? (
          <Loader message="Computing rich aggregation..." />
        ) : richAgg ? (
          <DataTable
            columns={richColumns}
            data={richAgg.points}
            rowKey={(r) => r.timestamp}
            emptyMessage="No aggregation data"
            footer={<span>{richAgg.points.length} time buckets</span>}
          />
        ) : (
          <p className={styles.empty}>Click the button above to compute hourly rich aggregation with A/B t-tests.</p>
        )}
      </Card>
    </div>
  );
}
