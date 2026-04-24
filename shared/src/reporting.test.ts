import { describe, expect, it } from "vitest";

import { samplePasCollection, samplePatSeries } from "./fixtures";
import {
  buildPurpleAirReportSummary,
  createPurpleAirReportBlueprint,
  computeReportSensorMetrics,
  createPurpleAirReportPlan,
  selectReportSensors,
  type PatSeries,
} from "./index";

function scaledSeries(sensorId: string, label: string, scale: number): PatSeries {
  return {
    ...samplePatSeries,
    meta: {
      ...samplePatSeries.meta,
      sensorId,
      label,
    },
    points: samplePatSeries.points.map((point) => ({
      ...point,
      pm25A: point.pm25A === null ? null : Number((point.pm25A * scale).toFixed(3)),
      pm25B: point.pm25B === null ? null : Number((point.pm25B * scale).toFixed(3)),
    })),
  };
}

describe("reporting", () => {
  it("selects outdoor sensors for report generation", () => {
    const sensors = selectReportSensors(samplePasCollection, { outsideOnly: true, maxSensors: 3 });
    expect(sensors).toHaveLength(3);
    expect(sensors.every((sensor) => sensor.locationType !== "inside")).toBe(true);
  });

  it("computes report metrics from a PurpleAir time series", () => {
    const metrics = computeReportSensorMetrics(samplePatSeries);
    expect(metrics.sensorId).toBe(samplePatSeries.meta.sensorId);
    expect(metrics.validHourlyCount).toBeGreaterThan(0);
    expect(metrics.validDailyCount).toBeGreaterThan(0);
    expect(metrics.monthly.length).toBeGreaterThan(0);
    expect(metrics.seasonalCapture.length).toBeGreaterThan(0);
    expect(metrics.p98DailyPm25).not.toBeNull();
  });

  it("builds a report plan and network summary for selected sensors", () => {
    const firstTwo = samplePasCollection.records.slice(0, 2);
    const start = samplePatSeries.points[0].timestamp.slice(0, 10);
    const end = samplePatSeries.points.at(-1)?.timestamp.slice(0, 10) ?? start;
    const plan = createPurpleAirReportPlan(samplePasCollection, {
      communityName: "Test Community",
      period: { start, end },
      selectedSensorIds: firstTwo.map((sensor) => sensor.id),
    });
    const summary = buildPurpleAirReportSummary(plan, [
      scaledSeries(firstTwo[0].id, firstTwo[0].label, 1),
      scaledSeries(firstTwo[1].id, firstTwo[1].label, 2),
    ]);

    expect(plan.seriesRequests).toHaveLength(2);
    expect(summary.networkMeanPm25).not.toBeNull();
    expect(summary.hottestSensor?.sensorId).toBe(firstTwo[1].id);
    expect(summary.coldestSensor?.sensorId).toBe(firstTwo[0].id);
    expect(summary.figureReadiness.find((figure) => figure.figureId === "co-location")?.ready).toBe(false);
  });

  it("builds a reusable report-generation blueprint from a plan and summary", () => {
    const firstThree = samplePasCollection.records.slice(0, 3);
    const plan = createPurpleAirReportPlan(samplePasCollection, {
      communityName: "Blueprint Community",
      period: {},
      selectedSensorIds: firstThree.map((sensor) => sensor.id),
    });
    const summary = buildPurpleAirReportSummary(plan, firstThree.map((sensor, index) => (
      scaledSeries(sensor.id, sensor.label, index + 1)
    )));
    const blueprint = createPurpleAirReportBlueprint(plan, summary);

    expect(blueprint.templateName).toContain("PurpleAir");
    expect(blueprint.selectedSensorCount).toBe(3);
    expect(blueprint.steps.map((step) => step.id)).toContain("compute-temporal-results");
    expect(blueprint.requiredInputs.map((input) => input.id)).toContain("sensor-inventory");
    expect(blueprint.missingOptionalInputs).toContain("Reference monitor series");
    expect(blueprint.readyFigureIds).toContain("percent-difference-ranking");
  });

  it("turns Vanderhoof-style add-ons into consistent recommendations and readiness", () => {
    const firstThree = samplePasCollection.records.slice(0, 3);
    const plan = createPurpleAirReportPlan(samplePasCollection, {
      communityName: "Source Community",
      period: {},
      selectedSensorIds: firstThree.map((sensor) => sensor.id),
      options: {
        managementZone: "red",
        emissionInventory: { enabled: true, label: "local emission inventory" },
        localBylaw: { enabled: true, name: "solid fuel appliance bylaw" },
        cleanAirSpaces: { enabled: true, includeDiyAirCleaner: true, partnerOrganization: "local health authority" },
        sourceAttribution: {
          enabled: true,
          hotspotSensorId: firstThree[0].id,
          windSourceLabel: "courthouse met tower",
          sectors: [
            { direction: "east", sourceType: "residential-wood-smoke", label: "residential area" },
            { direction: "west", sourceType: "industrial", label: "industrial area" },
          ],
        },
        wildfireExclusion: { enabled: true, sourceLabel: "regional smoky-skies bulletins" },
        diurnalWildfireComparison: true,
        interventionMonitoring: true,
      },
    });
    const summary = buildPurpleAirReportSummary(plan, firstThree.map((sensor, index) => (
      scaledSeries(sensor.id, sensor.label, index + 1)
    )));
    const blueprint = createPurpleAirReportBlueprint(plan, summary);

    expect(summary.recommendations.map((recommendation) => recommendation.id)).toEqual(
      expect.arrayContaining([
        "governance-aqmp",
        "industrial-emissions-review",
        "local-bylaw",
        "intervention-monitoring",
      ]),
    );
    expect(summary.monitoringPlan?.retainedSensors.some((sensor) => sensor.retain)).toBe(true);
    expect(summary.figureReadiness.find((figure) => figure.figureId === "wind-contribution")?.ready).toBe(true);
    expect(summary.figureReadiness.find((figure) => figure.figureId === "diurnal-wildfire-comparison")?.ready).toBe(true);
    expect(blueprint.missingOptionalInputs).not.toContain("Meteorology");
    expect(blueprint.missingOptionalInputs).not.toContain("Wildfire periods");
  });
});
