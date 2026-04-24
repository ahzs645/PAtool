import { describe, expect, it } from "vitest";

import {
  COVARIATE_LAYER_MANIFEST,
  buildArcGisEnvelope,
  buildBboxParam,
  buildOverpassBbox,
  buildUrlFromTemplate,
  getCovariateLayerDefinition,
  planCovariateLayers,
} from "./covariateLayers";
import type { AreaBounds } from "./domain";

const bounds: AreaBounds = {
  west: -122.55,
  south: 37.7,
  east: -122.35,
  north: 37.84,
};

describe("covariate layer manifest", () => {
  it("includes PM2.5 modeling covariates requested by provider family", () => {
    expect(COVARIATE_LAYER_MANIFEST.map((layer) => layer.id)).toEqual([
      "hrrr-weather",
      "nlcd-land-cover",
      "tiger-roads",
      "acs-population",
      "osm-overture-pois",
      "nasa-firms",
      "noaa-hms-smoke",
      "airnow-aqs-monitors",
    ]);
    expect(getCovariateLayerDefinition("hrrr-weather").featureIdeas).toContain("planetary boundary layer height");
    expect(getCovariateLayerDefinition("airnow-aqs-monitors").pm25Relevance).toMatch(/calibration/i);
  });

  it("builds common geographic URL parameters without network access", () => {
    expect(buildBboxParam(bounds)).toBe("-122.55,37.7,-122.35,37.84");
    expect(buildOverpassBbox(bounds)).toBe("37.7,-122.55,37.84,-122.35");
    expect(JSON.parse(buildArcGisEnvelope(bounds))).toMatchObject({
      xmin: -122.55,
      ymin: 37.7,
      xmax: -122.35,
      ymax: 37.84,
    });
  });
});

describe("covariate layer planner", () => {
  it("expands public URL templates with study bounds and date options", () => {
    const url = buildUrlFromTemplate(
      "https://example.test?bbox={bbox}&date={date}&json={bboxJsonEncoded}",
      bounds,
      { date: "2024-09-05" },
    );

    expect(url).toContain("bbox=-122.55,37.7,-122.35,37.84");
    expect(url).toContain("date=2024-09-05");
    expect(url).toContain("json=%7B%22xmin%22%3A-122.55");
  });

  it("plans selected layers with cache/static notes and readiness penalties for missing keys", () => {
    const result = planCovariateLayers(bounds, ["nlcd-land-cover", "nasa-firms", "airnow-aqs-monitors"], {
      date: "2024-09-05",
      env: { NASA_FIRMS_MAP_KEY: "demo-firms-key" },
    });

    expect(result.layers).toHaveLength(3);
    expect(result.readinessScore).toBeGreaterThan(0);
    expect(result.readinessScore).toBeLessThanOrEqual(1);

    const nlcd = result.layers.find((layer) => layer.id === "nlcd-land-cover");
    expect(nlcd?.sourceUrls[0]).toContain("bbox=-122.55,37.7,-122.35,37.84");
    expect(nlcd?.cacheSupportNote).toMatch(/Cache clipped rasters/);
    expect(nlcd?.readinessScore).toBeGreaterThan(0.9);

    const firms = result.layers.find((layer) => layer.id === "nasa-firms");
    expect(firms?.sourceUrls[0]).toContain("demo-firms-key");
    expect(firms?.warnings).toEqual([]);

    const airnow = result.layers.find((layer) => layer.id === "airnow-aqs-monitors");
    expect(airnow?.warnings).toEqual([
      "Missing AIRNOW_API_KEY; generated URLs keep the {AIRNOW_API_KEY} placeholder.",
      "Missing AQS_API_EMAIL; generated URLs keep the {AQS_API_EMAIL} placeholder.",
      "Missing AQS_API_KEY; generated URLs keep the {AQS_API_KEY} placeholder.",
    ]);
    expect(airnow?.readinessScore).toBeLessThan(firms?.readinessScore ?? 1);
  });

  it("rejects malformed study bounds", () => {
    expect(() => planCovariateLayers({ ...bounds, east: bounds.west }, ["hrrr-weather"])).toThrow(/Study bounds/);
  });
});
