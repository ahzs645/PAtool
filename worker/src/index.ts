import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";

import {
  applyPurpleAirCorrection,
  calculateDailySoh,
  calculateEnhancedSohIndex,
  calculateNowCast,
  calculateSohIndex,
  computePolarPlot,
  computeWindRose,
  generateSyntheticWindData,
  pasPalette,
  patCreateAirSensor,
  patExternalFit,
  patInternalFit,
  patOutliers,
  patRichAggregate,
  patRollingMean,
  patScatterMatrix,
  patSeriesSchema,
  runAdvancedHourlyAbQc,
  runHourlyAbQc,
  summarizeSensorHealth,
} from "@patool/shared";

import {
  getAirNowConditions,
  getDataStatus,
  getFirmsFireDetections,
  getHazardContext,
  getHmsSmokePolygons,
  getLocalPasCollection,
  getPasCollection,
  getPatSeries,
  getPwfslMonitorData,
  getReferenceComparison,
  getSensorRecord,
  type WorkerEnv,
} from "./purpleair";

const qcRequestSchema = z.object({
  series: patSeriesSchema,
  removeOutOfSpec: z.boolean().optional()
});

const advancedQcRequestSchema = z.object({
  series: patSeriesSchema,
  removeOutOfSpec: z.boolean().optional(),
  minCount: z.number().optional(),
  maxPValue: z.number().optional(),
  maxMeanDiff: z.number().optional(),
  maxHumidity: z.number().optional(),
});

const outlierRequestSchema = z.object({
  series: patSeriesSchema,
  windowSize: z.number().optional(),
  thresholdMin: z.number().optional(),
  replace: z.boolean().optional(),
});

const richAggregateRequestSchema = z.object({
  series: patSeriesSchema,
  intervalMinutes: z.number().optional(),
});

const airSensorRequestSchema = z.object({
  series: patSeriesSchema,
  removeOutOfSpec: z.boolean().optional(),
  minCount: z.number().optional(),
  maxPValue: z.number().optional(),
  maxMeanDiff: z.number().optional(),
  maxHumidity: z.number().optional(),
});

const externalFitRequestSchema = z.object({
  series: patSeriesSchema,
  reference: patSeriesSchema,
});

const scatterMatrixRequestSchema = z.object({
  series: patSeriesSchema,
  sampleSize: z.number().optional(),
});

const rollingMeanRequestSchema = z.object({
  series: patSeriesSchema,
  windowSize: z.number().optional(),
});

const correctionRequestSchema = z.object({
  pm25: z.number().nullable().optional(),
  humidity: z.number().nullable().optional(),
  inputBasis: z.enum(["cf_1", "atm", "alt"]),
  profileId: z.enum([
    "epa-barkjohn-2021-cf1",
    "epa-barkjohn-2022-smoke-cf1",
    "nilson-2022-rh-growth-atm",
    "nilson-2022-polynomial-atm",
  ]),
});

const sensorHealthRequestSchema = z.object({
  series: patSeriesSchema,
  profileId: z.enum(["barkjohn-daily", "fire-smoke-10min", "qapp-hourly", "humid-research"]).optional(),
  maxHumidity: z.number().optional(),
});

const AIRFUSE_DEFAULT_BASE_URL = "https://airnow-navigator-layers.s3.us-east-2.amazonaws.com";
const AIRFUSE_ALLOWED_EXTENSIONS = [".json", ".geojson", ".csv", ".nc", ".png"];

