import type { AreaBounds } from "./domain";

export type CovariateLayerId =
  | "hrrr-weather"
  | "nlcd-land-cover"
  | "tiger-roads"
  | "acs-population"
  | "osm-overture-pois"
  | "nasa-firms"
  | "noaa-hms-smoke"
  | "airnow-aqs-monitors";

export type CovariateLayerKind = "raster" | "vector" | "tabular" | "point" | "polygon";

export type CovariateLayerCadence = "hourly" | "daily" | "annual" | "decennial" | "static" | "near-real-time";

export type CovariateLayerAccess = "public-api" | "public-download" | "public-with-key" | "bulk-download";

export type CovariateLayerDefinition = {
  id: CovariateLayerId;
  label: string;
  provider: string;
  kind: CovariateLayerKind;
  cadence: CovariateLayerCadence;
  access: CovariateLayerAccess;
  pm25Relevance: string;
  featureIdeas: string[];
  urlTemplates: string[];
  cacheSupport: "strong" | "moderate" | "limited";
  cacheNote: string;
  staticSupport: "static" | "time-varying" | "mixed";
  staticNote: string;
  requiredEnv: string[];
  keyNote: string;
};

export type CovariateLayerPlannerOptions = {
  date?: string;
  cycle?: string;
  forecastHour?: string;
  censusVintage?: string;
  width?: number;
  height?: number;
  env?: Record<string, string | undefined>;
};

export type CovariateLayerPlan = {
  id: CovariateLayerId;
  label: string;
  sourceUrls: string[];
  cacheSupportNote: string;
  staticSupportNote: string;
  requiredEnv: string[];
  keyNote: string;
  warnings: string[];
  readinessScore: number;
};

export type CovariateLayerPlannerResult = {
  bounds: AreaBounds;
  selectedLayerIds: CovariateLayerId[];
  layers: CovariateLayerPlan[];
  readinessScore: number;
};

type TemplateContext = Required<Omit<CovariateLayerPlannerOptions, "env">> & AreaBounds & {
  bbox: string;
  bboxCsv: string;
  bboxEncoded: string;
  bboxJsonEncoded: string;
  overpassBbox: string;
};

const DEFAULT_CONTEXT = {
  date: "2024-08-01",
  cycle: "00",
  forecastHour: "00",
  censusVintage: "2022",
  width: 1024,
  height: 1024,
};

