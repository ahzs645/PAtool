import { useMemo, useState } from "react";

import {
  aggregateMobilePoints,
  buildHistogram,
  buildMobileCalendar,
  buildRouteSegments,
  findNearestReferenceMonitor,
  findReferenceMonitorsWithinRadius,
  parseAirBeamCsv,
  summarizeDistribution,
  summarizeMobileCampaign,
  temporallyAdjustMobilePoints,
  type MobileAggregation,
  type MobileSensingPoint,
  type MobileSessionSummary,
  type ReferenceMonitorMatch,
  type RouteSegmentSummary,
} from "@patool/shared";

import { Button, Card, CellStack, DataTable, PageHeader, StatCard, type Column } from "../components";
import { EChart } from "../components/EChart";
import { downloadCsv, objectsToCsv, suggestFilename } from "../lib/exporters";
import { calendarOption, campaignTimeSeriesOption, histogramOption, segmentOption } from "./mobileCampaigns/chartOptions";
import { SAMPLE_AIRBEAM_CSV, SAMPLE_REFERENCE_MONITORS, SAMPLE_REFERENCE_OBSERVATIONS } from "./mobileCampaigns/sampleData";
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

  const rawPoints = useMemo(() => parseAirBeamCsv(csvText, { sourceId, fallbackSessionId: sourceId }), [csvText, sourceId]);
  const sessions = useMemo(() => ["All", ...new Set(rawPoints.map((point) => point.sessionId))], [rawPoints]);
  const selectedRawPoints = useMemo(
    () => selectedSession === "All" ? rawPoints : rawPoints.filter((point) => point.sessionId === selectedSession),
    [rawPoints, selectedSession],
  );
  const points = useMemo(() => aggregateMobilePoints(selectedRawPoints, aggregation), [selectedRawPoints, aggregation]);
  const summary = useMemo(() => summarizeMobileCampaign(points), [points]);
  const distribution = useMemo(() => summarizeDistribution(points.map((point) => point.pm25)), [points]);
  const histogram = useMemo(() => buildHistogram(points.map((point) => point.pm25), 10), [points]);
  const calendar = useMemo(() => buildMobileCalendar(points), [points]);
  const nearestMonitor = useMemo(() => findNearestReferenceMonitor(points, SAMPLE_REFERENCE_MONITORS), [points]);
  const nearbyMonitors = useMemo(() => findReferenceMonitorsWithinRadius(points, SAMPLE_REFERENCE_MONITORS, 20), [points]);
  const adjusted = useMemo(() => temporallyAdjustMobilePoints(points, SAMPLE_REFERENCE_OBSERVATIONS, "1hr"), [points]);
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
            onClick={() => {
              setSourceId("demo-airbeam");
              setSelectedSession("All");
              setAggregation("1min");
              setCsvText(SAMPLE_AIRBEAM_CSV);
            }}
          >
            Load demo
          </Button>
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
      </Card>

      <div className={styles.split}>
        <Card title="Route map">
          <RouteMap points={points} monitors={nearbyMonitors} />
          <p className={styles.note}>
            The route layer uses the normalized mobile schema, so AirBeam, OpenAQ walks, vehicle transects, or future PurpleAir mobile data can share this view.
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
          The adjusted series follows the AirBeamR period-ratio method: reference period value divided by the reference period mean, then mobile PM2.5 divided by that ratio.
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

function RouteMap({ points, monitors }: { points: MobileSensingPoint[]; monitors: ReferenceMonitorMatch[] }) {
  const bounds = getBounds(points, monitors);
  const projected = points.map((point) => project(point.latitude, point.longitude, bounds));

  return (
    <div className={styles.mapPanel}>
      <svg className={styles.routeSvg} viewBox="0 0 100 100" role="img" aria-label="Mobile route map">
        {projected.slice(1).map((point, index) => {
          const previous = projected[index];
          const pm25 = points[index + 1].pm25;
          return (
            <line
              key={`${points[index + 1].id}-line`}
              x1={previous.x}
              y1={previous.y}
              x2={point.x}
              y2={point.y}
              stroke={pmColor(pm25)}
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          );
        })}
        {projected.map((point, index) => (
          <circle key={points[index].id} cx={point.x} cy={point.y} r="1.4" fill={pmColor(points[index].pm25)} />
        ))}
        {monitors.map((match) => {
          const point = project(match.monitor.latitude, match.monitor.longitude, bounds);
          const labelOnLeft = point.x > 74;
          return (
            <g key={match.monitor.id}>
              <circle cx={point.x} cy={point.y} r="2.2" fill="var(--surface)" stroke="var(--text-primary)" strokeWidth="0.7" />
              <text
                x={labelOnLeft ? point.x - 2.8 : point.x + 2.8}
                y={point.y + 1.2}
                fontSize="3"
                fill="var(--text-secondary)"
                textAnchor={labelOnLeft ? "end" : "start"}
              >
                {shortLabel(match.monitor.name)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className={styles.mapLegend}>
        <span className={styles.legendSwatch} />
        <span>Lower to higher PM2.5</span>
      </div>
    </div>
  );
}

function getBounds(points: MobileSensingPoint[], monitors: ReferenceMonitorMatch[]) {
  const latitudes = [...points.map((point) => point.latitude), ...monitors.map((match) => match.monitor.latitude)];
  const longitudes = [...points.map((point) => point.longitude), ...monitors.map((match) => match.monitor.longitude)];
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLon = Math.min(...longitudes);
  const maxLon = Math.max(...longitudes);
  return {
    minLat: Number.isFinite(minLat) ? minLat : 0,
    maxLat: Number.isFinite(maxLat) ? maxLat : 1,
    minLon: Number.isFinite(minLon) ? minLon : 0,
    maxLon: Number.isFinite(maxLon) ? maxLon : 1,
  };
}

function project(latitude: number, longitude: number, bounds: ReturnType<typeof getBounds>) {
  const xRange = Math.max(0.000001, bounds.maxLon - bounds.minLon);
  const yRange = Math.max(0.000001, bounds.maxLat - bounds.minLat);
  return {
    x: 6 + ((longitude - bounds.minLon) / xRange) * 88,
    y: 94 - ((latitude - bounds.minLat) / yRange) * 88,
  };
}

function pmColor(pm25: number) {
  if (pm25 <= 12) return "#3aa76d";
  if (pm25 <= 35) return "#d6a100";
  if (pm25 <= 55) return "#d96c2c";
  if (pm25 <= 150) return "#cf3f4b";
  return "#7c4bb7";
}

function shortLabel(label: string): string {
  return label.length > 18 ? `${label.slice(0, 17)}...` : label;
}

function formatNumber(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(1) : "-";
}
