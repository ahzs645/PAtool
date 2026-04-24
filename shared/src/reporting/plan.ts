import type { PasCollection, PasRecord, PatSeries } from "../domain";
import { computeReportSensorMetrics } from "./metrics";
import {
  DEFAULT_PURPLEAIR_REPORT_QC_SETTINGS,
  DEFAULT_REPORT_GENERATOR_OPTIONS,
  PURPLEAIR_REPORT_FIGURE_SPECS,
  PURPLEAIR_REPORT_SECTION_DEFINITIONS,
  type ReportGeneratorOptions,
  type ReportFigureReadiness,
  type ReportGenerationPlan,
  type ReportGeneratorInput,
  type ReportMonitoringCandidate,
  type ReportMonitoringPlan,
  type ReportNetworkSummary,
  type ReportRecommendation,
  type ReportPeriod,
  type ReportQcSettings,
  type ReportSourceType,
  type ResolvedReportGeneratorOptions,
  type ReportSectionDefinition,
  type ReportSectionId,
  type ReportSensorPercentDifference,
  type ReportSensorSelection,
} from "./types";

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function sensorHasCoordinates(sensor: PasRecord): boolean {
  return Number.isFinite(sensor.latitude) && Number.isFinite(sensor.longitude);
}

function mergeReportOptions(options: ReportGeneratorOptions | undefined): ResolvedReportGeneratorOptions {
  return {
    managementZone: options?.managementZone ?? DEFAULT_REPORT_GENERATOR_OPTIONS.managementZone,
    emissionInventory: {
      ...DEFAULT_REPORT_GENERATOR_OPTIONS.emissionInventory,
      ...options?.emissionInventory,
    },
    localBylaw: {
      ...DEFAULT_REPORT_GENERATOR_OPTIONS.localBylaw,
      ...options?.localBylaw,
    },
    cleanAirSpaces: {
      ...DEFAULT_REPORT_GENERATOR_OPTIONS.cleanAirSpaces,
      ...options?.cleanAirSpaces,
    },
    sourceAttribution: {
      ...DEFAULT_REPORT_GENERATOR_OPTIONS.sourceAttribution,
      ...options?.sourceAttribution,
      sectors: options?.sourceAttribution?.sectors ?? DEFAULT_REPORT_GENERATOR_OPTIONS.sourceAttribution.sectors,
    },
    wildfireExclusion: {
      ...DEFAULT_REPORT_GENERATOR_OPTIONS.wildfireExclusion,
      ...options?.wildfireExclusion,
      dates: options?.wildfireExclusion?.dates ?? DEFAULT_REPORT_GENERATOR_OPTIONS.wildfireExclusion.dates,
    },
    interventionMonitoring: options?.interventionMonitoring ?? DEFAULT_REPORT_GENERATOR_OPTIONS.interventionMonitoring,
    diurnalWildfireComparison: options?.diurnalWildfireComparison ?? DEFAULT_REPORT_GENERATOR_OPTIONS.diurnalWildfireComparison,
  };
}

function selectedSections(sectionIds?: readonly ReportSectionId[]): ReportSectionDefinition[] {
  if (!sectionIds?.length) return [...PURPLEAIR_REPORT_SECTION_DEFINITIONS];
  const requested = new Set(sectionIds);
  return PURPLEAIR_REPORT_SECTION_DEFINITIONS.filter((section) => requested.has(section.id));
}

function requestPath(sensorId: string, period: ReportPeriod): string {
  const params = new URLSearchParams({ id: sensorId, aggregate: "raw" });
  if (period.start) params.set("start", period.start);
  if (period.end) params.set("end", period.end);
  return `/api/pat?${params.toString()}`;
}

function reportTitle(communityName: string, period: ReportPeriod, title?: string): string {
  if (title?.trim()) return title.trim();
  const suffix = [period.start, period.end].filter(Boolean).join(" to ");
  return suffix
    ? `PurpleAir sensor Air Quality Summary Report: ${communityName} ${suffix}`
    : `PurpleAir sensor Air Quality Summary Report: ${communityName}`;
}

