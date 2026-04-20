import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EChartsCoreOption } from "echarts/core";
import maplibregl from "maplibre-gl";

import { Card, Loader, PageHeader, StatCard } from "../components";
import { EChart } from "../components/EChart";
import { useChartTheme } from "../hooks/useChartTheme";
import { useTheme } from "../hooks/useTheme";
import { airFuseRawUrl, fetchAirFuseJson, fetchAirFuseText } from "./airfuse/api";
import { dailyAvailability, maxDateFromIndex, monthAvailability, resolveArtifactPath } from "./airfuse/artifacts";
import {
  AIRFUSE_FILL_LAYER_ID,
  AIRFUSE_LAYERS,
  AIRFUSE_SOURCE_REFERENCE,
  LAYER_OPTIONS,
  STYLE_DARK,
  STYLE_LIGHT,
} from "./airfuse/config";
import { escapeHtml, geoJsonBounds, geoJsonDescription, normalizeAirFuseGeoJson } from "./airfuse/geojson";
import { syncAirFuseLayer } from "./airfuse/mapLayer";
import { nowUtcInput, shiftUtcInput, timestampLabel } from "./airfuse/time";
import type { ActiveArtifact, AirFuseIndex, AirFuseLayerKey, ValidationResult } from "./airfuse/types";
import { calculateValidation, finiteNumber, parseCsv } from "./airfuse/validation";
import styles from "./AirFusePage.module.css";

import "maplibre-gl/dist/maplibre-gl.css";

