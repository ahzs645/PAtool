import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  aggregateMobilePoints,
  buildHistogram,
  buildMobileCalendar,
  buildRouteSegments,
  cleanMobilePoints,
  findNearestReferenceMonitor,
  findReferenceMonitorsWithinRadius,
  parseAirBeamCsv,
  summarizeDistribution,
  summarizeMobileCampaign,
  temporallyAdjustMobilePoints,
  type MobileAggregation,
  type MobileSessionSummary,
  type PasCollection,
  type PatSeries,
  type ReferenceMonitorMatch,
  type RouteSegmentSummary,
} from "@patool/shared";

import { Button, Card, CellStack, DataTable, PageHeader, StatCard, type Column } from "../components";
import { EChart } from "../components/EChart";
import { getJson } from "../lib/api";
import { downloadCsv, objectsToCsv, suggestFilename } from "../lib/exporters";
import { calendarOption, campaignTimeSeriesOption, histogramOption, segmentOption } from "./mobileCampaigns/chartOptions";
import { RouteMap } from "./mobileCampaigns/RouteMap";
import {
  buildSnapshotReferenceObservations,
  hasTemporalOverlap,
  pasCollectionToReferenceMonitors,
  patSeriesToReferenceObservations,
} from "./mobileCampaigns/referenceAdapters";
import { loadBundledCampaignCsv, SAMPLE_AIRBEAM_CSV, SAMPLE_REFERENCE_MONITORS, SAMPLE_REFERENCE_OBSERVATIONS } from "./mobileCampaigns/sampleData";
import styles from "./MobileCampaignsPage.module.css";

const AGGREGATIONS: MobileAggregation[] = ["raw", "1min", "1hr", "1day"];

const sessionColumns: Column<MobileSessionSummary>[] = [
  { key: "session", header: "Session", width: 170, render: (row) => row.sessionId, sortable: true },
  { key: "points", header: "Points", width: 90, render: (row) => row.pointCount, sortable: true },
  { key: "mean", header: "Mean PM2.5", width: 120, render: (row) => formatNumber(row.pm25Mean), sortable: true, sortValue: (row) => row.pm25Mean },
  { key: "p95", header: "P95", width: 90, render: (row) => formatNumber(row.pm25P95), sortable: true, sortValue: (row) => row.pm25P95 },
  { key: "distance", header: "Distance", width: 100, render: (row) => `${row.distanceKm.toFixed(2)} km`, sortable: true, sortValue: (row) => row.distanceKm },
];

const segmentColumns: Column<RouteSegmentSummary>[] = [
  { key: "segment", header: "Segment", width: 130, render: (row) => row.segmentId, sortable: true },
  { key: "session", header: "Session", width: 160, render: (row) => row.sessionId, sortable: true },
  { key: "mean", header: "Mean PM2.5", width: 120, render: (row) => row.pm25Mean.toFixed(1), sortable: true, sortValue: (row) => row.pm25Mean },
  { key: "max", header: "Max", width: 90, render: (row) => row.pm25Max.toFixed(1), sortable: true, sortValue: (row) => row.pm25Max },
  { key: "distance", header: "Distance", width: 100, render: (row) => `${row.distanceKm.toFixed(2)} km`, sortable: true, sortValue: (row) => row.distanceKm },
];

const monitorColumns: Column<ReferenceMonitorMatch>[] = [
  { key: "name", header: "Monitor", width: 168, render: (row) => <CellStack primary={row.monitor.name} sub={row.monitor.source ?? "reference"} />, sortable: true, sortValue: (row) => row.monitor.name },
  { key: "distance", header: "Distance", width: 92, render: (row) => `${row.distanceKm.toFixed(2)} km`, sortable: true, sortValue: (row) => row.distanceKm },
  { key: "pm25", header: "PM2.5", width: 72, render: (row) => formatNumber(row.monitor.pm25), sortable: true, sortValue: (row) => row.monitor.pm25 },
];