export function selectReportSensors(
  collection: PasCollection,
  selection: ReportSensorSelection = {},
): PasRecord[] {
  const selectedIds = new Set(selection.sensorIds ?? []);
  const labelQuery = selection.labelQuery ? normalizeText(selection.labelQuery) : "";
  const maxSensors = selection.maxSensors ?? Number.POSITIVE_INFINITY;

  return collection.records
    .filter((sensor) => {
      if (selection.outsideOnly && sensor.locationType === "inside") return false;
      if (selectedIds.size && !selectedIds.has(sensor.id)) return false;
      if (labelQuery && !normalizeText(sensor.label).includes(labelQuery)) return false;
      return true;
    })
    .slice(0, maxSensors);
}

export function createPurpleAirReportPlan(
  collection: PasCollection,
  input: ReportGeneratorInput,
): ReportGenerationPlan {
  const qc: ReportQcSettings = {
    ...DEFAULT_PURPLEAIR_REPORT_QC_SETTINGS,
    ...input.qc,
  };
  const options = mergeReportOptions(input.options);
  const sensors = selectReportSensors(collection, {
    sensorIds: input.selectedSensorIds,
    outsideOnly: true,
    maxSensors: input.selectedSensorIds?.length ? undefined : 12,
  });
  const sections = selectedSections(input.sections);
  const sectionIds = new Set(sections.map((section) => section.id));
  const figures = PURPLEAIR_REPORT_FIGURE_SPECS.filter((figure) => sectionIds.has(figure.sectionId));
  const notes: string[] = [];

  if (!sensors.length) {
    notes.push("No sensors selected for this report.");
  }
  if (sensors.some((sensor) => !sensorHasCoordinates(sensor))) {
    notes.push("One or more selected sensors are missing coordinates; map and IDW outputs may be incomplete.");
  }

  return {
    title: reportTitle(input.communityName, input.period, input.title),
    communityName: input.communityName,
    period: input.period,
    sensors,
    sections,
    figures,
    qc,
    options,
    seriesRequests: sensors.map((sensor) => ({
      sensorId: sensor.id,
      path: requestPath(sensor.id, input.period),
      aggregate: "raw" as const,
    })),
    notes,
  };
}

function computePercentDifferences(
  plan: ReportGenerationPlan,
  seriesList: readonly PatSeries[],
  networkMean: number | null,
): ReportSensorPercentDifference[] {
  return plan.sensors.map((sensor) => {
    const series = seriesList.find((item) => item.meta.sensorId === sensor.id);
    if (!series || networkMean === null || networkMean === 0) {
      return {
        sensorId: sensor.id,
        label: sensor.label,
        meanPm25: null,
        percentDifference: null,
      };
    }
    const metrics = computeReportSensorMetrics(series, plan.period, plan.qc);
    return {
      sensorId: sensor.id,
      label: sensor.label,
      meanPm25: metrics.meanPm25,
      percentDifference: metrics.meanPm25 === null
        ? null
        : Number((((metrics.meanPm25 - networkMean) / networkMean) * 100).toFixed(1)),
    };
  });
}

function readyMessage(ready: boolean, reason: string): string {
  return ready ? "Ready" : reason;
}

