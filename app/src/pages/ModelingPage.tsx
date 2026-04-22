import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  combineWeightedStudyGrids,
  computeObservedStudyGrid,
  createStudyAreaFromSensors,
  deriveStudyBoundsFromSources,
  gridToImageData,
  normalizeStudyGrid,
  pasFilter,
  pasFilterArea,
  rankSensorSitingCandidates,
  rasterizeSourceLayer,
  validateStudyGrid,
  type PasCollection,
  type SensorSitingCandidate,
  type SourceDispersionConfig,
  type SourceLayerConfig,
  type StudyGeometryKind,
  type StudyRasterGrid,
  type StudySensorValueField,
  type StudySourceFeatureCollection,
} from "@patool/shared";

import { Button, Card, Loader, PageHeader, StatCard } from "../components";
import { getJson } from "../lib/api";
import { REFERENCE_DIAGRAMS, REFERENCE_DIAGRAM_SOURCE, type ReferenceDiagram } from "./modeling/referenceDiagrams";
import styles from "./ModelingPage.module.css";

type LoadedSourceLayer = {
  config: SourceLayerConfig;
  data: StudySourceFeatureCollection;
  sourceLabel: string;
};

type SourceDraft = {
  name: string;
  kind: StudyGeometryKind;
  valueField: string;
  weight: number;
  method: SourceDispersionConfig["method"];
  sigmaMeters: number;
  radiusMeters: number;
  url: string;
};

const sensorWindowOptions: Array<{ value: StudySensorValueField; label: string }> = [
  { value: "pm25Current", label: "Current" },
  { value: "pm25_10min", label: "10 min" },
  { value: "pm25_30min", label: "30 min" },
  { value: "pm25_1hr", label: "1 hr" },
  { value: "pm25_6hr", label: "6 hr" },
  { value: "pm25_1day", label: "1 day" },
  { value: "pm25_1week", label: "1 week" },
];

const defaultDraft: SourceDraft = {
  name: "Traffic exposure",
  kind: "line",
  valueField: "aadt",
  weight: 0.5,
  method: "gaussian",
  sigmaMeters: 1_500,
  radiusMeters: 5_000,
  url: "",
};

const MAX_MODEL_GRID_CELLS = 28_000;

function docsUrl(fileName: string): string {
  return new URL(`docs/${fileName}`, document.baseURI).toString();
}