function normalizeAirFusePath(rawPath: string | undefined): string | null {
  const path = rawPath?.trim().replace(/^\/+/, "");
  if (!path) return null;
  if (/^https?:\/\//i.test(path) || path.startsWith("//") || path.includes("\\")) return null;

  const segments = path.split("/");
  if (segments.some((segment) => segment === "." || segment === ".." || segment === "")) return null;

  const isAllowedPrefix = path === "index.json" || path.startsWith("fusion/") || path.startsWith("goes/");
  if (!isAllowedPrefix) return null;

  const lowerPath = path.toLowerCase();
  if (!AIRFUSE_ALLOWED_EXTENSIONS.some((extension) => lowerPath.endsWith(extension))) return null;

  return path;
}

function contentTypeForAirFusePath(path: string): string {
  const lowerPath = path.toLowerCase();
  if (lowerPath.endsWith(".geojson")) return "application/geo+json; charset=utf-8";
  if (lowerPath.endsWith(".json")) return "application/json; charset=utf-8";
  if (lowerPath.endsWith(".csv")) return "text/csv; charset=utf-8";
  if (lowerPath.endsWith(".png")) return "image/png";
  if (lowerPath.endsWith(".nc")) return "application/x-netcdf";
  return "application/octet-stream";
}

function airFuseBaseUrl(env: WorkerEnv): string {
  return (env.AIRFUSE_BASE_URL ?? AIRFUSE_DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function parseRequiredNumber(value: string | undefined): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseBounds(c: Context<{ Bindings: WorkerEnv }>) {
  const west = parseRequiredNumber(c.req.query("west"));
  const south = parseRequiredNumber(c.req.query("south"));
  const east = parseRequiredNumber(c.req.query("east"));
  const north = parseRequiredNumber(c.req.query("north"));
  if (west === null || south === null || east === null || north === null) return null;
  return { west, south, east, north };
}

export function createApp() {
  const app = new Hono<{ Bindings: WorkerEnv }>();
  app.use("/api/*", cors());

  async function cachedJson(c: Context<{ Bindings: WorkerEnv }>, key: string, producer: () => Promise<unknown>) {
    const cache = typeof caches !== "undefined" ? (caches as unknown as { default?: Cache }).default : undefined;
    const request = new Request(key);
    if (cache) {
      const cached = await cache.match(request);
      if (cached) {
        return cached;
      }
    }

    const response = c.json(await producer(), 200, {
      "cache-control": "public, max-age=300"
    });

    if (cache) {
      c.executionCtx?.waitUntil(cache.put(request, response.clone()));
    }

    return response;
  }

  app.get("/api/health", (c) => c.json({ ok: true, service: "airsensor-api" }));

  app.get("/api/airfuse/proxy", async (c) => {
    const path = normalizeAirFusePath(c.req.query("path"));
    if (!path) {
      return c.json({ error: "Unsupported AirFuse artifact path" }, 400);
    }

    const cache = typeof caches !== "undefined" ? (caches as unknown as { default?: Cache }).default : undefined;
    const upstreamUrl = `${airFuseBaseUrl(c.env)}/${path}`;
    const cacheRequest = new Request(upstreamUrl);
    if (cache) {
      const cached = await cache.match(cacheRequest);
      if (cached) return cached;
    }

    const upstream = await fetch(upstreamUrl, {
      headers: { "user-agent": "PAtool/0.1" },
      signal: AbortSignal.timeout(20_000),
    });

    if (!upstream.ok || !upstream.body) {
      return c.json({ error: `AirFuse artifact unavailable: ${path}` }, upstream.status === 404 ? 404 : 502);
    }

    const response = new Response(upstream.body, {
      status: 200,
      headers: {
        "content-type": contentTypeForAirFusePath(path),
        "cache-control": path === "index.json" ? "public, max-age=300" : "public, max-age=3600",
      },
    });

    if (cache) {
      c.executionCtx?.waitUntil(cache.put(cacheRequest, response.clone()));
    }

    return response;
  });

  app.get("/api/status", async (c) => cachedJson(c, c.req.url, () => getDataStatus(c.env)));

  app.get("/api/pas", async (c) => {
    const date = c.req.query("date");
    return cachedJson(c, c.req.url, () => getPasCollection(c.env, date));
  });

  app.get("/api/local-sensors", async (c) => {
    return cachedJson(c, c.req.url, () => getLocalPasCollection(c.env));
  });

  app.get("/api/pat", async (c) => {
    const sensorId = c.req.query("id") ?? "1001";
    const start = c.req.query("start") ?? undefined;
    const end = c.req.query("end") ?? undefined;
    const aggregate = (c.req.query("aggregate") as "raw" | "hourly" | null) ?? "raw";
    return cachedJson(c, c.req.url, () => getPatSeries(c.env, sensorId, start, end, aggregate));
  });

  app.get("/api/sensor/:id", async (c) => {
    const period = (c.req.query("period") as "latest" | "month" | "year" | null) ?? "latest";
    return cachedJson(c, c.req.url, () => getSensorRecord(c.env, c.req.param("id"), period));
  });

  app.post("/api/qc/hourly-ab", async (c) => {
    const parsed = qcRequestSchema.parse(await c.req.json());
    return c.json(runHourlyAbQc(parsed.series, { removeOutOfSpec: parsed.removeOutOfSpec }));
  });

  app.post("/api/correction/purpleair", async (c) => {
    const parsed = correctionRequestSchema.parse(await c.req.json());
    try {
      return c.json(applyPurpleAirCorrection({
        pm25: parsed.pm25,
        humidity: parsed.humidity,
        inputBasis: parsed.inputBasis,
        profileId: parsed.profileId,
      }));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Unable to apply correction profile" }, 400);
    }
  });

  app.post("/api/qc/sensor-health", async (c) => {
    const parsed = sensorHealthRequestSchema.parse(await c.req.json());
    return c.json(summarizeSensorHealth(parsed.series, {
      profileId: parsed.profileId,
      maxHumidity: parsed.maxHumidity,
    }));
  });

  app.post("/api/aqi/nowcast", async (c) => {
    const payload = await c.req.json();
    const series = patSeriesSchema.parse(payload.series ?? payload);
    return c.json(calculateNowCast(series.points.map((point) => ({
      timestamp: point.timestamp,
      pm25: point.pm25A !== null && point.pm25B !== null ? (point.pm25A + point.pm25B) / 2 : point.pm25A ?? point.pm25B,
    }))));
  });

  app.post("/api/soh/daily", async (c) => {
    const payload = await c.req.json();
    const parsed = patSeriesSchema.parse(payload.series ?? payload);
    return c.json({ sensorId: parsed.meta.sensorId, metrics: calculateDailySoh(parsed) });
  });

  app.post("/api/soh/index", async (c) => {
    const payload = await c.req.json();
    const parsed = patSeriesSchema.parse(payload.series ?? payload);
    return c.json(calculateSohIndex(parsed));
  });

  app.post("/api/qc/advanced", async (c) => {
    const parsed = advancedQcRequestSchema.parse(await c.req.json());
    const { series, ...options } = parsed;
    return c.json(runAdvancedHourlyAbQc(series, options));
  });

  app.post("/api/outliers", async (c) => {
    const parsed = outlierRequestSchema.parse(await c.req.json());
    const { series, ...options } = parsed;
    return c.json(patOutliers(series, options));
  });

  app.post("/api/fit/internal", async (c) => {
    const payload = await c.req.json();
    const series = patSeriesSchema.parse(payload.series ?? payload);
    return c.json(patInternalFit(series));
  });

  app.post("/api/aggregate/rich", async (c) => {
    const parsed = richAggregateRequestSchema.parse(await c.req.json());
    return c.json(patRichAggregate(parsed.series, parsed.intervalMinutes));
  });

  app.post("/api/sensor/hourly", async (c) => {
    const parsed = airSensorRequestSchema.parse(await c.req.json());
    const { series, ...options } = parsed;
    return c.json(patCreateAirSensor(series, options));
  });

  app.post("/api/soh/enhanced", async (c) => {
    const payload = await c.req.json();
    const series = patSeriesSchema.parse(payload.series ?? payload);
    return c.json(calculateEnhancedSohIndex(series));
  });

  app.post("/api/fit/external", async (c) => {
    const parsed = externalFitRequestSchema.parse(await c.req.json());
    return c.json(patExternalFit(parsed.series, parsed.reference));
  });

  app.post("/api/scatter-matrix", async (c) => {
    const parsed = scatterMatrixRequestSchema.parse(await c.req.json());
    return c.json(patScatterMatrix(parsed.series, parsed.sampleSize));
  });

  app.post("/api/rolling-mean", async (c) => {
    const parsed = rollingMeanRequestSchema.parse(await c.req.json());
    return c.json(patRollingMean(parsed.series, parsed.windowSize));
  });

  app.post("/api/wind-rose", async (c) => {
    const payload = await c.req.json();
    const series = patSeriesSchema.parse(payload.series ?? payload);
    const windData = generateSyntheticWindData(series);
    const rose = computeWindRose(windData);
    rose.sensorId = series.meta.sensorId;
    return c.json(rose);
  });

  app.post("/api/polar-plot", async (c) => {
    const payload = await c.req.json();
    const series = patSeriesSchema.parse(payload.series ?? payload);
    const windData = generateSyntheticWindData(series);
    const polar = computePolarPlot(windData);
    polar.sensorId = series.meta.sensorId;
    return c.json(polar);
  });

  app.get("/api/palette/:parameter", (c) => {
    const parameter = c.req.param("parameter") as "pm25" | "temperature" | "humidity";
    return c.json(pasPalette(parameter));
  });

  app.get("/api/reference/airnow/conditions", async (c) => {
    const latitude = parseRequiredNumber(c.req.query("latitude"));
    const longitude = parseRequiredNumber(c.req.query("longitude"));
    const distanceKm = parseRequiredNumber(c.req.query("distanceKm")) ?? 50;
    if (latitude === null || longitude === null) {
      return c.json({ error: "latitude and longitude query parameters are required" }, 400);
    }

    return cachedJson(c, c.req.url, () => getAirNowConditions(c.env, latitude, longitude, distanceKm));
  });

  app.get("/api/reference/compare", async (c) => {
    const sensorId = c.req.query("sensorId") ?? c.req.query("id") ?? "1001";
    const latitude = parseRequiredNumber(c.req.query("latitude"));
    const longitude = parseRequiredNumber(c.req.query("longitude"));
    const source = c.req.query("source") ?? "airnow";
    if (latitude === null || longitude === null) {
      return c.json({ error: "sensorId, latitude, and longitude query parameters are required" }, 400);
    }
    if (source !== "airnow" && source !== "aqs" && source !== "openaq") {
      return c.json({ error: "source must be airnow, aqs, or openaq" }, 400);
    }

    return cachedJson(c, c.req.url, () => getReferenceComparison(
      c.env,
      sensorId,
      latitude,
      longitude,
      c.req.query("start") ?? undefined,
      c.req.query("end") ?? undefined,
      source,
    ));
  });

  app.get("/api/firms/fire", async (c) => {
    const bounds = parseBounds(c);
    if (!bounds) {
      return c.json({ error: "west, south, east, and north query parameters are required" }, 400);
    }

    return cachedJson(c, c.req.url, () => getFirmsFireDetections(c.env, bounds, {
      dayRange: parseRequiredNumber(c.req.query("dayRange")) ?? undefined,
      date: c.req.query("date") ?? undefined,
      source: c.req.query("source") ?? undefined,
    }));
  });

  app.get("/api/hms/smoke", async (c) => {
    const bounds = parseBounds(c);
    if (!bounds) {
      return c.json({ error: "west, south, east, and north query parameters are required" }, 400);
    }

    return cachedJson(c, c.req.url, async () => ({
      generatedAt: new Date().toISOString(),
      attribution: "NOAA HMS smoke polygons.",
      cautions: c.env.HMS_SMOKE_GEOJSON_URL ? [] : ["HMS_SMOKE_GEOJSON_URL is not configured for this deployment."],
      smoke: await getHmsSmokePolygons(c.env, bounds),
    }));
  });

  app.get("/api/hazards/context", async (c) => {
    const bounds = parseBounds(c);
    if (!bounds) {
      return c.json({ error: "west, south, east, and north query parameters are required" }, 400);
    }

    return cachedJson(c, c.req.url, () => getHazardContext(c.env, bounds, {
      dayRange: parseRequiredNumber(c.req.query("dayRange")) ?? undefined,
      date: c.req.query("date") ?? undefined,
    }));
  });

  app.get("/api/pwfsl", async (c) => {
    const latitude = Number(c.req.query("latitude"));
    const longitude = Number(c.req.query("longitude"));
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return c.json({ error: "latitude and longitude query parameters are required" }, 400);
    }
    const result = await getPwfslMonitorData(c.env, latitude, longitude);
    return c.json(result);
  });

  return app;
}

const app = createApp();

export default app;
