import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EChartsCoreOption } from "echarts/core";

import {
  pm25ToAqi,
  pm25ToAqiBand,
  type ComparisonResult,
  type PatSeries,
  type ReferenceObservationSeries,
} from "@patool/shared";

import { Card, CellStack, Chip, DataTable, Loader, PageHeader, StatCard } from "../components";
import type { Column } from "../components";
import { EChart } from "../components/EChart";
import { getJson } from "../lib/api";
import { useChartTheme } from "../hooks/useChartTheme";
import styles from "./ComparisonPage.module.css";

const DEFAULT_SENSOR_ID = "1001";
const DEFAULT_LATITUDE = 47.61702;
const DEFAULT_LONGITUDE = -122.343761;
const DEFAULT_START = "2018-08-01T07:00:00Z";
const DEFAULT_END = "2018-08-28T06:59:00Z";

type PairRow = ComparisonResult["pairs"][number];
type ConcentrationPair = PairRow & { sensorPm25Mean: number; referencePm25: number };

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hasReferencePm25(pair: PairRow): pair is ConcentrationPair {
  return isFiniteNumber(pair.sensorPm25Mean) && isFiniteNumber(pair.referencePm25);
}

function formatPm25(value: number | null | undefined): string {
  return isFiniteNumber(value) ? `${value.toFixed(1)} ug/m3` : "Unavailable";
}

function formatAqi(value: number | null | undefined): string {
  return isFiniteNumber(value) ? `${Math.round(value)}` : "Unavailable";
}

