import { afterEach, describe, expect, it, vi } from "vitest";

import { samplePatSeries } from "@patool/shared/fixtures";

import { createApp } from "./index";
import { parsePurpleAirRetryAfter, planPurpleAirHistoryWindows } from "./purpleair";

describe("worker api", () => {
  const app = createApp();

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("serves fixture-backed pas data", async () => {
    const response = await app.request("/api/pas");
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { records: unknown[] };
    expect(payload.records.length).toBeGreaterThan(0);
  });

  it("runs qc and soh endpoints", async () => {
    const qcResponse = await app.request("/api/qc/hourly-ab", {
      method: "POST",
      body: JSON.stringify({ series: samplePatSeries, removeOutOfSpec: true }),
      headers: { "content-type": "application/json" }
    });
    const qcPayload = (await qcResponse.json()) as { flaggedPoints: number };
    expect(qcPayload.flaggedPoints).toBeGreaterThan(0);

    const sohResponse = await app.request("/api/soh/index", {
      method: "POST",
      body: JSON.stringify({ series: samplePatSeries }),
      headers: { "content-type": "application/json" }
    });
    const sohPayload = (await sohResponse.json()) as { index: number };
    expect(sohPayload.index).toBeGreaterThan(0);
  });

  it("serves correction, visible health, and NowCast endpoints", async () => {
    const correctionResponse = await app.request("/api/correction/purpleair", {
      method: "POST",
      body: JSON.stringify({
        pm25: 30,
        humidity: 60,
        inputBasis: "cf_1",
        profileId: "epa-barkjohn-2021-cf1",
      }),
      headers: { "content-type": "application/json" },
    });
    expect(correctionResponse.status).toBe(200);
    const correction = (await correctionResponse.json()) as { pm25Corrected: number; provenance: string };
    expect(correction).toMatchObject({ pm25Corrected: 16.298, provenance: "epa-corrected-purpleair" });

    const rejected = await app.request("/api/correction/purpleair", {
      method: "POST",
      body: JSON.stringify({
        pm25: 30,
        humidity: 60,
        inputBasis: "atm",
        profileId: "epa-barkjohn-2021-cf1",
      }),
      headers: { "content-type": "application/json" },
    });
    expect(rejected.status).toBe(400);

    const healthResponse = await app.request("/api/qc/sensor-health", {
      method: "POST",
      body: JSON.stringify({ series: samplePatSeries, profileId: "qapp-hourly" }),
      headers: { "content-type": "application/json" },
    });
    expect(healthResponse.status).toBe(200);
    const health = (await healthResponse.json()) as { level: string; totalPoints: number };
    expect(health.totalPoints).toBe(samplePatSeries.points.length);
    expect(["good", "questionable", "severe", "unavailable"]).toContain(health.level);

    const nowCastResponse = await app.request("/api/aqi/nowcast", {
      method: "POST",
      body: JSON.stringify({ series: samplePatSeries }),
      headers: { "content-type": "application/json" },
    });
    expect(nowCastResponse.status).toBe(200);
    const nowCast = (await nowCastResponse.json()) as { status: string; hoursRequired: number };
    expect(nowCast.hoursRequired).toBe(12);
    expect(["stable", "calculating", "insufficient"]).toContain(nowCast.status);
  });

  it("serves configured local PurpleAir /json sensors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({
        SensorId: 12345,
        Geo: "Garage",
        DateTime: 1_700_000_000,
        lat: 47.61,
        lon: -122.33,
        pm2_5_atm: 9.5,
        pm2_5_atm_b: 10.2,
        current_humidity: 42,
        current_temp_f: 68.4,
        pressure: 1012.3,
      })))
    );

    const response = await app.request(
      "/api/local-sensors",
      {},
      { PURPLEAIR_LOCAL_SENSOR_URLS: "garage=192.168.1.24" }
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { source: string; records: Array<{ id: string; pm25Current: number }> };

    expect(payload.source).toBe("local");
    expect(payload.records).toHaveLength(1);
    expect(payload.records[0]).toMatchObject({ id: "garage", pm25Current: 9.5 });
  });

  it("uses PurpleAir history query parameters for date ranges and hourly averages", async () => {
    let requestedUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        requestedUrl = String(input);
        return new Response(JSON.stringify({
          fields: ["time_stamp", "pm2.5_atm_a", "pm2.5_atm_b", "humidity", "temperature", "pressure"],
          data: [[1_720_000_000, 11, 12, 44, 71, 1011]],
        }));
      })
    );

    const response = await app.request(
      "/api/pat?id=1001&start=2024-07-02&end=2024-07-05&aggregate=hourly",
      {},
      { PURPLEAIR_API_KEY: "test-key", PURPLEAIR_API_BASE: "https://api.example.test/v1" }
    );
    expect(response.status).toBe(200);

    const url = new URL(requestedUrl);
    expect(url.pathname).toBe("/v1/sensors/1001/history");
    expect(url.searchParams.get("average")).toBe("60");
    expect(url.searchParams.get("start_timestamp")).toBe("1719878400");
    expect(url.searchParams.get("end_timestamp")).toBe("1720224000");
    expect(url.searchParams.get("fields")).toContain("pm2.5_atm_a");
  });

  it("plans PurpleAir history windows and includes private read keys without edge caching", async () => {
    const rawPlan = planPurpleAirHistoryWindows("2024-07-01", "2024-07-06", "0");
    expect(rawPlan.windows).toHaveLength(3);
    expect(rawPlan.windows[0]).toEqual({ startTimestamp: 1719792000, endTimestamp: 1719964800 });

    const requestedUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        requestedUrls.push(String(input));
        return new Response(JSON.stringify({
          fields: ["time_stamp", "pm2.5_atm_a", "pm2.5_atm_b", "humidity", "temperature", "pressure"],
          data: [[1_720_000_000, 11, 12, 44, 71, 1011]],
        }));
      })
    );

    const response = await app.request(
      "/api/pat?id=1001&start=2024-07-01&end=2024-07-06",
      {},
      { PURPLEAIR_API_KEY: "test-key", PURPLEAIR_READ_KEY: "private-key", PURPLEAIR_API_BASE: "https://api.example.test/v1" }
    );
    expect(response.status).toBe(200);
    expect(requestedUrls).toHaveLength(3);
    expect(new URL(requestedUrls[0]).searchParams.get("read_key")).toBe("private-key");
  });

  it("parses PurpleAir retry-after hints", () => {
    expect(parsePurpleAirRetryAfter("2")).toBe(2000);
    expect(parsePurpleAirRetryAfter("not-a-date")).toBeNull();
  });

  it("reports fallback data source status", async () => {
    const response = await app.request("/api/status");
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { mode: string; collectionSource: string; warnings: string[] };

    expect(payload.mode).toBe("api");
    expect(payload.collectionSource).toBe("fixture");
    expect(payload.warnings[0]).toContain("fixture data");
  });

  it("proxies AirFuse static artifacts through the serverless API surface", async () => {
    let requestedUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        requestedUrl = String(input);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json" },
        });
      })
    );

    const response = await app.request(
      "/api/airfuse/proxy?path=fusion%2FPM25%2F2024%2F03%2F01%2F00%2FFusion_PM25_NAQFC_2024-03-01T00Z.geojson",
      {},
      { AIRFUSE_BASE_URL: "https://airfuse.example.test" }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/geo+json");
    expect(requestedUrl).toBe("https://airfuse.example.test/fusion/PM25/2024/03/01/00/Fusion_PM25_NAQFC_2024-03-01T00Z.geojson");
  });

  it("rejects AirFuse proxy paths outside the known artifact tree", async () => {
    const response = await app.request("/api/airfuse/proxy?path=https%3A%2F%2Fexample.com%2Findex.json");
    expect(response.status).toBe(400);
  });

  it("keeps AirNow AQI separate from PM2.5 concentration", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify([
        {
          ParameterName: "PM2.5",
          ReportingArea: "Seattle",
          DateObserved: "2024-07-02",
          HourObserved: 3,
          AQI: 0,
          Category: { Name: "Good" },
        },
      ])))
    );

    const response = await app.request(
      "/api/pwfsl?latitude=47.61&longitude=-122.33",
      {},
      { AIRNOW_API_KEY: "test-key" }
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { source: string; observations: Array<{ timestamp: string; pm25: number | null; aqi: number | null }> };

    expect(payload.source).toBe("airnow");
    expect(payload.observations[0].timestamp).toBe("2024-07-02T03:00:00.000Z");
    expect(payload.observations[0].aqi).toBe(0);
    expect(payload.observations[0].pm25).toBeNull();

    const referenceResponse = await app.request(
      "/api/reference/airnow/conditions?latitude=47.61&longitude=-122.33&distanceKm=25",
      {},
      { AIRNOW_API_KEY: "test-key" }
    );
    expect(referenceResponse.status).toBe(200);
    const referencePayload = (await referenceResponse.json()) as { source: string; kind: string };
    expect(referencePayload).toMatchObject({ source: "airnow", kind: "conditions" });
  });

  it("serves reference comparison routes without fitting AQI-only AirNow values", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/history")) {
          return new Response(JSON.stringify({
            fields: ["time_stamp", "pm2.5_atm_a", "pm2.5_atm_b", "humidity", "temperature", "pressure"],
            data: [[1_720_000_000, 11, 12, 44, 71, 1011]],
          }));
        }
        return new Response(JSON.stringify([
          {
            ParameterName: "PM2.5",
            ReportingArea: "Seattle",
            DateObserved: "2024-07-03",
            HourObserved: 9,
            AQI: 32,
            Category: { Name: "Good" },
          },
        ]));
      })
    );

    const response = await app.request(
      "/api/reference/compare?sensorId=1001&latitude=47.61&longitude=-122.33&start=2024-07-03&end=2024-07-03&source=airnow",
      {},
      { PURPLEAIR_API_KEY: "test-key", AIRNOW_API_KEY: "airnow-key", PURPLEAIR_API_BASE: "https://api.example.test/v1" }
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { reference: { source: string }; pairs: Array<{ referenceAqi: number | null; referencePm25: number | null }>; fit: unknown };

    expect(payload.reference.source).toBe("airnow");
    expect(payload.pairs.some((pair) => pair.referenceAqi === 32 && pair.referencePm25 === null)).toBe(true);
    expect(payload.fit).toBeNull();
  });

  it("supports AQS reference comparisons with validation metrics", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/history")) {
          return new Response(JSON.stringify({
            fields: ["time_stamp", "pm2.5_cf_1_a", "pm2.5_cf_1_b", "humidity", "temperature", "pressure"],
            data: [
              [1_720_000_000, 11, 12, 44, 71, 1011],
              [1_720_003_600, 12, 13, 44, 71, 1011],
              [1_720_007_200, 13, 14, 44, 71, 1011],
            ],
          }));
        }
        return new Response(JSON.stringify({
          Data: [
            { date_local: "2024-07-03", time_local: "09:00", sample_measurement: 12, latitude: 47.61, longitude: -122.33, state_code: "53", county_code: "033", site_number: "0010", local_site_name: "Seattle" },
            { date_local: "2024-07-03", time_local: "10:00", sample_measurement: 13, latitude: 47.61, longitude: -122.33, state_code: "53", county_code: "033", site_number: "0010", local_site_name: "Seattle" },
            { date_local: "2024-07-03", time_local: "11:00", sample_measurement: 14, latitude: 47.61, longitude: -122.33, state_code: "53", county_code: "033", site_number: "0010", local_site_name: "Seattle" },
          ],
        }));
      })
    );

    const response = await app.request(
      "/api/reference/compare?sensorId=1001&latitude=47.61&longitude=-122.33&start=2024-07-03&end=2024-07-03&source=aqs",
      {},
      { PURPLEAIR_API_KEY: "test-key", PURPLEAIR_API_BASE: "https://api.example.test/v1", AQS_EMAIL: "test@example.com", AQS_API_KEY: "aqs-key" }
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { reference: { source: string }; validation: { n: number; targets: { minRSquared: number } } | null };
    expect(payload.reference.source).toBe("aqs");
    expect(payload.validation?.n).toBeGreaterThanOrEqual(3);
    expect(payload.validation?.targets.minRSquared).toBe(0.7);
  });

  it("serves FIRMS fire and hazard context routes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(
        "latitude,longitude,acq_date,acq_time,satellite,instrument,confidence,frp,brightness\n"
        + "47.61,-122.33,2026-04-20,0830,N,VIIRS,n,12.5,330.1\n"
      ))
    );

    const fireResponse = await app.request(
      "/api/firms/fire?west=-123&south=47&east=-122&north=48&date=2026-04-20",
      {},
      { FIRMS_MAP_KEY: "firms-key" }
    );
    expect(fireResponse.status).toBe(200);
    const fires = (await fireResponse.json()) as Array<{ source: string; frpMw: number }>;
    expect(fires[0]).toMatchObject({ source: "firms", frpMw: 12.5 });

    const hazardResponse = await app.request(
      "/api/hazards/context?west=-123&south=47&east=-122&north=48&date=2026-04-20",
      {},
      { FIRMS_MAP_KEY: "firms-key" }
    );
    expect(hazardResponse.status).toBe(200);
    const hazards = (await hazardResponse.json()) as { fires: unknown[]; smoke: unknown[]; cautions: string[] };
    expect(hazards.fires).toHaveLength(1);
    expect(hazards.smoke).toEqual([]);
    expect(hazards.cautions[0]).toContain("FIRMS");
  });

  it("serves configured HMS smoke polygons", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({
        type: "FeatureCollection",
        features: [{
          type: "Feature",
          properties: { Density: "Heavy", Start: "2026-04-20T08:00:00Z" },
          geometry: {
            type: "Polygon",
            coordinates: [[
              [-123, 47],
              [-122, 47],
              [-122, 48],
              [-123, 48],
              [-123, 47],
            ]],
          },
        }],
      }), {
        headers: { "content-type": "application/geo+json" },
      }))
    );

    const response = await app.request(
      "/api/hms/smoke?west=-123&south=47&east=-122&north=48",
      {},
      { HMS_SMOKE_GEOJSON_URL: "https://hms.example.test/smoke.geojson" }
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { smoke: Array<{ source: string; density: string }>; cautions: string[] };
    expect(payload.cautions).toEqual([]);
    expect(payload.smoke[0]).toMatchObject({ source: "hms", density: "heavy" });
  });
});
