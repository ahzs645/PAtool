import { apiPath } from "../../lib/api";
import { AIRFUSE_BUCKET_BASE_URL } from "./config";

export function airFuseProxyUrl(path: string): string {
  const explicitBase = import.meta.env.VITE_AIRFUSE_API_BASE?.replace(/\/$/, "");
  const route = `/api/airfuse/proxy?path=${encodeURIComponent(path)}`;
  return explicitBase ? `${explicitBase}${route}` : apiPath(route);
}

export function airFuseRawUrl(path: string): string {
  return `${AIRFUSE_BUCKET_BASE_URL}/${path}`;
}

export async function fetchAirFuseJson<T>(path: string): Promise<T> {
  const response = await fetch(airFuseProxyUrl(path));
  if (!response.ok) {
    throw new Error(`AirFuse request failed for ${path}`);
  }
  return response.json() as Promise<T>;
}

export async function fetchAirFuseText(path: string): Promise<string> {
  const response = await fetch(airFuseProxyUrl(path));
  if (!response.ok) {
    throw new Error(`AirFuse request failed for ${path}`);
  }
  return response.text();
}