export default function ModelingPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [resolutionMeters, setResolutionMeters] = useState(1_000);
  const [outsideOnly, setOutsideOnly] = useState(true);
  const [sensorValueField, setSensorValueField] = useState<StudySensorValueField>("pm25_1hr");
  const [draft, setDraft] = useState<SourceDraft>(defaultDraft);
  const [sourceLayers, setSourceLayers] = useState<LoadedSourceLayer[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["modeling-pas"],
    queryFn: () => getJson<PasCollection>("/api/pas"),
  });

  const study = useMemo(() => {
    if (!data) return null;
    const baseStudy = createStudyAreaFromSensors(data, {
      resolutionMeters,
      sensorFilters: outsideOnly ? { isOutside: true } : {},
      sensorValueField,
    });
    const sourceBounds = deriveStudyBoundsFromSources(sourceLayers.map((source) => source.data));
    return sourceBounds ? { ...baseStudy, bounds: sourceBounds } : baseStudy;
  }, [data, outsideOnly, resolutionMeters, sensorValueField, sourceLayers]);

  const filtered = useMemo(() => {
    if (!data || !study) return null;
    const filteredBySensor = pasFilter(data, study.sensorFilters ?? {});
    return study.bounds ? pasFilterArea(filteredBySensor, study.bounds) : filteredBySensor;
  }, [data, study]);

  const observedGrid = useMemo(() => {
    if (!data || !study?.bounds) return null;
    return computeObservedStudyGrid(data, study, { maxCells: MAX_MODEL_GRID_CELLS });
  }, [data, resolutionMeters, study]);

  const sourceResults = useMemo(() => {
    if (!observedGrid) return [];
    return sourceLayers.map((source) => rasterizeSourceLayer(source.data, source.config, observedGrid));
  }, [observedGrid, sourceLayers]);

  const hazardGrid = useMemo(() => combineWeightedStudyGrids(sourceResults), [sourceResults]);
  const validation = useMemo(() => {
    if (!hazardGrid || !observedGrid) return null;
    return validateStudyGrid(hazardGrid, normalizeStudyGrid(observedGrid));
  }, [hazardGrid, observedGrid]);

  const sitingCandidates = useMemo(() => {
    if (!observedGrid || !filtered) return [];
    return rankSensorSitingCandidates(observedGrid, filtered.records, {
      candidateCount: 8,
      minSpacingKm: Math.max(resolutionMeters / 1_000, 0.5),
    });
  }, [filtered, observedGrid, resolutionMeters]);

  if (!data || !study || !filtered || !observedGrid) {
    return <Loader message="Loading modeling data..." />;
  }

  const bounds = study.bounds;
  const addSourceLayer = (sourceLabel: string, raw: unknown) => {
    try {
      const data = normalizeFeatureCollection(raw);
      const id = `${draft.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36)}`;
      const config: SourceLayerConfig = {
        id,
        name: draft.name.trim() || sourceLabel,
        kind: draft.kind,
        valueField: draft.valueField.trim() || "value",
        weightDefault: draft.weight,
        dispersion: {
          method: draft.method,
          sigmaMeters: draft.method === "gaussian" ? draft.sigmaMeters : undefined,
          radiusMeters: draft.method === "none" ? undefined : draft.radiusMeters,
          sampleEveryMeters: resolutionMeters,
        },
      };
      setSourceLayers((previous) => [...previous, { config, data, sourceLabel }]);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load source layer");
    }
  };

  const handleFileLoad = async (file: File) => {
    try {
      const raw = JSON.parse(await file.text());
      addSourceLayer(file.name, raw);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not parse GeoJSON file");
    }
  };

  const handleUrlLoad = async () => {
    const url = draft.url.trim();
    if (!url) return;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      addSourceLayer(url.split("/").pop() || url, await response.json());
      setDraft((previous) => ({ ...previous, url: "" }));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not fetch GeoJSON URL");
    }
  };

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow="Study Modeling"
        title="Config-driven exposure surfaces"
        subtitle="Build a study area from PurpleAir coverage, add weighted GeoJSON source layers, and render a reusable hazard-index grid."
      />

      <div className={styles.stats}>
        <StatCard label="Sensors" value={`${filtered.records.length}`} />
        <StatCard label="Grid" value={`${observedGrid.width}x${observedGrid.height}`} />
        <StatCard label="Resolution" value={`${Math.round(observedGrid.cellWidthMeters)} m`} />
        <StatCard label="Sources" value={`${sourceLayers.length}`} />
      </div>

      <Card title="Study area">
        <div className={styles.controls}>
          <label className={styles.field}>
            <span>Sensor window</span>
            <select
              value={sensorValueField}
              onChange={(event) => setSensorValueField(event.target.value as StudySensorValueField)}
            >
              {sensorWindowOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Resolution</span>
            <select
              value={resolutionMeters}
              onChange={(event) => setResolutionMeters(Number(event.target.value))}
            >
              <option value={500}>500 m</option>
              <option value={1000}>1 km</option>
              <option value={2500}>2.5 km</option>
              <option value={5000}>5 km</option>
            </select>
          </label>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={outsideOnly}
              onChange={() => setOutsideOnly((value) => !value)}
            />
            Outside only
          </label>
          <div className={styles.bounds}>
            <span>{bounds ? `${bounds.west.toFixed(3)}, ${bounds.south.toFixed(3)}` : "--"}</span>
            <span>{bounds ? `${bounds.east.toFixed(3)}, ${bounds.north.toFixed(3)}` : "--"}</span>
          </div>
        </div>
      </Card>

      <div className={styles.surfaceGrid}>
        <Card title="Observed PM2.5">
          <GridPreview grid={observedGrid} useAqi />
        </Card>
        <Card title="Hazard index">
          {hazardGrid ? (
            <GridPreview grid={hazardGrid} />
          ) : (
            <div className={styles.emptySurface}>Add source layers to render a weighted index.</div>
          )}
        </Card>
      </div>

      <Card title="Sensor siting candidates">
        {sitingCandidates.length ? (
          <div className={styles.sitingList}>
            {sitingCandidates.map((candidate) => (
              <SitingCandidateRow key={`${candidate.row}:${candidate.col}`} candidate={candidate} />
            ))}
          </div>
        ) : (
          <p className={styles.emptyText}>No candidate cells available.</p>
        )}
      </Card>

      <section className={styles.referenceSection} aria-labelledby="reference-diagrams-heading">
        <div className={styles.referenceHeader}>
          <div>
            <span className={styles.sectionEyebrow}>Imported reference</span>
            <h2 id="reference-diagrams-heading">PurpleAir workflow diagrams</h2>
            <p>
              Architecture, QAQC, summary, interpolation, and modeling diagrams aligned with PAtool's client-side workflow.
            </p>
          </div>
          <span className={styles.sourceBadge}>{REFERENCE_DIAGRAM_SOURCE.label}</span>
        </div>
        <div className={styles.diagramGrid}>
          {REFERENCE_DIAGRAMS.map((diagram) => (
            <ReferenceDiagramCard key={diagram.id} diagram={diagram} />
          ))}
        </div>
        <p className={styles.sourceAttribution}>{REFERENCE_DIAGRAM_SOURCE.attribution}</p>
      </section>

      <Card title="Source layer">
        <div className={styles.sourceForm}>
          <label className={styles.field}>
            <span>Name</span>
            <input
              value={draft.name}
              onChange={(event) => setDraft((previous) => ({ ...previous, name: event.target.value }))}
            />
          </label>
          <label className={styles.field}>
            <span>Geometry</span>
            <select
              value={draft.kind}
              onChange={(event) => setDraft((previous) => ({ ...previous, kind: event.target.value as StudyGeometryKind }))}
            >
              <option value="point">Point</option>
              <option value="line">Line</option>
              <option value="polygon">Polygon</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Value field</span>
            <input
              value={draft.valueField}
              onChange={(event) => setDraft((previous) => ({ ...previous, valueField: event.target.value }))}
            />
          </label>
          <label className={styles.field}>
            <span>Weight</span>
            <input
              type="number"
              min="0"
              step="0.1"
              value={draft.weight}
              onChange={(event) => setDraft((previous) => ({ ...previous, weight: Number(event.target.value) }))}
            />
          </label>
          <label className={styles.field}>
            <span>Dispersion</span>
            <select
              value={draft.method}
              onChange={(event) => setDraft((previous) => ({ ...previous, method: event.target.value as SourceDispersionConfig["method"] }))}
            >
              <option value="gaussian">Gaussian</option>
              <option value="inverse-distance">Inverse distance</option>
              <option value="none">None</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Sigma m</span>
            <input
              type="number"
              min="1"
              value={draft.sigmaMeters}
              disabled={draft.method !== "gaussian"}
              onChange={(event) => setDraft((previous) => ({ ...previous, sigmaMeters: Number(event.target.value) }))}
            />
          </label>
          <label className={styles.field}>
            <span>Radius m</span>
            <input
              type="number"
              min="1"
              value={draft.radiusMeters}
              disabled={draft.method === "none"}
              onChange={(event) => setDraft((previous) => ({ ...previous, radiusMeters: Number(event.target.value) }))}
            />
          </label>
          <label className={styles.fieldWide}>
            <span>GeoJSON URL</span>
            <input
              type="url"
              value={draft.url}
              onChange={(event) => setDraft((previous) => ({ ...previous, url: event.target.value }))}
            />
          </label>
          <div className={styles.actions}>
            <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
              Load file
            </Button>
            <Button onClick={() => void handleUrlLoad()}>Load URL</Button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".geojson,.json,application/geo+json,application/json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFileLoad(file);
              event.target.value = "";
            }}
          />
        </div>
        {loadError && <p className={styles.error}>{loadError}</p>}
      </Card>

      <Card title="Loaded sources">
        {sourceLayers.length ? (
          <div className={styles.layerList}>
            {sourceLayers.map((source, index) => {
              const result = sourceResults[index];
              return (
                <article className={styles.layerRow} key={source.config.id}>
                  <div>
                    <strong>{source.config.name}</strong>
                    <span>{source.sourceLabel}</span>
                  </div>
                  <span>{source.config.kind}</span>
                  <span>w={source.config.weightDefault}</span>
                  <span>{result ? `${result.sourceFeatureCount} features` : "--"}</span>
                  <span>{result ? `${result.sampleCount} samples` : "--"}</span>
                  <button
                    type="button"
                    onClick={() => setSourceLayers((previous) => previous.filter((item) => item.config.id !== source.config.id))}
                  >
                    Remove
                  </button>
                </article>
              );
            })}
          </div>
        ) : (
          <p className={styles.emptyText}>No source layers loaded.</p>
        )}
      </Card>

      {validation && (
        <div className={styles.stats}>
          <StatCard label="Validation cells" value={`${validation.n}`} />
          <StatCard label="RMSE" value={validation.rmse.toFixed(3)} />
          <StatCard label="MAE" value={validation.mae.toFixed(3)} />
          <StatCard label="Bias" value={validation.bias.toFixed(3)} />
        </div>
      )}
    </div>
  );
}