export const COVARIATE_LAYER_MANIFEST: readonly CovariateLayerDefinition[] = [
  {
    id: "hrrr-weather",
    label: "HRRR surface weather",
    provider: "NOAA/NCEP",
    kind: "raster",
    cadence: "hourly",
    access: "public-api",
    pm25Relevance: "Boundary-layer mixing, wind, temperature, humidity, and precipitation explain PM2.5 transport and sensor response.",
    featureIdeas: ["u/v wind", "temperature", "relative humidity", "planetary boundary layer height", "precipitation"],
    urlTemplates: [
      "https://nomads.ncep.noaa.gov/cgi-bin/filter_hrrr_2d.pl?dir=/hrrr.{date}/conus&file=hrrr.t{cycle}z.wrfsfcf{forecastHour}.grib2&var_GUST=on&var_HPBL=on&var_RH=on&var_TMP=on&var_UGRD=on&var_VGRD=on&lev_2_m_above_ground=on&lev_10_m_above_ground=on&lev_surface=on&subregion=&leftlon={west}&rightlon={east}&toplat={north}&bottomlat={south}",
    ],
    cacheSupport: "moderate",
    cacheNote: "Cache by model run, forecast hour, variable set, and clipped bounds; HRRR files are immutable once the run is archived.",
    staticSupport: "time-varying",
    staticNote: "Use timestamped joins or lagged summaries; do not treat HRRR weather as static across a study period.",
    requiredEnv: [],
    keyNote: "No API key is required for the NOMADS filter endpoint, but bulk use should respect NOAA service limits.",
  },
  {
    id: "nlcd-land-cover",
    label: "NLCD land cover",
    provider: "MRLC/USGS",
    kind: "raster",
    cadence: "annual",
    access: "public-download",
    pm25Relevance: "Impervious surface, tree canopy, and land-cover class help characterize urban form, dust, and deposition context.",
    featureIdeas: ["land-cover class fractions", "impervious percentage", "tree canopy percentage", "distance to developed classes"],
    urlTemplates: [
      "https://www.mrlc.gov/geoserver/mrlc_display/NLCD_2021_Land_Cover_L48/wms?service=WMS&version=1.1.0&request=GetMap&layers=mrlc_display:NLCD_2021_Land_Cover_L48&styles=&bbox={bboxCsv}&width={width}&height={height}&srs=EPSG:4326&format=image/geotiff",
    ],
    cacheSupport: "strong",
    cacheNote: "Cache clipped rasters indefinitely with a layer-year key; NLCD release years are versioned.",
    staticSupport: "static",
    staticNote: "Treat as static within most PM2.5 modeling windows; refresh only when changing NLCD release year.",
    requiredEnv: [],
    keyNote: "No API key is required for public MRLC download/WMS access.",
  },
  {
    id: "tiger-roads",
    label: "TIGER roads",
    provider: "US Census Bureau",
    kind: "vector",
    cadence: "annual",
    access: "public-api",
    pm25Relevance: "Road density and distance-to-road features proxy traffic emissions and near-road concentration gradients.",
    featureIdeas: ["primary-road distance", "road length density", "MTFCC class counts", "intersection density"],
    urlTemplates: [
      "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Transportation/MapServer/0/query?where=1%3D1&outFields=FULLNAME,MTFCC&geometry={bboxJsonEncoded}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outSR=4326&f=geojson",
    ],
    cacheSupport: "strong",
    cacheNote: "Cache by TIGER vintage and bounds; road geometry changes slowly for most modeling studies.",
    staticSupport: "static",
    staticNote: "Use as a static spatial covariate unless explicitly modeling infrastructure changes by year.",
    requiredEnv: [],
    keyNote: "No API key is required for TIGERweb query endpoints.",
  },
  {
    id: "acs-population",
    label: "ACS population and demographics",
    provider: "US Census Bureau",
    kind: "tabular",
    cadence: "annual",
    access: "public-api",
    pm25Relevance: "Population density and demographic variables support exposure weighting and environmental-justice covariates.",
    featureIdeas: ["population density", "age shares", "income", "vehicle access", "housing density"],
    urlTemplates: [
      "https://api.census.gov/data/{censusVintage}/acs/acs5?get=NAME,B01003_001E,B01001_001E,B19013_001E&for=tract:*&in=state:*",
    ],
    cacheSupport: "strong",
    cacheNote: "Cache by ACS vintage, geography level, and variable list; responses are stable after release.",
    staticSupport: "static",
    staticNote: "Treat as static for short PM2.5 campaigns; align vintage to the study year when possible.",
    requiredEnv: [],
    keyNote: "A Census key is optional for light use; configure CENSUS_API_KEY for larger batch jobs.",
  },
  {
    id: "osm-overture-pois",
    label: "OSM/Overture POIs",
    provider: "OpenStreetMap/Overture Maps",
    kind: "point",
    cadence: "near-real-time",
    access: "public-api",
    pm25Relevance: "POI density can proxy restaurants, industry, fuel stations, schools, and other localized activity patterns.",
    featureIdeas: ["restaurant density", "fuel-station distance", "industrial POI counts", "school proximity", "commercial intensity"],
    urlTemplates: [
      "https://overpass-api.de/api/interpreter?data=[out:json][timeout:25];(node[amenity]({overpassBbox});way[amenity]({overpassBbox});node[shop]({overpassBbox});way[shop]({overpassBbox}););out center tags;",
      "https://docs.overturemaps.org/getting-data/",
    ],
    cacheSupport: "moderate",
    cacheNote: "Cache extracted POIs with the provider snapshot date; OSM live extracts are mutable.",
    staticSupport: "mixed",
    staticNote: "Use a dated extract for reproducible studies; live Overpass results should be considered time-varying metadata.",
    requiredEnv: [],
    keyNote: "Overpass does not require a key; Overture bulk access is public but usually queried through local files or cloud tables.",
  },
  {
    id: "nasa-firms",
    label: "NASA FIRMS active fire detections",
    provider: "NASA FIRMS",
    kind: "point",
    cadence: "near-real-time",
    access: "public-with-key",
    pm25Relevance: "Satellite fire detections indicate likely smoke sources for episodic PM2.5 spikes and source attribution.",
    featureIdeas: ["nearest fire distance", "fire radiative power sum", "upwind fire count", "detection age"],
    urlTemplates: [
      "https://firms.modaps.eosdis.nasa.gov/api/area/csv/{NASA_FIRMS_MAP_KEY}/VIIRS_SNPP_NRT/{bbox}/1/{date}",
    ],
    cacheSupport: "moderate",
    cacheNote: "Cache by sensor, date, day range, and bounds; near-real-time records may be superseded by standard products.",
    staticSupport: "time-varying",
    staticNote: "Use daily or hourly temporal joins; fire detections are event covariates, not static site attributes.",
    requiredEnv: ["NASA_FIRMS_MAP_KEY"],
    keyNote: "Requires NASA_FIRMS_MAP_KEY for FIRMS API URLs.",
  },
  {
    id: "noaa-hms-smoke",
    label: "NOAA HMS smoke polygons",
    provider: "NOAA NESDIS",
    kind: "polygon",
    cadence: "daily",
    access: "public-download",
    pm25Relevance: "Smoke plume polygons provide categorical smoke-presence and density covariates for wildfire PM2.5 events.",
    featureIdeas: ["smoke density", "inside plume", "distance to plume edge", "plume persistence"],
    urlTemplates: [
      "https://www.ospo.noaa.gov/products/land/hms/data/{date}/hms_smoke{date}.zip",
    ],
    cacheSupport: "strong",
    cacheNote: "Cache by HMS analysis date; daily shapefiles/GeoJSON conversions are stable once published.",
    staticSupport: "time-varying",
    staticNote: "Join by analysis date and density class; plume membership changes day to day.",
    requiredEnv: [],
    keyNote: "No API key is required for public HMS smoke archives.",
  },
  {
    id: "airnow-aqs-monitors",
    label: "AirNow/AQS reference monitors",
    provider: "EPA AirNow and AQS",
    kind: "point",
    cadence: "hourly",
    access: "public-with-key",
    pm25Relevance: "Regulatory PM2.5 observations support calibration, validation, bias correction, and background concentration features.",
    featureIdeas: ["nearest reference PM2.5", "monitor distance", "regional background", "collocation residuals"],
    urlTemplates: [
      "https://www.airnowapi.org/aq/data/?startDate={date}T00&endDate={date}T23&parameters=PM25&BBOX={bbox}&dataType=B&format=application/json&API_KEY={AIRNOW_API_KEY}",
      "https://aqs.epa.gov/data/api/monitors/byBox?email={AQS_API_EMAIL}&key={AQS_API_KEY}&param=88101&bdate={date}&edate={date}&minlat={south}&maxlat={north}&minlon={west}&maxlon={east}",
    ],
    cacheSupport: "moderate",
    cacheNote: "Cache by provider, parameter, hour/day, and bounds; distinguish preliminary AirNow data from final AQS data.",
    staticSupport: "mixed",
    staticNote: "Monitor locations are mostly static, but PM2.5 observations are time-varying and should be joined by timestamp.",
    requiredEnv: ["AIRNOW_API_KEY", "AQS_API_EMAIL", "AQS_API_KEY"],
    keyNote: "AirNow requires AIRNOW_API_KEY; AQS API calls require AQS_API_EMAIL and AQS_API_KEY.",
  },
] as const;