function computeFigureReadiness(
  plan: ReportGenerationPlan,
  percentDifferences: readonly ReportSensorPercentDifference[],
): ReportFigureReadiness[] {
  const coordinateCount = plan.sensors.filter(sensorHasCoordinates).length;
  const selectedCount = plan.sensors.length;
  const validMeanCount = percentDifferences.filter((row) => row.meanPm25 !== null).length;
  const hasMultipleSensors = validMeanCount >= 2;
  const hasSpatialSurfaceInputs = coordinateCount >= 3 && validMeanCount >= 3;

  return plan.figures.map((figure) => {
    let ready = true;
    let reason = "Ready";

    if (figure.id === "sensor-location-map") {
      ready = coordinateCount > 0;
      reason = readyMessage(ready, "Needs selected sensors with coordinates.");
    } else if (figure.id === "diurnal-wildfire-comparison") {
      ready = Boolean(
        plan.options.diurnalWildfireComparison &&
        plan.options.wildfireExclusion.enabled &&
        (plan.options.wildfireExclusion.dates.length > 0 || plan.options.wildfireExclusion.sourceLabel) &&
        validMeanCount > 0,
      );
      reason = readyMessage(ready, "Needs wildfire exclusion dates or a bulletin source.");
    } else if (figure.id === "sensor-correlation") {
      ready = hasMultipleSensors;
      reason = readyMessage(ready, "Needs at least two sensors with valid daily means.");
    } else if (
      figure.id === "percent-difference-ranking" ||
      figure.id === "seasonal-percent-difference-ranking" ||
      figure.id === "weekday-pattern" ||
      figure.id === "daily-distribution-boxplot"
    ) {
      ready = validMeanCount > 0;
      reason = readyMessage(ready, "Needs at least one sensor with valid daily means.");
    } else if (figure.id === "wildfire-excluded-percent-difference-ranking") {
      ready = false;
      reason = "Needs wildfire exclusion dates and eligible seasonal sensor means.";
    } else if (figure.kind === "idw") {
      ready = hasSpatialSurfaceInputs;
      reason = readyMessage(ready, "Needs at least three selected sensors with coordinates and valid means.");
    } else if (figure.id === "wind-contribution") {
      ready = Boolean(
        plan.options.sourceAttribution.enabled &&
        plan.options.sourceAttribution.hotspotSensorId &&
        plan.options.sourceAttribution.windSourceLabel &&
        plan.options.sourceAttribution.sectors.length > 0,
      );
      reason = readyMessage(ready, "Needs a wind-direction source, hotspot sensor, and directional source sectors.");
    } else if (figure.id === "co-location") {
      ready = false;
      reason = "Needs a paired FEM/reference monitor series.";
    } else if (selectedCount === 0) {
      ready = false;
      reason = "Needs selected sensors.";
    }

    return {
      figureId: figure.id,
      label: figure.label,
      ready,
      reason,
    };
  });
}

function sourceTypeLabel(sourceType: ReportSourceType): string {
  switch (sourceType) {
    case "residential-wood-smoke":
      return "residential wood-burning";
    case "industrial":
      return "industrial emissions";
    case "transportation":
      return "transportation";
    case "open-burning":
      return "open burning";
    case "wildfire":
      return "wildfire smoke";
    case "other":
      return "other local sources";
  }
}

function managementZoneMessage(zone: ResolvedReportGeneratorOptions["managementZone"]): string | null {
  if (zone === "red") {
    return "The selected community is configured as a red management zone, so recommendations should emphasize active emission reductions and follow-up monitoring.";
  }
  if (zone === "orange") {
    return "The selected community is configured as an orange management zone, so recommendations should emphasize preventing CAAQS exceedance.";
  }
  if (zone === "green" || zone === "yellow") {
    return `The selected community is configured as a ${zone} management zone; recommendations can focus on maintenance and targeted prevention.`;
  }
  return null;
}