function SitingCandidateRow({ candidate }: { candidate: SensorSitingCandidate }) {
  return (
    <article className={styles.sitingRow}>
      <strong>#{candidate.rank}</strong>
      <span>PM2.5 {candidate.predictedValue.toFixed(1)}</span>
      <span>gap {(candidate.coverageGapScore * 100).toFixed(0)}%</span>
      <span>{candidate.nearestSensorKm === null ? "no sensors" : `${candidate.nearestSensorKm.toFixed(2)} km`}</span>
      <span>{candidate.latitude.toFixed(4)}, {candidate.longitude.toFixed(4)}</span>
      <span>score {candidate.score.toFixed(3)}</span>
    </article>
  );
}

function ReferenceDiagramCard({ diagram }: { diagram: ReferenceDiagram }) {
  const imageUrl = docsUrl(diagram.fileName);

  return (
    <article className={styles.diagramItem}>
      <a className={styles.diagramImageLink} href={imageUrl} target="_blank" rel="noreferrer">
        <img src={imageUrl} alt={`${diagram.title} diagram`} loading="lazy" />
      </a>
      <div className={styles.diagramBody}>
        <span>{diagram.category}</span>
        <h3>{diagram.title}</h3>
        <p>{diagram.summary}</p>
      </div>
    </article>
  );
}

