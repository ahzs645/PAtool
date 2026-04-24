import type { ReportFigureSpec, ReportGenerationPlan, ReportNetworkSummary, ReportSectionId } from "./types";

export type ReportTemplateInputId =
  | "sensor-inventory"
  | "purpleair-timeseries"
  | "community-context"
  | "study-boundary"
  | "reference-monitor"
  | "meteorology"
  | "wildfire-periods"
  | "recommendation-context";

export type ReportTemplateInput = {
  id: ReportTemplateInputId;
  label: string;
  required: boolean;
  description: string;
};

export type ReportTemplateStep = {
  id: string;
  label: string;
  sectionId: ReportSectionId;
  description: string;
  inputIds: readonly ReportTemplateInputId[];
  figureIds: readonly string[];
};

export type ReportTemplateBlueprint = {
  title: string;
  templateName: string;
  selectedSensorCount: number;
  requiredInputs: ReportTemplateInput[];
  optionalInputs: ReportTemplateInput[];
  steps: ReportTemplateStep[];
  missingRequiredInputs: string[];
  missingOptionalInputs: string[];
  readyFigureIds: string[];
  blockedFigureIds: string[];
};

export const PURPLEAIR_SUMMARY_REPORT_INPUTS: readonly ReportTemplateInput[] = [
  {
    id: "sensor-inventory",
    label: "Sensor inventory",
    required: true,
    description: "Selected outdoor PurpleAir sensors with labels, coordinates, and location metadata.",
  },
  {
    id: "purpleair-timeseries",
    label: "PurpleAir time series",
    required: true,
    description: "Raw channel A/B PM2.5, humidity, and timestamps for every selected sensor and report period.",
  },
  {
    id: "community-context",
    label: "Community context",
    required: true,
    description: "Population, airshed status, partners, known PM2.5 sources, and report-period framing.",
  },
  {
    id: "study-boundary",
    label: "Study boundary",
    required: true,
    description: "Map extent or boundary used for location maps and spatial interpolation outputs.",
  },
  {
    id: "recommendation-context",
    label: "Recommendation context",
    required: true,
    description: "Local programs, bylaws, management plans, and known source areas used to draft recommendations.",
  },
  {
    id: "reference-monitor",
    label: "Reference monitor series",
    required: false,
    description: "FEM/reference PM2.5 series for co-location and PurpleAir bias checks.",
  },
  {
    id: "meteorology",
    label: "Meteorology",
    required: false,
    description: "Wind direction and related weather data used to attribute hotspot contributions.",
  },
  {
    id: "wildfire-periods",
    label: "Wildfire periods",
    required: false,
    description: "Dates to annotate or exclude when separating wildfire smoke from local PM2.5 sources.",
  },
];

export const PURPLEAIR_SUMMARY_REPORT_STEPS: readonly ReportTemplateStep[] = [
  {
    id: "assemble-front-matter",
    label: "Assemble front matter",
    sectionId: "front-matter",
    description: "Create cover metadata, citation fields, acknowledgements, contents, figure list, table list, and acronyms.",
    inputIds: ["community-context"],
    figureIds: [],
  },
  {
    id: "draft-executive-summary",
    label: "Draft executive summary",
    sectionId: "executive-summary",
    description: "Summarize the project purpose, report period, main hot/cold spots, source interpretation, and local actions.",
    inputIds: ["community-context", "recommendation-context", "wildfire-periods"],
    figureIds: ["percent-difference-ranking"],
  },
  {
    id: "document-sensor-network",
    label: "Document sensor network",
    sectionId: "data-collection",
    description: "Describe PurpleAir sensors, selected locations, correction model, QC rules, and data-capture thresholds.",
    inputIds: ["sensor-inventory", "purpleair-timeseries", "study-boundary"],
    figureIds: ["sensor-location-map", "data-capture"],
  },
  {
    id: "compute-temporal-results",
    label: "Compute temporal results",
    sectionId: "temporal-results",
    description: "Build monthly mean, monthly 98th percentile daily PM2.5, weekday, and seasonal diurnal summaries.",
    inputIds: ["purpleair-timeseries", "wildfire-periods"],
    figureIds: ["monthly-mean-tile", "monthly-p98-tile", "seasonal-diurnal", "diurnal-wildfire-comparison", "weekday-pattern"],
  },
  {
    id: "compute-spatial-results",
    label: "Compute spatial results",
    sectionId: "spatial-results",
    description: "Compare aligned daily sensor data, rank hotspots/coldspots, and generate optional spatial surfaces.",
    inputIds: ["sensor-inventory", "purpleair-timeseries", "study-boundary"],
    figureIds: [
      "sensor-correlation",
      "daily-distribution-boxplot",
      "percent-difference-ranking",
      "seasonal-percent-difference-ranking",
      "wildfire-excluded-percent-difference-ranking",
      "annual-idw",
      "seasonal-idw",
    ],
  },
  {
    id: "attribute-source-patterns",
    label: "Attribute source patterns",
    sectionId: "spatial-results",
    description: "Use wind direction and wildfire exclusions to distinguish local source patterns from wildfire smoke.",
    inputIds: ["purpleair-timeseries", "meteorology", "wildfire-periods"],
    figureIds: ["wind-contribution"],
  },
  {
    id: "build-appendices",
    label: "Build appendices",
    sectionId: "appendix",
    description: "Add co-location checks, seasonal data capture, full daily time series, and interpolation parameter notes.",
    inputIds: ["purpleair-timeseries", "reference-monitor"],
    figureIds: ["co-location", "data-capture", "full-timeseries"],
  },
];

