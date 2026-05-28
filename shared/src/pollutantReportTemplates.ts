/**
 * Pollutant-specific EPA reporting template definitions, mirroring the
 * `Reporting_Template_Base_*.pptx` documents shipped with sensortoolkit.
 *
 * These are content templates — section structure, target metrics, and
 * required figures — that the existing PAtool reporting renderer can
 * consume to produce per-pollutant evaluation reports.
 */

import { listSdfsParameters } from "./sdfsParameters";

export type ReportSectionId =
  | "cover"
  | "sensor-description"
  | "site-description"
  | "deployment"
  | "data-completeness"
  | "metrics-summary"
  | "scatter"
  | "timeseries"
  | "distribution"
  | "target-diagram"
  | "climate-stratified"
  | "discussion"
  | "appendix";

export type ReportTemplateSection = {
  id: ReportSectionId;
  title: string;
  required: boolean;
  description: string;
};

export type PollutantReportTemplate = {
  pollutant: string;
  templateName: string;
  averagingPeriod: "1-hour" | "24-hour";
  sections: ReportTemplateSection[];
  performanceTargetsTable: Array<{ metric: string; target: string }>;
};

const COMMON_SECTIONS: ReportTemplateSection[] = [
  { id: "cover", title: "Cover", required: true, description: "Sensor make/model, dates, organisation, primary contact." },
  { id: "sensor-description", title: "Sensor description", required: true, description: "Firmware, recording interval, A/B channel handling." },
  { id: "site-description", title: "Site description", required: true, description: "Location, lat/lon/elevation, land use, met source." },
  { id: "deployment", title: "Deployment summary", required: true, description: "Group ID, start/end, sensor count, reference monitor make/model." },
  { id: "data-completeness", title: "Data completeness", required: true, description: "Uptime per sensor, gap log, warm-up masking." },
  { id: "metrics-summary", title: "Performance metrics", required: true, description: "R², slope/intercept, RMSE, NMB, NMGE, CV vs. EPA target." },
  { id: "scatter", title: "Sensor–reference scatter", required: true, description: "1:1 line, OLS fit, fit-band density." },
  { id: "timeseries", title: "Concurrent time-series", required: true, description: "Sensor and reference overlaid for each deployment period." },
  { id: "distribution", title: "Distribution panels", required: false, description: "Reference concentration, temperature, RH, intervals." },
  { id: "target-diagram", title: "Target diagram", required: false, description: "Normalised bias vs. unbiased RMSE for all sensors." },
  { id: "climate-stratified", title: "Climate-stratified metrics", required: false, description: "Metrics by temperature and humidity bins." },
  { id: "discussion", title: "Discussion", required: false, description: "Drivers of bias, calibration recommendations, downstream caveats." },
  { id: "appendix", title: "Appendix", required: false, description: "Raw QA tables, hardware photos, calibration logs." },
];

function buildTargetsTable(pollutant: string): Array<{ metric: string; target: string }> {
  const sdfs = listSdfsParameters().find((p) => p.name === pollutant);
  const t = sdfs?.performanceTargets ?? {};
  const rows: Array<{ metric: string; target: string }> = [];
  if (t.r2Min !== undefined) rows.push({ metric: "R²", target: `≥ ${t.r2Min.toFixed(2)}` });
  if (t.biasAbsMax !== undefined) rows.push({ metric: "|Bias|", target: `≤ ${t.biasAbsMax} ${sdfs?.units ?? ""}` });
  if (t.rmseMax !== undefined) rows.push({ metric: "RMSE", target: `≤ ${t.rmseMax} ${sdfs?.units ?? ""}` });
  if (t.cvPercentMax !== undefined) rows.push({ metric: "CV", target: `≤ ${t.cvPercentMax}%` });
  if (t.nrmsePercentMax !== undefined) rows.push({ metric: "NRMSE", target: `≤ ${t.nrmsePercentMax}%` });
  return rows;
}

export const POLLUTANT_REPORT_TEMPLATES: Record<string, PollutantReportTemplate> = {
  pm25: {
    pollutant: "pm25",
    templateName: "Reporting_Template_Base_PM25",
    averagingPeriod: "24-hour",
    sections: COMMON_SECTIONS,
    performanceTargetsTable: buildTargetsTable("pm25"),
  },
  pm10: {
    pollutant: "pm10",
    templateName: "Reporting_Template_Base_PM10",
    averagingPeriod: "24-hour",
    sections: COMMON_SECTIONS,
    performanceTargetsTable: buildTargetsTable("pm10"),
  },
  no2: {
    pollutant: "no2",
    templateName: "Reporting_Template_Base_NO2",
    averagingPeriod: "1-hour",
    sections: COMMON_SECTIONS,
    performanceTargetsTable: buildTargetsTable("no2"),
  },
  o3: {
    pollutant: "o3",
    templateName: "Reporting_Template_Base_O3",
    averagingPeriod: "1-hour",
    sections: COMMON_SECTIONS,
    performanceTargetsTable: buildTargetsTable("o3"),
  },
  co: {
    pollutant: "co",
    templateName: "Reporting_Template_Base_CO",
    averagingPeriod: "1-hour",
    sections: COMMON_SECTIONS,
    performanceTargetsTable: buildTargetsTable("co"),
  },
  so2: {
    pollutant: "so2",
    templateName: "Reporting_Template_Base_SO2",
    averagingPeriod: "1-hour",
    sections: COMMON_SECTIONS,
    performanceTargetsTable: buildTargetsTable("so2"),
  },
};

export function getPollutantReportTemplate(pollutant: string): PollutantReportTemplate | null {
  return POLLUTANT_REPORT_TEMPLATES[pollutant.toLowerCase()] ?? null;
}

export function listPollutantReportTemplates(): PollutantReportTemplate[] {
  return Object.values(POLLUTANT_REPORT_TEMPLATES);
}