const DEFINITIONS_BY_ID = new Map<CovariateLayerId, CovariateLayerDefinition>(
  COVARIATE_LAYER_MANIFEST.map((definition) => [definition.id, definition]),
);

export function listCovariateLayerDefinitions(): CovariateLayerDefinition[] {
  return COVARIATE_LAYER_MANIFEST.map((definition) => ({ ...definition, featureIdeas: [...definition.featureIdeas], urlTemplates: [...definition.urlTemplates], requiredEnv: [...definition.requiredEnv] }));
}

export function getCovariateLayerDefinition(id: CovariateLayerId): CovariateLayerDefinition {
  const definition = DEFINITIONS_BY_ID.get(id);
  if (!definition) {
    throw new Error(`Unknown covariate layer id: ${id}`);
  }
  return { ...definition, featureIdeas: [...definition.featureIdeas], urlTemplates: [...definition.urlTemplates], requiredEnv: [...definition.requiredEnv] };
}

export function buildBboxParam(bounds: AreaBounds): string {
  assertValidBounds(bounds);
  return [bounds.west, bounds.south, bounds.east, bounds.north].map(formatCoordinate).join(",");
}

export function buildBboxCsv(bounds: AreaBounds): string {
  return buildBboxParam(bounds);
}

export function buildOverpassBbox(bounds: AreaBounds): string {
  assertValidBounds(bounds);
  return [bounds.south, bounds.west, bounds.north, bounds.east].map(formatCoordinate).join(",");
}

