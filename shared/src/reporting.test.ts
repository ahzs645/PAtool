import { describe, expect, it } from "vitest";

import { samplePasCollection, samplePatSeries } from "./fixtures";
import {
  buildPurpleAirReportSummary,
  buildPurpleAirReportDocument,
  createPurpleAirReportBlueprint,
  computeReportSensorMetrics,
  createPurpleAirReportPlan,
  renderReportDocumentDocx,
  renderReportDocumentHtml,
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

function readStoredZipEntry(zip: Uint8Array, entryPath: string): string {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const decoder = new TextDecoder();
  let offset = 0;

  while (offset < zip.byteLength - 4) {
    const signature = view.getUint32(offset, true);
    if (signature !== 0x04034b50) break;

    const method = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const fileNameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + fileNameLength + extraLength;
    const name = decoder.decode(zip.slice(nameStart, nameStart + fileNameLength));

    if (name === entryPath) {
      expect(method).toBe(0);
      return decoder.decode(zip.slice(dataStart, dataStart + compressedSize));
    }

    offset = dataStart + compressedSize;
  }

  throw new Error(`Missing ZIP entry: ${entryPath}`);
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

  it("renders the generated report document as HTML and DOCX bytes", () => {
    const firstThree = samplePasCollection.records.slice(0, 3);
    const plan = createPurpleAirReportPlan(samplePasCollection, {
      communityName: "Export Community",
      period: {},
      selectedSensorIds: firstThree.map((sensor) => sensor.id),
      options: {
        managementZone: "orange",
        localBylaw: { enabled: true, name: "test bylaw" },
      },
    });
    const summary = buildPurpleAirReportSummary(plan, firstThree.map((sensor, index) => (
      scaledSeries(sensor.id, sensor.label, index + 1)
    )));
    const blueprint = createPurpleAirReportBlueprint(plan, summary);
    const document = buildPurpleAirReportDocument(plan, summary, blueprint);
    const html = renderReportDocumentHtml(document);
    const docx = renderReportDocumentDocx(document);

    expect(html).toContain("Environmental Quality Series");
    expect(html).toContain("Executive Summary");
    expect(html).toContain("3 Temporal Variability");
    expect(html).toContain("4 Spatial Variability");
    expect(html).toContain("<svg");
    expect(html).toContain("Sensor location map");
    expect(docx.length).toBeGreaterThan(1000);
    expect(new TextDecoder().decode(docx.slice(0, 2))).toBe("PK");

    const contentTypesXml = readStoredZipEntry(docx, "[Content_Types].xml");
    expect(contentTypesXml).toContain("word/document.xml");
    expect(contentTypesXml).toContain("image/svg+xml");
    expect(readStoredZipEntry(docx, "word/styles.xml")).toContain("TableGrid");
    expect(readStoredZipEntry(docx, "word/_rels/document.xml.rels")).toContain("media/figure-1.svg");
    expect(readStoredZipEntry(docx, "word/media/figure-1.svg")).toContain("<svg");

    const documentXml = readStoredZipEntry(docx, "word/document.xml");
    expect(documentXml).toMatch(/<w:document[^>]*><w:body>/);
    expect(documentXml).toContain("<w:drawing>");
    expect(documentXml).toContain("3 Temporal Variability");
    expect(documentXml).toContain("4 Spatial Variability");

    const pngDocx = renderReportDocumentDocx(document, {
      figureAssets: [
        {
          data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
          extension: "png",
          contentType: "image/png",
        },
      ],
    });
    expect(readStoredZipEntry(pngDocx, "[Content_Types].xml")).toContain("image/png");
    expect(readStoredZipEntry(pngDocx, "word/_rels/document.xml.rels")).toContain("media/figure-1.png");

    const dirtyDocx = renderReportDocumentDocx({
      ...document,
      title: `${document.title}\u0000`,
      sections: [
        ...document.sections,
        {
          id: "dirty-input",
          title: "Dirty input",
          blocks: [{ kind: "paragraph", text: "bad\u001Fvalue" }],
        },
      ],
    });
    const dirtyDocumentXml = readStoredZipEntry(dirtyDocx, "word/document.xml");
    expect(dirtyDocumentXml).not.toContain("\u0000");
    expect(dirtyDocumentXml).not.toContain("\u001F");
    expect(dirtyDocumentXml).toContain("bad value");
  });
});
