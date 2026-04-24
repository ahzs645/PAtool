import type { PasRecord } from "../domain";

export type ReportSectionId =
  | "front-matter"
  | "executive-summary"
  | "introduction"
  | "data-collection"
  | "temporal-results"
  | "spatial-results"
  | "recommendations"
  | "appendix";

export type ReportFigureKind =
  | "map"
  | "tile"
  | "line"
  | "heatmap"
  | "boxplot"
  | "lollipop"
  | "idw"
  | "wind"
  | "table"
  | "timeseries"
  | "weekday";

export type ReportSeason = "winter" | "spring" | "summer" | "fall";

export type ReportManagementZone = "unknown" | "green" | "yellow" | "orange" | "red";

export type ReportSourceType =
  | "residential-wood-smoke"
  | "industrial"
  | "transportation"
  | "open-burning"
  | "wildfire"
  | "other";

export type ReportSourceSector = {
  direction: string;
  sourceType: ReportSourceType;
  label?: string;
};

export type ReportPeriod = {
  start?: string;
  end?: string;
};

export type ReportSectionDefinition = {
  id: ReportSectionId;
  title: string;
  purpose: string;
};

export const PURPLEAIR_REPORT_SECTION_DEFINITIONS: readonly ReportSectionDefinition[] = [
  {
    id: "front-matter",
    title: "Front matter",
    purpose: "Cover, publication metadata, contents, figures, tables, acronyms, and citation metadata.",
  },
  {
    id: "executive-summary",
    title: "Executive summary",
    purpose: "Study purpose, period, key hotspot/coldspot findings, and local recommendations.",
  },
  {
    id: "introduction",
    title: "Introduction",
    purpose: "Community context, PM2.5 health context, pollutant sources, partners, and management status.",
  },
  {
    id: "data-collection",
    title: "Data collection and sensor locations",
    purpose: "PurpleAir background, sensor inventory, location map, QC, correction, and data capture rules.",
  },
  {
    id: "temporal-results",
    title: "Temporal variability",
    purpose: "Monthly averages, monthly 98th percentile daily PM2.5, seasonal diurnal patterns, and weekday patterns.",
  },
  {
    id: "spatial-results",
    title: "Spatial variability",
    purpose: "Sensor correlations, daily distributions, relative hotspot/coldspot rankings, IDW maps, and wind attribution.",
  },
  {
    id: "recommendations",
    title: "Conclusions and recommendations",
    purpose: "Narrative conclusions and recommendation blocks keyed to wildfire smoke, wood smoke, road dust, and monitoring gaps.",
  },
  {
    id: "appendix",
    title: "Appendix",
    purpose: "Co-location checks, data capture plots, full timeseries, IDW parameters, and future network notes.",
  },
];

export type ReportFigureSpec = {
  id: string;
  label: string;
  sectionId: ReportSectionId;
  kind: ReportFigureKind;
  required: boolean;
  inputs: readonly string[];
};