export function buildArcGisEnvelope(bounds: AreaBounds): string {
  assertValidBounds(bounds);
  return JSON.stringify({
    xmin: Number(formatCoordinate(bounds.west)),
    ymin: Number(formatCoordinate(bounds.south)),
    xmax: Number(formatCoordinate(bounds.east)),
    ymax: Number(formatCoordinate(bounds.north)),
    spatialReference: { wkid: 4326 },
  });
}

export function buildUrlFromTemplate(
  template: string,
  bounds: AreaBounds,
  options: CovariateLayerPlannerOptions = {},
): string {
  const context = buildTemplateContext(bounds, options);
  const env = options.env ?? {};
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, key: string) => {
    if (key in context) {
      return encodeUrlValue(String(context[key as keyof TemplateContext]), key);
    }
    const envValue = env[key];
    if (envValue) {
      return encodeURIComponent(envValue);
    }
    return match;
  });
}

export function planCovariateLayers(
  bounds: AreaBounds,
  selectedLayerIds: readonly CovariateLayerId[],
  options: CovariateLayerPlannerOptions = {},
): CovariateLayerPlannerResult {
  assertValidBounds(bounds);
  const layers = selectedLayerIds.map((id) => {
    const definition = getCovariateLayerDefinition(id);
    return planLayer(definition, bounds, options);
  });
  const readinessScore = roundScore(average(layers.map((layer) => layer.readinessScore)));
  return {
    bounds: { ...bounds },
    selectedLayerIds: [...selectedLayerIds],
    layers,
    readinessScore,
  };
}

function planLayer(
  definition: CovariateLayerDefinition,
  bounds: AreaBounds,
  options: CovariateLayerPlannerOptions,
): CovariateLayerPlan {
  const env = options.env ?? {};
  const missingEnv = definition.requiredEnv.filter((key) => !env[key]);
  const warnings = missingEnv.map((key) => `Missing ${key}; generated URLs keep the {${key}} placeholder.`);
  const sourceUrls = definition.urlTemplates.map((template) => buildUrlFromTemplate(template, bounds, options));
  return {
    id: definition.id,
    label: definition.label,
    sourceUrls,
    cacheSupportNote: definition.cacheNote,
    staticSupportNote: definition.staticNote,
    requiredEnv: [...definition.requiredEnv],
    keyNote: definition.keyNote,
    warnings,
    readinessScore: scoreLayer(definition, missingEnv.length),
  };
}

function buildTemplateContext(bounds: AreaBounds, options: CovariateLayerPlannerOptions): TemplateContext {
  assertValidBounds(bounds);
  const context = { ...DEFAULT_CONTEXT, ...options };
  const bbox = buildBboxParam(bounds);
  const envelope = buildArcGisEnvelope(bounds);
  return {
    ...bounds,
    date: context.date,
    cycle: context.cycle,
    forecastHour: context.forecastHour,
    censusVintage: context.censusVintage,
    width: context.width,
    height: context.height,
    bbox,
    bboxCsv: bbox,
    bboxEncoded: encodeURIComponent(bbox),
    bboxJsonEncoded: encodeURIComponent(envelope),
    overpassBbox: buildOverpassBbox(bounds),
  };
}

function scoreLayer(definition: CovariateLayerDefinition, missingEnvCount: number): number {
  const accessScore = definition.access === "public-api" || definition.access === "public-download" ? 0.95 : definition.access === "bulk-download" ? 0.82 : 0.75;
  const cacheScore = definition.cacheSupport === "strong" ? 0.95 : definition.cacheSupport === "moderate" ? 0.82 : 0.65;
  const staticScore = definition.staticSupport === "static" ? 0.95 : definition.staticSupport === "mixed" ? 0.78 : 0.68;
  const envPenalty = missingEnvCount * 0.18;
  return roundScore(Math.max(0, accessScore * 0.4 + cacheScore * 0.3 + staticScore * 0.3 - envPenalty));
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatCoordinate(value: number): string {
  return Number(value.toFixed(6)).toString();
}

function encodeUrlValue(value: string, key: string): string {
  if (key === "bboxJsonEncoded" || key === "bboxEncoded") {
    return value;
  }
  return value;
}

function assertValidBounds(bounds: AreaBounds): void {
  if (
    !Number.isFinite(bounds.north)
    || !Number.isFinite(bounds.south)
    || !Number.isFinite(bounds.east)
    || !Number.isFinite(bounds.west)
    || bounds.north <= bounds.south
    || bounds.east <= bounds.west
  ) {
    throw new Error("Study bounds must have finite north/south/east/west values with north > south and east > west.");
  }
}
