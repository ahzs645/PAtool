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
  type DataStatus,
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

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function averagePm25(series: PatSeries): number {
  const values = series.points
    .map((point) => {
      if (point.pm25A !== null && point.pm25B !== null) return (point.pm25A + point.pm25B) / 2;
      return point.pm25A ?? point.pm25B;
    })
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 1;
}

function deriveStaticSeries(template: PatSeries, sensorId: string, sensorRecord?: PasRecord): PatSeries {
  const seed = hashString(`${sensorId}:${sensorRecord?.label ?? ""}`);
  const targetPm25 = sensorRecord?.pm25_1hr ?? sensorRecord?.pm25Current ?? sensorRecord?.pm25_1day ?? averagePm25(template);
  const scale = clamp(targetPm25 / Math.max(averagePm25(template), 0.1), 0.05, 8);
  const phase = seed % 1440;
  const amplitude = 0.03 + ((seed >>> 8) % 9) / 100;
  const channelBias = (((seed >>> 16) % 41) - 20) / 1000;
  const humidityOffset = (sensorRecord?.humidity ?? 45) - 45;
  const temperatureOffset = (sensorRecord?.temperature ?? 70) - 70;
  const pressureOffset = (sensorRecord?.pressure ?? 1013) - 1013;

  return {
    meta: {
      ...template.meta,
      sensorId,
      label: sensorRecord?.label ?? template.meta.label,
      timezone: sensorRecord?.timezone ?? template.meta.timezone,
      latitude: sensorRecord?.latitude ?? template.meta.latitude,
      longitude: sensorRecord?.longitude ?? template.meta.longitude,
    },
    points: template.points.map((point, index) => {
      const dayCycle = Math.sin(((index + phase) / 1440) * Math.PI * 2);
      const weekCycle = Math.cos(((index + phase) / (1440 * 7)) * Math.PI * 2);
      const multiplier = clamp(1 + amplitude * dayCycle + amplitude * 0.5 * weekCycle, 0.2, 3);

      const transformPm = (value: number | null, bias: number) => {
        if (value === null) return null;
        return Number(Math.max(0, value * scale * multiplier * (1 + bias)).toFixed(3));
      };

      return {
        ...point,
        pm25A: transformPm(point.pm25A, channelBias),
        pm25B: transformPm(point.pm25B, -channelBias),
        humidity: point.humidity === null || point.humidity === undefined
          ? point.humidity
          : Number(clamp(point.humidity + humidityOffset * 0.35, 0, 100).toFixed(3)),
        temperature: point.temperature === null || point.temperature === undefined
          ? point.temperature
          : Number((point.temperature + temperatureOffset * 0.35).toFixed(3)),
        pressure: point.pressure === null || point.pressure === undefined
          ? point.pressure
          : Number((point.pressure + pressureOffset * 0.35).toFixed(3)),
      };
    }),
  };
}

function buildSeriesForSensor(template: PatSeries, sensorId: string, sensorRecord?: PasRecord): PatSeries {
  if (template.meta.sensorId === sensorId && !sensorRecord) {
    return template;
  }

  return deriveStaticSeries(template, sensorId, sensorRecord);
}

async function getStaticStatus(): Promise<DataStatus> {
  const collection = await loadPasCollection();
  return {
    mode: "static",
    collectionSource: collection.source,
    generatedAt: new Date().toISOString(),
    liveConfigured: false,
    localConfigured: false,
    warnings: [
      "Static mode uses committed fixture data and deterministic per-sensor demo time series.",
    ],
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

  if (url.pathname === "/api/status") {
    return (await getStaticStatus()) as T;
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