function GridPreview({ grid, useAqi = false }: { grid: StudyRasterGrid; useAqi?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = grid.width;
    canvas.height = grid.height;
    const context = canvas.getContext("2d");
    if (!context) return;
    const imageData = context.createImageData(grid.width, grid.height);
    imageData.data.set(gridToImageData(grid, useAqi));
    context.putImageData(imageData, 0, 0);
  }, [grid, useAqi]);

  return (
    <div className={styles.previewWrap}>
      <canvas ref={canvasRef} className={styles.previewCanvas} />
      <div className={styles.previewMeta}>
        <span>min {grid.min.toFixed(3)}</span>
        <span>max {grid.max.toFixed(3)}</span>
      </div>
    </div>
  );
}

function normalizeFeatureCollection(raw: unknown): StudySourceFeatureCollection {
  if (!raw || typeof raw !== "object") {
    throw new Error("GeoJSON root must be an object");
  }
  const candidate = raw as { type?: string; features?: unknown; geometry?: unknown };
  if (candidate.type !== "FeatureCollection" || !Array.isArray(candidate.features)) {
    if (candidate.type === "Feature") {
      return { type: "FeatureCollection", features: [candidate as StudySourceFeatureCollection["features"][number]] };
    }
    if (isGeometryType(candidate.type)) {
      return {
        type: "FeatureCollection",
        features: [{
          type: "Feature",
          geometry: candidate as StudySourceFeatureCollection["features"][number]["geometry"],
          properties: {},
        }],
      };
    }
    throw new Error("GeoJSON must be a FeatureCollection, Feature, or geometry object");
  }
  return candidate as StudySourceFeatureCollection;
}

function isGeometryType(type: string | undefined): boolean {
  return type === "Point"
    || type === "MultiPoint"
    || type === "LineString"
    || type === "MultiLineString"
    || type === "Polygon"
    || type === "MultiPolygon";
}
