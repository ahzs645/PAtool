/**
 * sensortoolkit-style deployment metadata schema. Mirrors the
 * `AirSensor`, `ReferenceMonitor`, and `deploy_dict` Python objects
 * used by EPA's reference protocols.
 *
 * The shape is intentionally documentation-rich because regulatory
 * reports demand it. All fields are optional except `id`/`make`/`model`
 * so partial metadata roundtrips through the schema.
 */

export type SensorDeploymentRange = {
  /** First valid observation timestamp (ISO). */
  start?: string;
  /** Last valid observation timestamp (ISO). */
  end?: string;
};

export type SensorPerformanceRange = {
  min: number;
  max: number;
  unit?: string;
};

export type SensorContact = {
  name?: string;
  organization?: string;
  email?: string;
  phone?: string;
};

export type AirSensorMetadata = {
  id: string;
  make: string;
  model: string;
  firmware?: string;
  serial?: string;
  recordingIntervalSeconds?: number;
  temperatureRange?: SensorPerformanceRange;
  humidityRange?: SensorPerformanceRange;
  pressureRange?: SensorPerformanceRange;
  pollutantsMeasured?: string[];
  setupNotes?: string;
};

export type ReferenceMonitorMetadata = {
  id: string;
  make: string;
  model: string;
  methodCode?: string;
  designation?: "FRM" | "FEM" | "non-FRM" | "non-FEM";
  pollutant: string;
  units: string;
  accuracy?: string;
  servicedDate?: string;
};

export type DeploymentEntry = {
  groupId: string;
  sensors: AirSensorMetadata[];
  referenceMonitors: ReferenceMonitorMetadata[];
  /** Start/end of the deployment period (commonly UTC). */
  deploymentPeriod: SensorDeploymentRange;
  siteName: string;
  siteLatitude?: number;
  siteLongitude?: number;
  siteElevationM?: number;
  /** Inclusive reference 1-hour and 24-hour concentration ranges observed at the site. */
  referenceHourlyRange?: { min: number; max: number };
  referenceDailyRange?: { min: number; max: number };
  /** Met conditions observed during the deployment, by parameter. */
  meteorology?: Record<string, SensorPerformanceRange>;
  organization?: string;
  contact?: SensorContact;
  /** Free-form fields captured at deployment (calibration date, co-location duration, etc.) */
  notes?: string;
};

export type DeploymentDictionary = {
  campaignId: string;
  campaignName?: string;
  pollutant: string;
  entries: DeploymentEntry[];
};

export function emptyDeploymentDictionary(campaignId: string, pollutant: string): DeploymentDictionary {
  return { campaignId, pollutant, entries: [] };
}

/**
 * Summarise a deployment dictionary as a flat report-ready table.
 * Each row corresponds to one (deployment, sensor) pairing.
 */
export type DeploymentSummaryRow = {
  groupId: string;
  sensorId: string;
  sensorMakeModel: string;
  referenceMakeModel: string;
  start: string;
  end: string;
  siteName: string;
  refHourlyMax?: number;
  refDailyMax?: number;
};

export function summarizeDeployment(dict: DeploymentDictionary): DeploymentSummaryRow[] {
  const rows: DeploymentSummaryRow[] = [];
  for (const entry of dict.entries) {
    const ref = entry.referenceMonitors[0];
    const refLabel = ref ? `${ref.make} ${ref.model}` : "—";
    for (const sensor of entry.sensors) {
      rows.push({
        groupId: entry.groupId,
        sensorId: sensor.id,
        sensorMakeModel: `${sensor.make} ${sensor.model}`,
        referenceMakeModel: refLabel,
        start: entry.deploymentPeriod.start ?? "",
        end: entry.deploymentPeriod.end ?? "",
        siteName: entry.siteName,
        refHourlyMax: entry.referenceHourlyRange?.max,
        refDailyMax: entry.referenceDailyRange?.max,
      });
    }
  }
  return rows;
}

/**
 * Coefficient of variation (CV) across collocated identical sensors at
 * each timestamp. Mirrors EPA's intra-sensor precision metric used to
 * report deployment uniformity.
 */
export type CvOptions = {
  /** Minimum number of valid concurrent sensors needed to compute CV. Default 3. */
  minSensors?: number;
};

export type CvSeries = {
  datetime: string[];
  cv: Array<number | null>;
  mean: Array<number | null>;
  sd: Array<number | null>;
};

export function coefficientOfVariation(
  datetime: ReadonlyArray<string>,
  collocated: ReadonlyArray<ReadonlyArray<number | null>>,
  options: CvOptions = {},
): CvSeries {
  const minSensors = Math.max(2, options.minSensors ?? 3);
  const cv: Array<number | null> = [];
  const mean: Array<number | null> = [];
  const sd: Array<number | null> = [];
  for (let i = 0; i < datetime.length; i += 1) {
    const vals = collocated
      .map((series) => series[i])
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (vals.length < minSensors) {
      cv.push(null);
      mean.push(null);
      sd.push(null);
      continue;
    }
    const m = vals.reduce((s, v) => s + v, 0) / vals.length;
    const variance = vals.reduce((s, v) => s + (v - m) ** 2, 0) / (vals.length - 1);
    const stdDev = Math.sqrt(variance);
    mean.push(m);
    sd.push(stdDev);
    cv.push(m === 0 ? null : (stdDev / m) * 100);
  }
  return { datetime: [...datetime], cv, mean, sd };
}

/**
 * Aggregate CV across a deployment to a single summary metric (the
 * EPA target is ≤ 30% for PM₂.₅).
 */
export function summarizeCv(series: CvSeries): { mean: number; max: number; n: number } {
  const valid = series.cv.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (valid.length === 0) return { mean: 0, max: 0, n: 0 };
  return {
    mean: valid.reduce((s, v) => s + v, 0) / valid.length,
    max: Math.max(...valid),
    n: valid.length,
  };
}
