import {
  calculateEnhancedSohIndex,
  calculateSohIndex,
  computePolarPlot,
  computeWindRose,
  generateSyntheticWindData,
  patAggregate,
  patFilterDate,
  patInternalFit,
  patOutliers,
  patRichAggregate,
  patRollingMean,
  patScatterMatrix,
  pasCollectionSchema,
  patSeriesSchema,
  runAdvancedHourlyAbQc,
  runHourlyAbQc,
  type PasCollection,
  type PasRecord,
  type PatSeries,
  type SensorRecord,
} from "@patool/shared";

const assetCache = new Map<string, Promise<unknown>>();

function assetUrl(file: string): string {
  return new URL(`data/${file}`, document.baseURI).toString();
}

async function loadAsset<T>(file: string): Promise<T> {
  if (!assetCache.has(file)) {
    assetCache.set(
      file,
      fetch(assetUrl(file)).then(async (response) => {
        if (!response.ok) {
          throw new Error(`Static data request failed for ${file}`);
        }
        return response.json();
      })
    );
  }

  return assetCache.get(file) as Promise<T>;
}

async function loadPasCollection(): Promise<PasCollection> {
  return pasCollectionSchema.parse(await loadAsset("example_pas.collection.json"));
}

async function loadTemplatePatSeries(): Promise<PatSeries> {
  return patSeriesSchema.parse(await loadAsset("example_pat.series.json"));
}

function buildSeriesForSensor(template: PatSeries, sensorId: string, sensorRecord?: PasRecord): PatSeries {
  if (template.meta.sensorId === sensorId && !sensorRecord) {
    return template;
  }

  return {
    meta: {
      ...template.meta,
      sensorId,
      label: sensorRecord?.label ?? template.meta.label,
      timezone: sensorRecord?.timezone ?? template.meta.timezone,
      latitude: sensorRecord?.latitude ?? template.meta.latitude,
      longitude: sensorRecord?.longitude ?? template.meta.longitude,
    },
    points: template.points,
  };
}

async function loadPatSeriesForSensor(sensorId: string, start?: string, end?: string, aggregate: "raw" | "hourly" = "raw"): Promise<PatSeries> {
  const [template, collection] = await Promise.all([loadTemplatePatSeries(), loadPasCollection()]);
  const sensorRecord = collection.records.find((record) => record.id === sensorId);
  let series = buildSeriesForSensor(template, sensorId, sensorRecord);

  if (start && end) {
    series = patFilterDate(series, start, end);
  }

  if (aggregate === "hourly") {
    return patAggregate(series, 60);
  }

  return series;
}

async function buildSensorRecord(sensorId: string): Promise<SensorRecord> {
  const series = await loadPatSeriesForSensor(sensorId);
  return {
    id: sensorId,
    meta: series.meta,
    latest: series.points.at(-1) ?? series.points[0],
  };
}

export async function getStaticJson<T>(path: string): Promise<T> {
  const url = new URL(path, "https://patool.local");

  if (url.pathname === "/api/pas") {
    return (await loadPasCollection()) as T;
  }

  if (url.pathname === "/api/pat") {
    const sensorId = url.searchParams.get("id") ?? "1001";
    const start = url.searchParams.get("start") ?? undefined;
    const end = url.searchParams.get("end") ?? undefined;
    const aggregate = (url.searchParams.get("aggregate") as "raw" | "hourly" | null) ?? "raw";
    return (await loadPatSeriesForSensor(sensorId, start, end, aggregate)) as T;
  }

  if (url.pathname.startsWith("/api/sensor/")) {
    const sensorId = decodeURIComponent(url.pathname.split("/").at(-1) ?? "1001");
    return (await buildSensorRecord(sensorId)) as T;
  }

  throw new Error(`Unsupported static GET path: ${path}`);
}

export async function postStaticJson<T>(path: string, body: unknown): Promise<T> {
  const payload = body as Record<string, unknown>;
  const series = payload.series ? patSeriesSchema.parse(payload.series) : undefined;

  switch (path) {
    case "/api/qc/hourly-ab":
      return runHourlyAbQc(series!, { removeOutOfSpec: Boolean(payload.removeOutOfSpec) }) as T;
    case "/api/soh/index":
      return calculateSohIndex(series!) as T;
    case "/api/soh/enhanced":
      return calculateEnhancedSohIndex(series!) as T;
    case "/api/soh/daily":
      return { sensorId: series!.meta.sensorId, metrics: calculateEnhancedSohIndex(series!).metrics } as T;
    case "/api/rolling-mean":
      return patRollingMean(series!, Number(payload.windowSize ?? 5)) as T;
    case "/api/aggregate/rich":
      return patRichAggregate(series!, Number(payload.intervalMinutes ?? 60)) as T;
    case "/api/outliers":
      return patOutliers(series!, {
        windowSize: Number(payload.windowSize ?? 7),
        thresholdMin: Number(payload.thresholdMin ?? 3),
        replace: Boolean(payload.replace),
      }) as T;
    case "/api/fit/internal": {
      const fit = patInternalFit(series!);
      if (!fit) {
        throw new Error("Unable to compute internal fit for series.");
      }
      return fit as T;
    }
    case "/api/qc/advanced":
      return runAdvancedHourlyAbQc(series!, { removeOutOfSpec: Boolean(payload.removeOutOfSpec) }) as T;
    case "/api/scatter-matrix":
      return patScatterMatrix(series!, Number(payload.sampleSize ?? 500)) as T;
    case "/api/wind-rose": {
      const wind = generateSyntheticWindData(series!);
      const rose = computeWindRose(wind);
      return { ...rose, sensorId: series!.meta.sensorId } as T;
    }
    case "/api/polar-plot": {
      const wind = generateSyntheticWindData(series!);
      const polar = computePolarPlot(wind);
      return { ...polar, sensorId: series!.meta.sensorId } as T;
    }
    default:
      throw new Error(`Unsupported static POST path: ${path}`);
  }
}