function figureById(figures: readonly ReportFigureSpec[], id: string): ReportFigureSpec | undefined {
  return figures.find((figure) => figure.id === id);
}

export function createPurpleAirReportBlueprint(
  plan: ReportGenerationPlan,
  summary: ReportNetworkSummary | null,
): ReportTemplateBlueprint {
  const readyFigureIds = summary?.figureReadiness.filter((figure) => figure.ready).map((figure) => figure.figureId) ?? [];
  const blockedFigureIds = summary?.figureReadiness.filter((figure) => !figure.ready).map((figure) => figure.figureId) ?? [];
  const selectedFigureIds = new Set(plan.figures.map((figure) => figure.id));
  const selectedSteps = PURPLEAIR_SUMMARY_REPORT_STEPS.filter((step) => {
    if (!plan.sections.some((section) => section.id === step.sectionId)) return false;
    return step.figureIds.length === 0 || step.figureIds.some((figureId) => selectedFigureIds.has(figureId));
  });
  const availableInputIds = new Set<ReportTemplateInputId>();

  if (plan.sensors.length > 0) availableInputIds.add("sensor-inventory");
  if (summary && summary.sensorMetrics.length > 0) availableInputIds.add("purpleair-timeseries");
  if (plan.communityName.trim()) availableInputIds.add("community-context");
  if (
    plan.options.managementZone !== "unknown" ||
    plan.options.emissionInventory.enabled ||
    plan.options.localBylaw.enabled ||
    plan.options.cleanAirSpaces.enabled ||
    plan.options.sourceAttribution.enabled
  ) {
    availableInputIds.add("recommendation-context");
  }
  if (
    plan.options.sourceAttribution.enabled &&
    plan.options.sourceAttribution.windSourceLabel &&
    plan.options.sourceAttribution.hotspotSensorId
  ) {
    availableInputIds.add("meteorology");
  }
  if (
    plan.options.wildfireExclusion.enabled &&
    (plan.options.wildfireExclusion.dates.length > 0 || plan.options.wildfireExclusion.sourceLabel)
  ) {
    availableInputIds.add("wildfire-periods");
  }

  const missingRequiredInputs = PURPLEAIR_SUMMARY_REPORT_INPUTS
    .filter((input) => input.required && !availableInputIds.has(input.id))
    .map((input) => input.label);
  const missingOptionalInputs = PURPLEAIR_SUMMARY_REPORT_INPUTS
    .filter((input) => !input.required && !availableInputIds.has(input.id))
    .map((input) => input.label);

  if (plan.sensors.some((sensor) => !Number.isFinite(sensor.latitude) || !Number.isFinite(sensor.longitude))) {
    missingRequiredInputs.push("Coordinates for all selected sensors");
  }
  if (plan.figures.some((figure) => figure.kind === "idw") && plan.sensors.length < 3) {
    missingRequiredInputs.push("At least three selected sensors for IDW surfaces");
  }

  return {
    title: plan.title,
    templateName: "BC PurpleAir air quality summary report",
    selectedSensorCount: plan.sensors.length,
    requiredInputs: PURPLEAIR_SUMMARY_REPORT_INPUTS.filter((input) => input.required),
    optionalInputs: PURPLEAIR_SUMMARY_REPORT_INPUTS.filter((input) => !input.required),
    steps: selectedSteps.map((step) => ({
      ...step,
      figureIds: step.figureIds.filter((figureId) => figureById(plan.figures, figureId)),
    })),
    missingRequiredInputs,
    missingOptionalInputs,
    readyFigureIds,
    blockedFigureIds,
  };
}