export default function MobileCampaignsPage() {
  const [csvText, setCsvText] = useState(SAMPLE_AIRBEAM_CSV);
  const [sourceId, setSourceId] = useState("demo-airbeam");
  const [selectedSession, setSelectedSession] = useState("All");
  const [aggregation, setAggregation] = useState<MobileAggregation>("1min");
  const [qcEnabled, setQcEnabled] = useState(true);
  const [maxGpsAccuracy, setMaxGpsAccuracy] = useState(100);
  const [maxSpeed, setMaxSpeed] = useState(45);

  const { data: pasCollection } = useQuery({
    queryKey: ["mobile-campaign-reference-monitors"],
    queryFn: () => getJson<PasCollection>("/api/pas"),
  });

  const rawPoints = useMemo(() => parseAirBeamCsv(csvText, { sourceId, fallbackSessionId: sourceId }), [csvText, sourceId]);
  const qcResult = useMemo(
    () => cleanMobilePoints(rawPoints, { maxGpsAccuracyMeters: maxGpsAccuracy, maxSpeedMetersPerSecond: maxSpeed }),
    [rawPoints, maxGpsAccuracy, maxSpeed],
  );
  const cleanRawPoints = qcEnabled ? qcResult.cleanedPoints : rawPoints;
  const sessions = useMemo(() => ["All", ...new Set(rawPoints.map((point) => point.sessionId))], [rawPoints]);
  const selectedRawPoints = useMemo(
    () => selectedSession === "All" ? cleanRawPoints : cleanRawPoints.filter((point) => point.sessionId === selectedSession),
    [cleanRawPoints, selectedSession],
  );
  const points = useMemo(() => aggregateMobilePoints(selectedRawPoints, aggregation), [selectedRawPoints, aggregation]);
  const summary = useMemo(() => summarizeMobileCampaign(points), [points]);
  const distribution = useMemo(() => summarizeDistribution(points.map((point) => point.pm25)), [points]);
  const histogram = useMemo(() => buildHistogram(points.map((point) => point.pm25), 10), [points]);
  const calendar = useMemo(() => buildMobileCalendar(points), [points]);
  const referenceMonitors = useMemo(
    () => pasCollection ? pasCollectionToReferenceMonitors(pasCollection) : SAMPLE_REFERENCE_MONITORS,
    [pasCollection],
  );
  const nearestMonitor = useMemo(() => findNearestReferenceMonitor(points, referenceMonitors), [points, referenceMonitors]);
  const nearbyMonitors = useMemo(() => findReferenceMonitorsWithinRadius(points, referenceMonitors, 20), [points, referenceMonitors]);
  const { data: nearestReferenceSeries } = useQuery({
    queryKey: ["mobile-campaign-reference-series", nearestMonitor?.monitor.id],
    queryFn: () => getJson<PatSeries>(`/api/pat?id=${encodeURIComponent(nearestMonitor!.monitor.id)}&aggregate=hourly`),
    enabled: Boolean(nearestMonitor?.monitor.id),
  });
  const referenceObservations = useMemo(() => {
    const fromSeries = nearestReferenceSeries ? patSeriesToReferenceObservations(nearestReferenceSeries) : [];
    if (hasTemporalOverlap(points, fromSeries)) return fromSeries;
    const snapshotRows = buildSnapshotReferenceObservations(points, nearestMonitor?.monitor ?? null);
    if (snapshotRows.length) return snapshotRows;
    return SAMPLE_REFERENCE_OBSERVATIONS;
  }, [nearestMonitor, nearestReferenceSeries, points]);
  const adjusted = useMemo(() => temporallyAdjustMobilePoints(points, referenceObservations, "1hr"), [points, referenceObservations]);
  const segments = useMemo(() => buildRouteSegments(points, { targetDistanceKm: 0.12 }), [points]);

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow="Mobile Campaigns"
        title="Analyze mobile PM2.5 routes and reference monitors"
        subtitle="Upload AirBeam-style CSVs or use the demo campaign. The workflow is source-agnostic: normalize, aggregate, map, compare, adjust, and export."
      />

      <div className={styles.stats}>
        <StatCard label="Sessions" value={`${summary.sessionCount}`} />
        <StatCard label="Points" value={`${summary.pointCount}`} />
        <StatCard label="Mean PM2.5" value={formatNumber(summary.pm25Mean)} />
        <StatCard label="P95 PM2.5" value={formatNumber(summary.pm25P95)} />
        <StatCard label="Route distance" value={`${summary.distanceKm.toFixed(2)} km`} />
        <StatCard label="Nearest monitor" value={nearestMonitor ? `${nearestMonitor.distanceKm.toFixed(1)} km` : "None"} />
        <StatCard label="QC removed" value={`${qcEnabled ? qcResult.removedPoints : 0}`} tone={qcResult.removedPoints > 0 ? "warn" : "good"} />
      </div>

      <Card title="Campaign input">
        <div className={styles.controls}>
          <label className={styles.field}>
            <span>AirBeam CSV</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                setSourceId(file.name.replace(/\.csv$/i, ""));
                setSelectedSession("All");
                setCsvText(await file.text());
              }}
            />
          </label>
          <label className={styles.field}>
            <span>Session</span>
            <select value={selectedSession} onChange={(event) => setSelectedSession(event.target.value)}>
              {sessions.map((session) => <option key={session} value={session}>{session}</option>)}
            </select>
          </label>
          <label className={styles.field}>
            <span>Aggregation</span>
            <select value={aggregation} onChange={(event) => setAggregation(event.target.value as MobileAggregation)}>
              {AGGREGATIONS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <Button
            variant="secondary"
            onClick={async () => {
              setSourceId("demo-airbeam");
              setSelectedSession("All");
              setAggregation("1min");
              setCsvText(await loadBundledCampaignCsv());
            }}
          >
            Load demo
          </Button>
          <label className={styles.field}>
            <span>QC</span>
            <select value={qcEnabled ? "on" : "off"} onChange={(event) => setQcEnabled(event.target.value === "on")}>
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Max GPS accuracy (m)</span>
            <input type="number" min={1} value={maxGpsAccuracy} onChange={(event) => setMaxGpsAccuracy(Math.max(1, Number(event.target.value) || 100))} />
          </label>
          <label className={styles.field}>
            <span>Max speed (m/s)</span>
            <input type="number" min={1} value={maxSpeed} onChange={(event) => setMaxSpeed(Math.max(1, Number(event.target.value) || 45))} />
          </label>
          <Button
            variant="secondary"
            disabled={points.length === 0}
            onClick={() => downloadCsv(suggestFilename(`mobile-campaign-${sourceId}`, "csv"), objectsToCsv(points))}
          >
            Export points
          </Button>
          <Button
            variant="secondary"
            disabled={adjusted.length === 0}
            onClick={() => downloadCsv(suggestFilename(`mobile-campaign-${sourceId}-adjusted`, "csv"), objectsToCsv(adjusted))}
          >
            Export adjusted
          </Button>
        </div>
        {qcEnabled && qcResult.issues.length > 0 && (
          <div className={styles.issueList}>
            {qcResult.issues.map((issue) => (
              <span className={styles.issue} key={issue.code}>{issue.count} {issue.message}</span>
            ))}
          </div>
        )}
      </Card>

      <div className={styles.split}>
        <Card title="Route map">
          <RouteMap points={points} monitors={nearbyMonitors} />
          <p className={styles.note}>
            The MapLibre route layer uses the normalized mobile schema, so AirBeam, OpenAQ walks, vehicle transects, or future PurpleAir mobile data can share this view.
          </p>
        </Card>

        <Card title="Reference monitors within 20 km">
          <DataTable
            columns={monitorColumns}
            data={nearbyMonitors}
            rowKey={(row) => row.monitor.id}
            emptyMessage="No reference monitors near this campaign."
            pageSize={5}
          />
        </Card>
      </div>

      <Card title="Sensor vs adjusted reference-normalized PM2.5">
        <EChart option={campaignTimeSeriesOption(points, adjusted)} height={340} zoomable />
        <p className={styles.note}>
          The adjusted series follows the AirBeamR period-ratio method. Reference observations come from the nearest loaded network monitor when available, with demo fallback rows for the bundled campaign.
        </p>
      </Card>

      <div className={styles.cardsGrid}>
        <Card title="Distribution">
          <EChart option={histogramOption(histogram)} height={280} />
          <div className={styles.miniStats}>
            <StatCard label="Median" value={formatNumber(distribution.median)} />
            <StatCard label="IQR" value={`${formatNumber(distribution.q1)}-${formatNumber(distribution.q3)}`} />
          </div>
        </Card>

        <Card title="Daily calendar">
          <EChart option={calendarOption(calendar)} height={280} />
          <p className={styles.note}>Daily cells use PM2.5 AQI-style categories from the AirBeamR calendar concept.</p>
        </Card>

        <Card title="Route segments">
          <EChart option={segmentOption(segments)} height={280} />
          <DataTable
            columns={segmentColumns}
            data={segments}
            rowKey={(row) => row.segmentId}
            emptyMessage="No route segments."
            pageSize={5}
          />
        </Card>
      </div>

      <Card title="Session summaries">
        <DataTable
          columns={sessionColumns}
          data={summary.sessions}
          rowKey={(row) => row.sessionId}
          emptyMessage="No sessions parsed from the CSV."
          pageSize={8}
        />
      </Card>
    </div>
  );
}

function formatNumber(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(1) : "-";
}