function buildRecommendations(
  plan: ReportGenerationPlan,
  percentDifferences: readonly ReportSensorPercentDifference[],
): ReportRecommendation[] {
  const recommendations: ReportRecommendation[] = [];
  const hottest = pickExtreme(percentDifferences, "max");
  const sourceTypes = new Set(plan.options.sourceAttribution.sectors.map((sector) => sector.sourceType));
  const zoneMessage = managementZoneMessage(plan.options.managementZone);
  const emissionInventoryLabel = plan.options.emissionInventory.label ?? "local emission inventory";

  if (zoneMessage || plan.options.emissionInventory.enabled) {
    recommendations.push({
      id: "governance-aqmp",
      category: "governance",
      title: "Use a working group to turn findings into an AQMP workplan",
      body: [
        zoneMessage,
        plan.options.emissionInventory.enabled
          ? `Use the ${emissionInventoryLabel} to connect observed hotspots with known source categories and short-, medium-, and long-term reduction actions.`
          : "Use the sensor findings to focus local air quality planning on observed hotspots and source categories.",
      ].filter(Boolean).join(" "),
      priority: "conditional",
    });
  }

  if (plan.options.cleanAirSpaces.enabled) {
    const partnerText = plan.options.cleanAirSpaces.partnerOrganization
      ? ` Partner with ${plan.options.cleanAirSpaces.partnerOrganization} on public guidance.`
      : "";
    const diyText = plan.options.cleanAirSpaces.includeDiyAirCleaner
      ? " Include practical guidance for portable HEPA cleaners and DIY box-fan/furnace-filter cleaners."
      : "";
    recommendations.push({
      id: "wildfire-clean-air-spaces",
      category: "wildfire-smoke",
      title: "Provide clean-air-space guidance for wildfire smoke",
      body: `Identify public clean air spaces and educate residents on creating cleaner indoor air at home.${diyText}${partnerText}`,
      priority: "core",
    });
  }

  if (sourceTypes.has("industrial") || plan.options.emissionInventory.enabled) {
    const industrialSector = plan.options.sourceAttribution.sectors.find((sector) => sector.sourceType === "industrial");
    recommendations.push({
      id: "industrial-emissions-review",
      category: "industrial",
      title: "Review industrial PM2.5 reduction opportunities",
      body: industrialSector
        ? `Wind/source metadata links ${industrialSector.label ?? sourceTypeLabel(industrialSector.sourceType)} to the ${industrialSector.direction} sector; assess emission controls and options to reduce emissions during poor-air-quality periods.`
        : "Assess local industrial sources, available emission-control technology, and options to reduce emissions during poor-air-quality periods.",
      priority: "conditional",
    });
  }

  if (sourceTypes.has("residential-wood-smoke") || hottest) {
    recommendations.push({
      id: "wood-smoke-reduction",
      category: "wood-smoke",
      title: "Target wood-smoke reduction toward recurring hotspots",
      body: hottest
        ? `Prioritize outreach and wood-smoke reduction programs near ${hottest.label}, the highest relative sensor in the selected report period.`
        : "Prioritize outreach and wood-smoke reduction programs near recurring winter or fall hotspots.",
      priority: "core",
    });
  }

  if (plan.options.localBylaw.enabled) {
    const bylawName = plan.options.localBylaw.name ?? "local solid-fuel-burning bylaw";
    const trigger = plan.options.localBylaw.trigger ?? DEFAULT_REPORT_GENERATOR_OPTIONS.localBylaw.trigger;
    recommendations.push({
      id: "local-bylaw",
      category: "bylaw",
      title: "Connect local bylaw language to warning periods",
      body: `Reference ${bylawName} in public communication, especially when ${trigger}.`,
      priority: "conditional",
    });
  }

  if (plan.options.interventionMonitoring) {
    recommendations.push({
      id: "intervention-monitoring",
      category: "monitoring",
      title: "Retain a smaller network for before/during/after intervention checks",
      body: "Continue monitoring at the most distinct hotspots and coldspots, rather than every study sensor, to evaluate whether reduction efforts change PM2.5 patterns.",
      priority: "conditional",
    });
  }

  return recommendations;
}

