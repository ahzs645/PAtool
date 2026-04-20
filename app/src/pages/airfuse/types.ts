export type AirFuseLayerKey = "airfuse-pm25" | "airfuse-o3" | "goes-pm25";
export type AirFuseSource = "fusion" | "goes";
export type AirFuseSpecies = "PM25" | "O3";
export type ArtifactKind = "geojson" | "csv" | "netcdf";

export type AirFuseLayerConfig = {
  key: AirFuseLayerKey;
  label: string;
  shortLabel: string;
  source: AirFuseSource;
  species: AirFuseSpecies;
  expectedDailyCount: number;
  unit: string;
  observedColumn?: string;
  predictedColumn?: string;
};

export type AirFuseIndex = Record<string, unknown>;
export type AirFuseHourEntry = Record<string, string>;

export type ActiveArtifact = {
  layer: AirFuseLayerConfig;
  timestamp: string;
  geojsonPath: string;
  csvPath?: string;
  netcdfPath?: string;
  featureCount: number;
  description?: string;
};

export type ValidationResult = {
  observedColumn: string;
  predictedColumn: string;
  n: number;
  rmse: number;
  mae: number;
  bias: number;
  r: number;
  slope: number;
  intercept: number;
  maxAxis: number;
  points: Array<[number, number]>;
};