export const PURPLEAIR_REPORT_FIGURE_SPECS: readonly ReportFigureSpec[] = [
  {
    id: "sensor-location-map",
    label: "Sensor location map",
    sectionId: "data-collection",
    kind: "map",
    required: true,
    inputs: ["sensor inventory", "coordinates", "study bounds"],
  },
  {
    id: "monthly-mean-tile",
    label: "Monthly average PM2.5 tile plot",
    sectionId: "temporal-results",
    kind: "tile",
    required: true,
    inputs: ["hourly PM2.5", "daily valid means", "sensor ordering"],
  },
  {
    id: "monthly-p98-tile",
    label: "Monthly 98th percentile daily PM2.5 tile plot",
    sectionId: "temporal-results",
    kind: "tile",
    required: true,
    inputs: ["daily valid PM2.5", "percentile setting", "sensor ordering"],
  },
  {
    id: "seasonal-diurnal",
    label: "Seasonal diurnal PM2.5 profiles",
    sectionId: "temporal-results",
    kind: "line",
    required: true,
    inputs: ["hourly PM2.5", "season definitions", "study years"],
  },
  {
    id: "diurnal-wildfire-comparison",
    label: "Diurnal profiles with and without wildfire influence",
    sectionId: "temporal-results",
    kind: "line",
    required: false,
    inputs: ["hourly PM2.5", "wildfire exclusion dates", "season definitions"],
  },
  {
    id: "weekday-pattern",
    label: "Weekday PM2.5 patterns",
    sectionId: "temporal-results",
    kind: "weekday",
    required: false,
    inputs: ["daily valid PM2.5", "weekday labels", "sensor ordering"],
  },
  {
    id: "sensor-correlation",
    label: "Sensor correlation matrix",
    sectionId: "spatial-results",
    kind: "heatmap",
    required: true,
    inputs: ["aligned daily PM2.5 by sensor"],
  },
  {
    id: "daily-distribution-boxplot",
    label: "Daily PM2.5 distribution boxplot",
    sectionId: "spatial-results",
    kind: "boxplot",
    required: true,
    inputs: ["daily valid PM2.5 by sensor and year"],
  },
  {
    id: "percent-difference-ranking",
    label: "Percent difference from network mean",
    sectionId: "spatial-results",
    kind: "lollipop",
    required: true,
    inputs: ["eligible sensor means", "network baseline mean"],
  },
  {
    id: "seasonal-percent-difference-ranking",
    label: "Seasonal percent difference from network mean",
    sectionId: "spatial-results",
    kind: "lollipop",
    required: true,
    inputs: ["eligible seasonal sensor means", "network baseline mean", "season definitions"],
  },
  {
    id: "wildfire-excluded-percent-difference-ranking",
    label: "Seasonal percent difference excluding wildfire smoke days",
    sectionId: "spatial-results",
    kind: "lollipop",
    required: false,
    inputs: ["eligible seasonal sensor means", "wildfire exclusion dates", "network baseline mean"],
  },
  {
    id: "annual-idw",
    label: "Annual IDW hotspot/coldspot surface",
    sectionId: "spatial-results",
    kind: "idw",
    required: false,
    inputs: ["sensor means", "coordinates", "study boundary", "IDW power"],
  },
  {
    id: "seasonal-idw",
    label: "Seasonal IDW hotspot/coldspot surfaces",
    sectionId: "spatial-results",
    kind: "idw",
    required: false,
    inputs: ["seasonal sensor means", "coordinates", "study boundary", "IDW power"],
  },
  {
    id: "wind-contribution",
    label: "Wind-direction contribution for hotspot sensor",
    sectionId: "spatial-results",
    kind: "wind",
    required: false,
    inputs: ["hotspot PM2.5", "wind direction", "wildfire exclusion dates"],
  },
  {
    id: "co-location",
    label: "PurpleAir/FEM co-location comparison",
    sectionId: "appendix",
    kind: "table",
    required: false,
    inputs: ["co-located PurpleAir series", "FEM monitor series", "concentration bins"],
  },
  {
    id: "data-capture",
    label: "Seasonal data capture",
    sectionId: "appendix",
    kind: "table",
    required: true,
    inputs: ["valid hourly PM2.5", "season definitions", "capture thresholds"],
  },
  {
    id: "full-timeseries",
    label: "Full daily PM2.5 timeseries",
    sectionId: "appendix",
    kind: "timeseries",
    required: false,
    inputs: ["daily valid PM2.5", "AQO threshold"],
  },
];

export type ReportQcSettings = {
  absoluteChannelDifference: number;
  relativeChannelDifference: number;
  minRelativeHumidity: number;
  maxRelativeHumidity: number;
  requireRelativeHumidity: boolean;
  minDailyValidHours: number;
  dailyCaptureThreshold: number;
  seasonalCaptureThreshold: number;
  annualCaptureThreshold: number;
  requiredValidSeasons: number;
  percentile: number;
  aqoDailyThreshold: number;
  correctionModelLabel: string;
};

export const DEFAULT_PURPLEAIR_REPORT_QC_SETTINGS: ReportQcSettings = {
  absoluteChannelDifference: 5,
  relativeChannelDifference: 0.5,
  minRelativeHumidity: 30,
  maxRelativeHumidity: 70,
  requireRelativeHumidity: false,
  minDailyValidHours: 18,
  dailyCaptureThreshold: 0.75,
  seasonalCaptureThreshold: 0.6,
  annualCaptureThreshold: 0.75,
  requiredValidSeasons: 6,
  percentile: 0.98,
  aqoDailyThreshold: 25,
  correctionModelLabel: "Nilson et al. 2022 Model 2",
};

export type ReportSensorSelection = {
  sensorIds?: readonly string[];
  outsideOnly?: boolean;
  labelQuery?: string;
  maxSensors?: number;
};

export type ReportGeneratorInput = {
  title?: string;
  communityName: string;
  period: ReportPeriod;
  selectedSensorIds?: readonly string[];
  sections?: readonly ReportSectionId[];
  qc?: Partial<ReportQcSettings>;
  options?: ReportGeneratorOptions;
};

export type ReportEmissionInventoryConfig = {
  enabled: boolean;
  label?: string;
  url?: string;
  citation?: string;
};

export type ReportLocalBylawConfig = {
  enabled: boolean;
  name?: string;
  trigger?: string;
  url?: string;
};

export type ReportCleanAirSpaceConfig = {
  enabled: boolean;
  includeDiyAirCleaner: boolean;
  partnerOrganization?: string;
};

export type ReportSourceAttributionConfig = {
  enabled: boolean;
  hotspotSensorId?: string;
  hotspotSensorLabel?: string;
  windSourceLabel?: string;
  valleyOrientation?: "east-west" | "north-south" | "complex" | "unknown";
  sectors: readonly ReportSourceSector[];
};

export type ReportWildfireExclusionConfig = {
  enabled: boolean;
  region?: string;
  sourceLabel?: string;
  dates?: readonly string[];
};

