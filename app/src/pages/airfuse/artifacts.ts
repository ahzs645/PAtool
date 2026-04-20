import { pad2, utcParts } from "./time";
import type { AirFuseHourEntry, AirFuseIndex, AirFuseLayerConfig, ArtifactKind } from "./types";

export function artifactDirectory(layer: AirFuseLayerConfig, value: string): string {
  const { yyyy, mm, dd, hh } = utcParts(value);
  return layer.source === "goes"
    ? `goes/${layer.species}/${yyyy}/${mm}/${dd}/${hh}`
    : `fusion/${layer.species}/${yyyy}/${mm}/${dd}/${hh}`;
}

export function artifactFileName(layer: AirFuseLayerConfig, value: string, kind: ArtifactKind): string | null {
  const { yyyy, mm, dd, hh } = utcParts(value);

  if (layer.key === "goes-pm25") {
    return kind === "geojson" ? `pm25_gwr_aod_exp50_${yyyy}${mm}${dd}${hh}_dnn.geojson` : null;
  }

  if (layer.key === "airfuse-o3") {
    const stem = `Fusion_O3_NAQFC_airnow_${yyyy}-${mm}-${dd}T${hh}Z`;
    if (kind === "geojson") return `${stem}.geojson`;
    if (kind === "csv") return `${stem}_CV.csv`;
    return `${stem}.nc`;
  }

  const stem = `Fusion_PM25_NAQFC_${yyyy}-${mm}-${dd}T${hh}Z`;
  if (kind === "geojson") return `${stem}.geojson`;
  if (kind === "csv") return `${stem}_AirNow_CV.csv`;
  return `${stem}.nc`;
}

function layerTree(index: AirFuseIndex | undefined, layer: AirFuseLayerConfig): Record<string, unknown> | undefined {
  const source = index?.[layer.source];
  if (!source || typeof source !== "object") return undefined;
  const species = (source as Record<string, unknown>)[layer.species];
  return species && typeof species === "object" ? species as Record<string, unknown> : undefined;
}

function hourEntry(index: AirFuseIndex | undefined, layer: AirFuseLayerConfig, value: string): AirFuseHourEntry | null {
  const tree = layerTree(index, layer);
  if (!tree) return null;
  const { yyyy, mm, dd, hh } = utcParts(value);
  const year = tree[yyyy] as Record<string, unknown> | undefined;
  const month = year?.[mm] as Record<string, unknown> | undefined;
  const day = month?.[dd] as Record<string, unknown> | undefined;
  const hour = day?.[hh] as Record<string, unknown> | undefined;
  return hour && typeof hour === "object" ? hour as AirFuseHourEntry : null;
}

export function resolveArtifactPath(
  index: AirFuseIndex | undefined,
  layer: AirFuseLayerConfig,
  value: string,
  kind: ArtifactKind,
): string | null {
  const fileName = artifactFileName(layer, value, kind);
  if (!fileName) return null;
  const indexed = hourEntry(index, layer, value)?.[fileName];
  return indexed ?? `${artifactDirectory(layer, value)}/${fileName}`;
}

export function maxDateFromIndex(index: AirFuseIndex | undefined, layer: AirFuseLayerConfig): string | null {
  const tree = layerTree(index, layer);
  const raw = tree?.max_date;
  return typeof raw === "string" ? raw.slice(0, 16) : null;
}

export function dailyAvailability(index: AirFuseIndex | undefined, layer: AirFuseLayerConfig, value: string): number | null {
  const tree = layerTree(index, layer);
  if (!tree) return null;
  const { yyyy, mm, dd } = utcParts(value);
  const year = tree[yyyy] as Record<string, unknown> | undefined;
  const month = year?.[mm] as Record<string, unknown> | undefined;
  const day = month?.[dd] as Record<string, unknown> | undefined;
  if (!day || typeof day !== "object") return 0;

  return Object.values(day).filter((entry) => {
    if (!entry || typeof entry !== "object") return false;
    return Object.keys(entry).some((name) => name.endsWith(".geojson"));
  }).length;
}

export function monthAvailability(index: AirFuseIndex | undefined, layer: AirFuseLayerConfig, value: string) {
  const tree = layerTree(index, layer);
  const { yyyy, mm } = utcParts(value);
  const year = tree?.[yyyy] as Record<string, unknown> | undefined;
  const month = year?.[mm] as Record<string, unknown> | undefined;
  const daysInMonth = new Date(Number(yyyy), Number(mm), 0).getDate();

  return Array.from({ length: daysInMonth }, (_, index) => {
    const day = pad2(index + 1);
    const dayEntry = month?.[day] as Record<string, unknown> | undefined;
    const count = dayEntry && typeof dayEntry === "object"
      ? Object.values(dayEntry).filter((entry) => {
        if (!entry || typeof entry !== "object") return false;
        return Object.keys(entry).some((name) => name.endsWith(".geojson"));
      }).length
      : 0;
    return { day: index + 1, count };
  });
}