export default function AirFusePage() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupBoundRef = useRef(false);
  const popupContextRef = useRef({ layerLabel: "AirFuse PM2.5", timestamp: timestampLabel(nowUtcInput()) });
  const [selectedLayer, setSelectedLayer] = useState<AirFuseLayerKey>("airfuse-pm25");
  const [utcValue, setUtcValue] = useState(nowUtcInput);
  const [timeTouched, setTimeTouched] = useState(false);
  const [activeGeoJson, setActiveGeoJson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [activeArtifact, setActiveArtifact] = useState<ActiveArtifact | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [artifactError, setArtifactError] = useState<string | null>(null);
  const [loadingArtifact, setLoadingArtifact] = useState(false);
  const [styleReloadTick, setStyleReloadTick] = useState(0);
  const { theme } = useTheme();
  const chartTheme = useChartTheme();

  const layer = AIRFUSE_LAYERS[selectedLayer];

  const { data: airFuseIndex, isLoading: indexLoading, error: indexError } = useQuery({
    queryKey: ["airfuse-index"],
    queryFn: () => fetchAirFuseJson<AirFuseIndex>("index.json"),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const indexedAvailability = useMemo(
    () => dailyAvailability(airFuseIndex, layer, utcValue),
    [airFuseIndex, layer, utcValue],
  );

  const calendarDays = useMemo(
    () => monthAvailability(airFuseIndex, layer, utcValue),
    [airFuseIndex, layer, utcValue],
  );

  const availableText = indexedAvailability == null
    ? "Index pending"
    : `${indexedAvailability}/${layer.expectedDailyCount}`;

  useEffect(() => {
    if (timeTouched) return;
    const latest = maxDateFromIndex(airFuseIndex, layer);
    if (latest) setUtcValue(latest);
  }, [airFuseIndex, layer, timeTouched]);

  useEffect(() => {
    popupContextRef.current = {
      layerLabel: layer.shortLabel,
      timestamp: activeArtifact?.timestamp ?? timestampLabel(utcValue),
    };
  }, [activeArtifact?.timestamp, layer.shortLabel, utcValue]);

  const loadArtifact = useCallback(async () => {
    const geojsonPath = resolveArtifactPath(airFuseIndex, layer, utcValue, "geojson");
    if (!geojsonPath) return;

    const csvPath = resolveArtifactPath(airFuseIndex, layer, utcValue, "csv") ?? undefined;
    const netcdfPath = resolveArtifactPath(airFuseIndex, layer, utcValue, "netcdf") ?? undefined;

    setLoadingArtifact(true);
    setArtifactError(null);
    setValidation(null);
    setValidationError(null);

    try {
      const rawGeoJson = await fetchAirFuseJson<unknown>(geojsonPath);
      const normalized = normalizeAirFuseGeoJson(rawGeoJson);
      const description = geoJsonDescription(rawGeoJson);
      setActiveGeoJson(normalized);
      setActiveArtifact({
        layer,
        timestamp: timestampLabel(utcValue),
        geojsonPath,
        csvPath,
        netcdfPath,
        featureCount: normalized.features.length,
        description,
      });

      const bounds = geoJsonBounds(normalized);
      if (bounds && mapRef.current) {
        mapRef.current.fitBounds(bounds, { padding: 32, duration: 0, maxZoom: 5.5 });
      }

      if (csvPath && layer.observedColumn && layer.predictedColumn) {
        try {
          const csv = await fetchAirFuseText(csvPath);
          const parsed = calculateValidation(parseCsv(csv), layer);
          setValidation(parsed);
          if (!parsed) setValidationError("Validation CSV did not include the expected columns.");
        } catch (err) {
          setValidationError(err instanceof Error ? err.message : "Validation CSV is unavailable.");
        }
      }
    } catch (err) {
      setActiveGeoJson(null);
      setActiveArtifact(null);
      setArtifactError(err instanceof Error ? err.message : "AirFuse artifact is unavailable.");
    } finally {
      setLoadingArtifact(false);
    }
  }, [airFuseIndex, layer, utcValue]);

  useEffect(() => {
    void loadArtifact();
  }, [loadArtifact]);

  const bindPopup = useCallback((map: maplibregl.Map) => {
    if (popupBoundRef.current) return;
    popupBoundRef.current = true;

    map.on("click", AIRFUSE_FILL_LAYER_ID, (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      const properties = feature.properties as Record<string, unknown>;
      const label = properties.displayName ?? properties.Name ?? "AirFuse surface";
      const aqic = finiteNumber(String(properties.AQIC ?? ""));
      const context = popupContextRef.current;
      new maplibregl.Popup({ offset: 10 })
        .setLngLat(event.lngLat)
        .setHTML(
          `<strong>${escapeHtml(label)}</strong><br/>`
          + `${aqic == null ? "" : `AQI midpoint: ${escapeHtml(aqic.toFixed(1))}<br/>`}`
          + `${escapeHtml(context.layerLabel)} / ${escapeHtml(context.timestamp)}`,
        )
        .addTo(map);
    });

    map.on("mouseenter", AIRFUSE_FILL_LAYER_ID, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", AIRFUSE_FILL_LAYER_ID, () => {
      map.getCanvas().style.cursor = "";
    });
  }, []);

  useEffect(() => {
    const node = containerRef.current;
    if (!node || mapRef.current) return;

    const map = new maplibregl.Map({
      container: node,
      style: theme === "dark" ? STYLE_DARK : STYLE_LIGHT,
      center: [-97, 39],
      zoom: 3.25,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.on("load", () => {
      setStyleReloadTick((tick) => tick + 1);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      popupBoundRef.current = false;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.once("styledata", () => {
      setStyleReloadTick((tick) => tick + 1);
    });
    map.setStyle(theme === "dark" ? STYLE_DARK : STYLE_LIGHT, { diff: true });
  }, [theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !activeGeoJson || !map.isStyleLoaded()) return;
    syncAirFuseLayer(map, activeGeoJson);
    bindPopup(map);
  }, [activeGeoJson, bindPopup, styleReloadTick]);

  const validationOption = useMemo<EChartsCoreOption | null>(() => {
    if (!validation) return null;
    const regressionEnd = validation.slope * validation.maxAxis + validation.intercept;
    return {
      color: [chartTheme.colors[0], chartTheme.colors[2], chartTheme.colors[3]],
      backgroundColor: "transparent",
      tooltip: {
        trigger: "item",
        backgroundColor: chartTheme.tooltipBg,
        borderColor: chartTheme.tooltipBorder,
        textStyle: { color: chartTheme.tooltipText },
      },
      grid: { left: 54, right: 20, top: 16, bottom: 48 },
      xAxis: {
        type: "value",
        name: `Observed ${layer.unit}`,
        nameLocation: "middle",
        nameGap: 30,
        min: 0,
        max: validation.maxAxis,
        axisLine: { lineStyle: { color: chartTheme.axis } },
        axisLabel: { color: chartTheme.text },
        splitLine: { lineStyle: { color: chartTheme.grid } },
      },
      yAxis: {
        type: "value",
        name: `Modeled ${layer.unit}`,
        nameLocation: "middle",
        nameGap: 38,
        min: 0,
        max: validation.maxAxis,
        axisLine: { lineStyle: { color: chartTheme.axis } },
        axisLabel: { color: chartTheme.text },
        splitLine: { lineStyle: { color: chartTheme.grid } },
      },
      series: [
        {
          type: "scatter",
          name: "Monitor pairs",
          symbolSize: 4,
          data: validation.points,
        },
        {
          type: "line",
          name: "1:1",
          showSymbol: false,
          data: [[0, 0], [validation.maxAxis, validation.maxAxis]],
          lineStyle: { type: "dashed", width: 1.5 },
        },
        {
          type: "line",
          name: "Regression",
          showSymbol: false,
          data: [[0, validation.intercept], [validation.maxAxis, regressionEnd]],
          lineStyle: { width: 2 },
        },
      ],
    };
  }, [chartTheme, layer.unit, validation]);

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow="AirFuse"
        title="AirFuse surface viewer"
        subtitle="Client viewer for AirFuse and GOES static artifacts through the PAtool serverless API surface."
      />

      <div className={styles.controls}>
        <select
          className={styles.select}
          value={selectedLayer}
          onChange={(event) => {
            setSelectedLayer(event.target.value as AirFuseLayerKey);
            setTimeTouched(false);
          }}
          aria-label="AirFuse layer"
        >
          {LAYER_OPTIONS.map((option) => (
            <option key={option.key} value={option.key}>{option.label}</option>
          ))}
        </select>

        <button className={styles.iconButton} type="button" onClick={() => { setTimeTouched(true); setUtcValue((value) => shiftUtcInput(value, -24)); }} title="Previous day" aria-label="Previous day">
          {"<<"}
        </button>
        <button className={styles.iconButton} type="button" onClick={() => { setTimeTouched(true); setUtcValue((value) => shiftUtcInput(value, -1)); }} title="Previous hour" aria-label="Previous hour">
          {"<"}
        </button>
        <input
          className={styles.datetime}
          type="datetime-local"
          value={utcValue}
          step={3600}
          onChange={(event) => {
            setTimeTouched(true);
            setUtcValue(event.target.value);
          }}
          aria-label="UTC time"
        />
        <button className={styles.iconButton} type="button" onClick={() => { setTimeTouched(true); setUtcValue((value) => shiftUtcInput(value, 1)); }} title="Next hour" aria-label="Next hour">
          {">"}
        </button>
        <button className={styles.iconButton} type="button" onClick={() => { setTimeTouched(true); setUtcValue((value) => shiftUtcInput(value, 24)); }} title="Next day" aria-label="Next day">
          {">>"}
        </button>
        <button className={styles.button} type="button" onClick={() => void loadArtifact()}>
          Refresh
        </button>
      </div>

      {indexError && (
        <div className={styles.warning}>
          AirFuse index is unavailable through the configured proxy. Deploy the Worker or set VITE_AIRFUSE_API_BASE to a serverless proxy URL.
        </div>
      )}

      <div className={styles.stats}>
        <StatCard label="Layer" value={layer.shortLabel} />
        <StatCard label="UTC hour" value={timestampLabel(utcValue)} />
        <StatCard label="Daily artifacts" value={indexLoading ? "..." : availableText} />
        <StatCard label="Features" value={activeArtifact ? `${activeArtifact.featureCount}` : "..."} />
      </div>

      <div className={styles.mainGrid}>
        <section className={styles.mapPanel}>
          <div className={styles.mapToolbar}>
            <span className={styles.statusPill}>{loadingArtifact ? "Loading" : activeArtifact ? "Loaded" : "Waiting"}</span>
            <span className={styles.timestamp}>{activeArtifact?.timestamp ?? timestampLabel(utcValue)}</span>
          </div>
          <div ref={containerRef} className={styles.map} />
          {artifactError && <div className={styles.mapError}>{artifactError}</div>}
        </section>

        <aside className={styles.sidePanel}>
          <Card title="Artifacts">
            {activeArtifact ? (
              <div className={styles.linkList}>
                <a href={airFuseRawUrl(activeArtifact.geojsonPath)} target="_blank" rel="noreferrer">GeoJSON surface</a>
                {activeArtifact.csvPath && <a href={airFuseRawUrl(activeArtifact.csvPath)} target="_blank" rel="noreferrer">Validation CSV</a>}
                {activeArtifact.netcdfPath && <a href={airFuseRawUrl(activeArtifact.netcdfPath)} target="_blank" rel="noreferrer">NetCDF result</a>}
              </div>
            ) : (
              <p className={styles.empty}>No artifact loaded.</p>
            )}
          </Card>

          <Card title="Month Coverage">
            <div className={styles.calendar}>
              {calendarDays.map((day) => {
                const complete = day.count >= layer.expectedDailyCount;
                const partial = day.count > 0 && !complete;
                return (
                  <span
                    key={day.day}
                    className={`${styles.dayCell} ${complete ? styles.dayComplete : partial ? styles.dayPartial : styles.dayMissing}`}
                    title={`${day.count}/${layer.expectedDailyCount} artifacts`}
                  >
                    <span>{day.day}</span>
                    <strong>{day.count}</strong>
                  </span>
                );
              })}
            </div>
          </Card>

          <Card title="Source Reference">
            <div className={styles.reference}>
              <span>Ported from AirFuse example viewer</span>
              <code>{AIRFUSE_SOURCE_REFERENCE.localPath}</code>
              <code>{AIRFUSE_SOURCE_REFERENCE.example}</code>
              <a href={AIRFUSE_SOURCE_REFERENCE.upstream} target="_blank" rel="noreferrer">Upstream repository</a>
            </div>
          </Card>
        </aside>
      </div>

      <div className={styles.validationGrid}>
        <Card title="Validation Scatter">
          {loadingArtifact ? (
            <Loader message="Loading validation..." />
          ) : validation && validationOption ? (
            <EChart option={validationOption} height={340} />
          ) : (
            <p className={styles.empty}>{validationError ?? "Validation is not available for this layer/hour."}</p>
          )}
        </Card>

        <Card title="Validation Metrics">
          {validation ? (
            <div className={styles.metricGrid}>
              <span className={styles.metric}><small>Pairs</small><strong>{validation.n}</strong></span>
              <span className={styles.metric}><small>RMSE</small><strong>{validation.rmse.toFixed(2)}</strong></span>
              <span className={styles.metric}><small>Bias</small><strong>{validation.bias.toFixed(2)}</strong></span>
              <span className={styles.metric}><small>r</small><strong>{validation.r.toFixed(2)}</strong></span>
              <span className={styles.metric}><small>Slope</small><strong>{validation.slope.toFixed(2)}</strong></span>
              <span className={styles.metric}><small>MAE</small><strong>{validation.mae.toFixed(2)}</strong></span>
            </div>
          ) : (
            <p className={styles.empty}>No validation metrics loaded.</p>
          )}
        </Card>
      </div>

      {activeArtifact?.description && (
        <Card title="Artifact Description">
          <p className={styles.description}>{activeArtifact.description}</p>
        </Card>
      )}
    </div>
  );
}
