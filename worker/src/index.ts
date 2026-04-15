import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";

import {
  calculateDailySoh,
  calculateEnhancedSohIndex,
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
} from "@patool/shared";

import { getPasCollection, getPatSeries, getPwfslMonitorData, getSensorRecord, type WorkerEnv } from "./purpleair";

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

  app.get("/api/pas", async (c) => {
    const date = c.req.query("date");
    return cachedJson(c, c.req.url, () => getPasCollection(c.env, date));
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