function buildMonitoringPlan(
  plan: ReportGenerationPlan,
  percentDifferences: readonly ReportSensorPercentDifference[],
): ReportMonitoringPlan | null {
  if (!plan.options.interventionMonitoring) return null;
  const valid = percentDifferences.filter((row) => row.percentDifference !== null);
  if (!valid.length) return null;
  const retainIds = new Set(
    [...valid]
      .sort((left, right) => Math.abs(right.percentDifference ?? 0) - Math.abs(left.percentDifference ?? 0))
      .slice(0, Math.min(4, valid.length))
      .map((row) => row.sensorId),
  );

  const retainedSensors: ReportMonitoringCandidate[] = percentDifferences.map((row) => {
    const retain = retainIds.has(row.sensorId);
    return {
      sensorId: row.sensorId,
      label: row.label,
      meanPm25: row.meanPm25,
      percentDifference: row.percentDifference,
      retain,
      reason: retain
        ? "Retain for follow-up because it is one of the most distinct selected sensors."
        : "Candidate for removal if future monitoring needs a smaller focused network.",
    };
  });

  return {
    enabled: true,
    retainedSensors,
    rationale: "Retain the strongest relative hotspots/coldspots for intervention tracking and remove less distinctive sensors when a smaller future network is needed.",
  };
}

function pickExtreme(
  rows: readonly ReportSensorPercentDifference[],
  direction: "max" | "min",
): ReportSensorPercentDifference | null {
  const valid = rows.filter((row) => row.percentDifference !== null);
  if (!valid.length) return null;
  return valid.reduce((best, row) => {
    if (best.percentDifference === null || row.percentDifference === null) return best;
    return direction === "max"
      ? (row.percentDifference > best.percentDifference ? row : best)
      : (row.percentDifference < best.percentDifference ? row : best);
  }, valid[0]);
}

function buildFindings(
  networkMean: number | null,
  hottestSensor: ReportSensorPercentDifference | null,
  coldestSensor: ReportSensorPercentDifference | null,
): string[] {
  const findings: string[] = [];
  if (networkMean !== null) {
    findings.push(`Network mean PM2.5 is ${networkMean.toFixed(1)} ug/m3 for the selected sensors and period.`);
  }
  if (hottestSensor?.percentDifference !== null && hottestSensor?.percentDifference !== undefined) {
    findings.push(`${hottestSensor.label} is the highest relative sensor at ${hottestSensor.percentDifference.toFixed(1)}% from the network mean.`);
  }
  if (coldestSensor?.percentDifference !== null && coldestSensor?.percentDifference !== undefined) {
    findings.push(`${coldestSensor.label} is the lowest relative sensor at ${coldestSensor.percentDifference.toFixed(1)}% from the network mean.`);
  }
  if (!findings.length) {
    findings.push("Load sensor time series to generate data-driven report findings.");
  }
  return findings;
}

export function buildPurpleAirReportSummary(
  plan: ReportGenerationPlan,
  seriesList: readonly PatSeries[],
): ReportNetworkSummary {
  const sensorMetrics = seriesList.map((series) => computeReportSensorMetrics(series, plan.period, plan.qc));
  const validMeans = sensorMetrics.map((metrics) => metrics.meanPm25).filter((value): value is number => value !== null);
  const networkMean = validMeans.length
    ? Number((validMeans.reduce((sum, value) => sum + value, 0) / validMeans.length).toFixed(3))
    : null;
  const percentDifferences = computePercentDifferences(plan, seriesList, networkMean);
  const hottestSensor = pickExtreme(percentDifferences, "max");
  const coldestSensor = pickExtreme(percentDifferences, "min");
  const recommendations = buildRecommendations(plan, percentDifferences);
  const monitoringPlan = buildMonitoringPlan(plan, percentDifferences);

  return {
    title: plan.title,
    communityName: plan.communityName,
    generatedAt: new Date().toISOString(),
    period: plan.period,
    sensorMetrics,
    networkMeanPm25: networkMean,
    hottestSensor,
    coldestSensor,
    percentDifferences,
    figureReadiness: computeFigureReadiness(plan, percentDifferences),
    recommendations,
    monitoringPlan,
    findings: buildFindings(networkMean, hottestSensor, coldestSensor),
  };
}
