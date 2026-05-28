/**
 * SDFS (Sensor Deployment File System) standardized parameter dictionary
 * shipped with sensortoolkit. Each pollutant entry carries AQS unit
 * codes, averaging periods, and EPA performance targets.
 */

export type SdfsParameter = {
  name: string;
  displayName: string;
  units: string;
  aqsParameterCode: string;
  aqsUnitCode: string;
  averagingPeriods: Array<"1-hour" | "8-hour" | "24-hour" | "annual">;
  performanceTargets?: {
    r2Min?: number;
    biasAbsMax?: number;
    rmseMax?: number;
    cvPercentMax?: number;
    nrmsePercentMax?: number;
  };
};

export const SDFS_PARAMETERS: Record<string, SdfsParameter> = {
  pm1: {
    name: "pm1",
    displayName: "PM₁",
    units: "µg/m³",
    aqsParameterCode: "85101",
    aqsUnitCode: "105",
    averagingPeriods: ["1-hour", "24-hour"],
  },
  pm25: {
    name: "pm25",
    displayName: "PM₂.₅",
    units: "µg/m³",
    aqsParameterCode: "88101",
    aqsUnitCode: "105",
    averagingPeriods: ["1-hour", "24-hour", "annual"],
    performanceTargets: {
      r2Min: 0.7,
      biasAbsMax: 5,
      rmseMax: 7,
      cvPercentMax: 30,
      nrmsePercentMax: 30,
    },
  },
  pm10: {
    name: "pm10",
    displayName: "PM₁₀",
    units: "µg/m³",
    aqsParameterCode: "81102",
    aqsUnitCode: "105",
    averagingPeriods: ["1-hour", "24-hour"],
    performanceTargets: {
      r2Min: 0.7,
      biasAbsMax: 7,
      rmseMax: 14,
      cvPercentMax: 30,
      nrmsePercentMax: 30,
    },
  },
  no: {
    name: "no",
    displayName: "NO",
    units: "ppb",
    aqsParameterCode: "42601",
    aqsUnitCode: "008",
    averagingPeriods: ["1-hour", "annual"],
  },
  no2: {
    name: "no2",
    displayName: "NO₂",
    units: "ppb",
    aqsParameterCode: "42602",
    aqsUnitCode: "008",
    averagingPeriods: ["1-hour", "annual"],
    performanceTargets: { r2Min: 0.8, biasAbsMax: 5, rmseMax: 5 },
  },
  nox: {
    name: "nox",
    displayName: "NOₓ",
    units: "ppb",
    aqsParameterCode: "42603",
    aqsUnitCode: "008",
    averagingPeriods: ["1-hour"],
  },
  o3: {
    name: "o3",
    displayName: "O₃",
    units: "ppb",
    aqsParameterCode: "44201",
    aqsUnitCode: "008",
    averagingPeriods: ["1-hour", "8-hour"],
    performanceTargets: { r2Min: 0.8, biasAbsMax: 5, rmseMax: 5 },
  },
  co: {
    name: "co",
    displayName: "CO",
    units: "ppm",
    aqsParameterCode: "42101",
    aqsUnitCode: "007",
    averagingPeriods: ["1-hour", "8-hour"],
  },
  so2: {
    name: "so2",
    displayName: "SO₂",
    units: "ppb",
    aqsParameterCode: "42401",
    aqsUnitCode: "008",
    averagingPeriods: ["1-hour"],
  },
  so: {
    name: "so",
    displayName: "SO",
    units: "ppb",
    aqsParameterCode: "42402",
    aqsUnitCode: "008",
    averagingPeriods: ["1-hour"],
  },
};

export function listSdfsParameters(): SdfsParameter[] {
  return Object.values(SDFS_PARAMETERS);
}

export function getSdfsParameter(name: string): SdfsParameter | null {
  return SDFS_PARAMETERS[name.toLowerCase()] ?? null;
}