export type ReportGeneratorOptions = {
  managementZone?: ReportManagementZone;
  emissionInventory?: Partial<ReportEmissionInventoryConfig>;
  localBylaw?: Partial<ReportLocalBylawConfig>;
  cleanAirSpaces?: Partial<ReportCleanAirSpaceConfig>;
  sourceAttribution?: Partial<ReportSourceAttributionConfig>;
  wildfireExclusion?: Partial<ReportWildfireExclusionConfig>;
  interventionMonitoring?: boolean;
  diurnalWildfireComparison?: boolean;
};

export type ResolvedReportGeneratorOptions = {
  managementZone: ReportManagementZone;
  emissionInventory: ReportEmissionInventoryConfig;
  localBylaw: ReportLocalBylawConfig;
  cleanAirSpaces: ReportCleanAirSpaceConfig;
  sourceAttribution: ReportSourceAttributionConfig;
  wildfireExclusion: ReportWildfireExclusionConfig & { dates: readonly string[] };
  interventionMonitoring: boolean;
  diurnalWildfireComparison: boolean;
};

export const DEFAULT_REPORT_GENERATOR_OPTIONS = {
  managementZone: "unknown",
  emissionInventory: { enabled: false },
  localBylaw: {
    enabled: false,
    trigger: "air quality warnings are in effect",
  },
  cleanAirSpaces: {
    enabled: true,
    includeDiyAirCleaner: false,
  },
  sourceAttribution: {
    enabled: false,
    valleyOrientation: "unknown",
    sectors: [],
  },
  wildfireExclusion: {
    enabled: false,
    dates: [],
  },
  interventionMonitoring: true,
  diurnalWildfireComparison: false,
} as const satisfies ResolvedReportGeneratorOptions;

export type ReportSeriesRequest = {
  sensorId: string;
  path: string;
  aggregate: "raw" | "hourly";
};

export type ReportGenerationPlan = {
  title: string;
  communityName: string;
  period: ReportPeriod;
  sensors: PasRecord[];
  sections: ReportSectionDefinition[];
  figures: ReportFigureSpec[];
  qc: ReportQcSettings;
  options: ResolvedReportGeneratorOptions;
  seriesRequests: ReportSeriesRequest[];
  notes: string[];
};

export type ReportMonthlyMetric = {
  sensorId: string;
  month: string;
  meanPm25: number | null;
  p98DailyPm25: number | null;
  validDailyCount: number;
  expectedDailyCount: number;
  captureFraction: number;
};

export type ReportSeasonalCapture = {
  sensorId: string;
  season: ReportSeason;
  seasonYear: number;
  validDailyCount: number;
  expectedDailyCount: number;
  captureFraction: number;
  meetsThreshold: boolean;
};

export type ReportDiurnalProfile = {
  sensorId: string;
  season: ReportSeason;
  seasonYear: number;
  hour: number;
  meanPm25: number | null;
  count: number;
};

export type ReportDailyMetric = {
  sensorId: string;
  date: string;
  meanPm25: number | null;
  validHourCount: number;
  meetsDailyCapture: boolean;
};

export type ReportSensorMetrics = {
  sensorId: string;
  label: string;
  timezone: string;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  validHourlyCount: number;
  validDailyCount: number;
  expectedDailyCount: number;
  dailyCaptureFraction: number;
  meanPm25: number | null;
  medianDailyPm25: number | null;
  p98DailyPm25: number | null;
  monthly: ReportMonthlyMetric[];
  seasonalCapture: ReportSeasonalCapture[];
  diurnalProfiles: ReportDiurnalProfile[];
  daily: ReportDailyMetric[];
  warnings: string[];
};

export type ReportFigureReadiness = {
  figureId: string;
  label: string;
  ready: boolean;
  reason: string;
};

export type ReportSensorPercentDifference = {
  sensorId: string;
  label: string;
  meanPm25: number | null;
  percentDifference: number | null;
};

export type ReportRecommendationCategory =
  | "wildfire-smoke"
  | "wood-smoke"
  | "industrial"
  | "governance"
  | "bylaw"
  | "monitoring";

export type ReportRecommendation = {
  id: string;
  category: ReportRecommendationCategory;
  title: string;
  body: string;
  priority: "core" | "conditional";
};

export type ReportMonitoringCandidate = {
  sensorId: string;
  label: string;
  meanPm25: number | null;
  percentDifference: number | null;
  retain: boolean;
  reason: string;
};

export type ReportMonitoringPlan = {
  enabled: boolean;
  retainedSensors: ReportMonitoringCandidate[];
  rationale: string;
};

export type ReportNetworkSummary = {
  title: string;
  communityName: string;
  generatedAt: string;
  period: ReportPeriod;
  sensorMetrics: ReportSensorMetrics[];
  networkMeanPm25: number | null;
  hottestSensor: ReportSensorPercentDifference | null;
  coldestSensor: ReportSensorPercentDifference | null;
  percentDifferences: ReportSensorPercentDifference[];
  figureReadiness: ReportFigureReadiness[];
  recommendations: ReportRecommendation[];
  monitoringPlan: ReportMonitoringPlan | null;
  findings: string[];
};