function formatSignedPm25(value: number | null): string {
  if (!isFiniteNumber(value)) return "Unavailable";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(1)} ug/m3`;
}

function formatCoordinate(value: number | undefined, fallback: number): string {
  return (value ?? fallback).toFixed(4);
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16).replace("T", " ");

  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sensorAqiFromPm25(value: number | null | undefined): number | null {
  return isFiniteNumber(value) ? pm25ToAqi(value) : null;
}

function aqiVariant(value: number | null | undefined): "default" | "success" | "warning" | "danger" | "accent" {
  if (!isFiniteNumber(value)) return "default";
  if (value <= 50) return "success";
  if (value <= 100) return "warning";
  if (value <= 150) return "accent";
  return "danger";
}

function referenceSourceName(reference: ReferenceObservationSeries | null | undefined): string {
  if (!reference) return "Reference";
  if (reference.source === "airnow") return "AirNow";
  if (reference.source === "aqs") return "AQS";
  if (reference.source === "openaq") return "OpenAQ";
  return "Static reference";
}

function buildReferenceComparePath(series: PatSeries): string {
  const params = new URLSearchParams({
    sensorId: series.meta.sensorId || DEFAULT_SENSOR_ID,
    latitude: String(series.meta.latitude ?? DEFAULT_LATITUDE),
    longitude: String(series.meta.longitude ?? DEFAULT_LONGITUDE),
    start: series.points[0]?.timestamp ?? DEFAULT_START,
    end: series.points.at(-1)?.timestamp ?? DEFAULT_END,
    source: "airnow",
  });

  return `/api/reference/compare?${params.toString()}`;
}

const pairColumns: Column<PairRow>[] = [
  {
    key: "timestamp",
    header: "Time",
    width: 150,
    render: (row) => <CellStack primary={formatTimestamp(row.timestamp)} sub={row.timestamp.slice(0, 10)} />,
  },
  {
    key: "purpleair",
    header: "PurpleAir PM2.5",
    width: 170,
    render: (row) => {
      const aqi = sensorAqiFromPm25(row.sensorPm25Mean);
      const band = pm25ToAqiBand(row.sensorPm25Mean);
      return (
        <CellStack
          primary={formatPm25(row.sensorPm25Mean)}
          sub={band.label === "Unavailable" ? `PurpleAir AQI ${formatAqi(aqi)}` : `PurpleAir AQI ${formatAqi(aqi)} ${band.label}`}
        />
      );
    },
  },
  {
    key: "referencePm25",
    header: "AirNow PM2.5",
    width: 150,
    render: (row) => <CellStack primary={formatPm25(row.referencePm25)} sub="Official/reference" />,
  },
  {
    key: "referenceAqi",
    header: "AirNow AQI",
    width: 120,
    render: (row) => (
      <Chip variant={aqiVariant(row.referenceAqi)}>
        {formatAqi(row.referenceAqi)}
      </Chip>
    ),
  },
  {
    key: "delta",
    header: "Ref - sensor",
    width: 120,
    render: (row) => {
      const delta = hasReferencePm25(row) ? row.referencePm25 - row.sensorPm25Mean : null;
      return formatSignedPm25(delta);
    },
  },
];

export default function ComparisonPage() {
  const ct = useChartTheme();

  const {
    data: series,
    isError: seriesIsError,
  } = useQuery({
    queryKey: ["comparison-series", DEFAULT_SENSOR_ID],
    queryFn: () => getJson<PatSeries>(`/api/pat?id=${DEFAULT_SENSOR_ID}&aggregate=raw`),
  });

  const referenceComparePath = useMemo(() => (series ? buildReferenceComparePath(series) : null), [series]);

  const {
    data: comparison,
    isError: comparisonIsError,
  } = useQuery({
    queryKey: ["reference-comparison", referenceComparePath],
    enabled: referenceComparePath !== null,
    queryFn: () => getJson<ComparisonResult>(referenceComparePath!),
  });

  const pairs = useMemo(() => comparison?.pairs ?? [], [comparison]);
  const concentrationPairs = useMemo(() => pairs.filter(hasReferencePm25), [pairs]);
  const recentPairs = useMemo(() => pairs.slice(-12).reverse(), [pairs]);
  const latestPair = useMemo(() => (
    [...pairs].reverse().find((pair) => (
      pair.sensorPm25Mean !== null || pair.referencePm25 !== null || pair.referenceAqi !== null
    )) ?? null
  ), [pairs]);

  const scatterOption = useMemo<EChartsCoreOption | null>(() => {
    if (!comparison || concentrationPairs.length === 0) return null;

    const scatterData = concentrationPairs.map((pair): [number, number, string] => [
      pair.sensorPm25Mean,
      pair.referencePm25,
      pair.timestamp,
    ]);
    const maxAxis = Math.max(5, ...scatterData.flatMap((point) => [point[0], point[1]])) * 1.1;
    const fitSeries = comparison.fit
      ? [{
        name: "Concentration fit",
        type: "line" as const,
        data: [
          [0, Math.max(0, comparison.fit.intercept)],
          [maxAxis, Math.max(0, comparison.fit.slope * maxAxis + comparison.fit.intercept)],
        ],
        color: ct.colors[2],
        lineStyle: { width: 2 },
        symbol: "none",
        smooth: false,
      }]
      : [];

    return {
      textStyle: { fontFamily: "Inter, sans-serif", color: ct.text },
      tooltip: {
        trigger: "item" as const,
        backgroundColor: ct.tooltipBg,
        borderColor: ct.tooltipBorder,
        textStyle: { color: ct.tooltipText },
        formatter: (params: { data?: unknown }) => {
          const point = params.data as [number, number, string] | undefined;
          if (!Array.isArray(point)) return "";
          return [
            formatTimestamp(point[2]),
            `PurpleAir PM2.5: ${formatPm25(point[0])}`,
            `${referenceSourceName(comparison.reference)} PM2.5: ${formatPm25(point[1])}`,
          ].join("<br/>");
        },
      },
      legend: { top: 0, textStyle: { color: ct.text, fontSize: 10 } },
      grid: { top: 36, right: 16, bottom: 44, left: 54 },
      xAxis: {
        type: "value" as const,
        name: "PurpleAir PM2.5",
        min: 0,
        max: maxAxis,
        nameTextStyle: { color: ct.axis, fontSize: 10 },
        axisLabel: { color: ct.axis, fontSize: 9 },
        splitLine: { lineStyle: { color: ct.grid } },
      },
      yAxis: {
        type: "value" as const,
        name: `${referenceSourceName(comparison.reference)} PM2.5`,
        min: 0,
        max: maxAxis,
        nameTextStyle: { color: ct.axis, fontSize: 10 },
        axisLabel: { color: ct.axis, fontSize: 9 },
        splitLine: { lineStyle: { color: ct.grid } },
      },
      series: [
        {
          name: "Paired PM2.5",
          type: "scatter" as const,
          data: scatterData,
          itemStyle: { color: ct.colors[1] },
          symbolSize: 5,
          large: true,
          largeThreshold: 500,
        },
        ...fitSeries,
      ],
    };
  }, [comparison, concentrationPairs, ct]);

  if (seriesIsError || comparisonIsError) {
    return (
      <div className={styles.layout}>
        <PageHeader
          eyebrow="Comparison"
          title="AirNow reference comparison"
          subtitle="PurpleAir sensor readings compared with official/reference AQI observations."
        />
        <Card title="Reference comparison unavailable">
          <p className={styles.empty}>
            The reference comparison API did not return data for this sensor and time range.
          </p>
        </Card>
      </div>
    );
  }

  if (!series || !comparison) {
    return <Loader message="Loading reference comparison..." />;
  }

  const reference = comparison.reference;
  const sourceName = referenceSourceName(reference);
  const latestSensorAqi = sensorAqiFromPm25(latestPair?.sensorPm25Mean);
  const latestSensorBand = pm25ToAqiBand(latestPair?.sensorPm25Mean);
  const latestReferenceAqi = latestPair?.referenceAqi ?? sensorAqiFromPm25(latestPair?.referencePm25);
  const latestReferenceBand = pm25ToAqiBand(latestPair?.referencePm25);

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow="Comparison"
        title="AirNow reference comparison"
        subtitle="PurpleAir sensor readings paired with official/reference PM2.5 and AQI observations for calibration review."
      />

      <p className={styles.disclosure}>
        <strong>AirNow AQI is official/reference.</strong> PurpleAir AQI is sensor-derived/corrected from the paired PM2.5 value and is shown only as a comparison aid.
      </p>

      <div className={styles.summaryGrid}>
        <Card className={styles.summaryCard}>
          <div className={styles.cardHeader}>
            <span className={styles.cardEyebrow}>PurpleAir sensor-derived/corrected</span>
            <Chip variant={aqiVariant(latestSensorAqi)}>AQI {formatAqi(latestSensorAqi)}</Chip>
          </div>
          <h2 className={styles.cardTitle}>{comparison.sensor.label}</h2>
          <dl className={styles.metaList}>
            <div>
              <dt>Sensor</dt>
              <dd>{comparison.sensor.sensorId}</dd>
            </div>
            <div>
              <dt>Coordinates</dt>
              <dd>{formatCoordinate(comparison.sensor.latitude, DEFAULT_LATITUDE)}, {formatCoordinate(comparison.sensor.longitude, DEFAULT_LONGITUDE)}</dd>
            </div>
            <div>
              <dt>Latest PM2.5</dt>
              <dd>{formatPm25(latestPair?.sensorPm25Mean)}</dd>
            </div>
            <div>
              <dt>AQI basis</dt>
              <dd>{latestSensorBand.label === "Unavailable" ? "Sensor PM2.5" : latestSensorBand.label}</dd>
            </div>
          </dl>
        </Card>

        <Card className={styles.summaryCard}>
          <div className={styles.cardHeader}>
            <span className={styles.cardEyebrow}>{sourceName} official/reference</span>
            <Chip variant={aqiVariant(latestReferenceAqi)}>AQI {formatAqi(latestReferenceAqi)}</Chip>
          </div>
          <h2 className={styles.cardTitle}>{reference?.label ?? "Reference unavailable"}</h2>
          <dl className={styles.metaList}>
            <div>
              <dt>Source</dt>
              <dd>{sourceName}{reference?.kind ? ` ${reference.kind}` : ""}</dd>
            </div>
            <div>
              <dt>Site</dt>
              <dd>{reference?.siteId ?? "Nearest available"}</dd>
            </div>
            <div>
              <dt>Latest PM2.5</dt>
              <dd>{formatPm25(latestPair?.referencePm25)}</dd>
            </div>
            <div>
              <dt>AQI category</dt>
              <dd>{latestReferenceBand.label === "Unavailable" ? "Official AQI" : latestReferenceBand.label}</dd>
            </div>
          </dl>
          {reference?.sourceUrl && (
            <a className={styles.sourceLink} href={reference.sourceUrl} target="_blank" rel="noreferrer">
              View source metadata
            </a>
          )}
        </Card>
      </div>

      <div className={styles.stats}>
        <StatCard label="Paired rows" value={`${pairs.length}`} />
        <StatCard label="PM2.5 fit rows" value={`${concentrationPairs.length}`} />
        <StatCard label="Fit slope" value={comparison.fit ? comparison.fit.slope.toFixed(3) : "Unavailable"} />
        <StatCard
          label="Fit R2"
          value={comparison.fit ? comparison.fit.rSquared.toFixed(3) : "Unavailable"}
          tone={comparison.fit && comparison.fit.rSquared >= 0.75 ? "good" : "neutral"}
        />
      </div>

      <Card title="Concentration fit">
        {scatterOption ? (
          <>
            <div className={styles.fitSummary}>
              <span>{sourceName} PM2.5 is plotted against paired PurpleAir PM2.5.</span>
              <span>{comparison.fit ? `n=${comparison.fit.n}, slope=${comparison.fit.slope.toFixed(3)}, R2=${comparison.fit.rSquared.toFixed(3)}` : "Not enough paired concentration values for a fit."}</span>
            </div>
            <EChart option={scatterOption} height={360} />
          </>
        ) : (
          <p className={styles.empty}>
            Reference PM2.5 concentrations are not available for this range, so the page shows AQI pairings only.
          </p>
        )}
      </Card>

      <Card title="Recent paired observations">
        <div className={styles.tableWrap}>
          <DataTable
            columns={pairColumns}
            data={recentPairs}
            rowKey={(row) => row.timestamp}
            emptyMessage="No paired observations returned"
            footer={<span>{recentPairs.length} latest rows from {pairs.length} total pairings</span>}
          />
        </div>
      </Card>

      {reference?.attribution && (
        <p className={styles.attribution}>{reference.attribution}</p>
      )}
    </div>
  );
}
