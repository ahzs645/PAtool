import { getStaticJson, postStaticJson } from "./staticApi";

const dataSource = import.meta.env.VITE_DATA_SOURCE ?? (import.meta.env.PROD ? "static" : "api");
const resolvedDataSource = import.meta.env.MODE === "test" ? "api" : dataSource;

export function apiPath(path: string): string {
  const base = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "";
  return `${base}${path}`;
}

export async function getJson<T>(path: string): Promise<T> {
  if (resolvedDataSource === "static") {
    return getStaticJson<T>(path);
  }
  const response = await fetch(apiPath(path));
  if (!response.ok) throw new Error(`Request failed for ${path}`);
  return response.json() as Promise<T>;
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  if (resolvedDataSource === "static") {
    return postStaticJson<T>(path, body);
  }
  const response = await fetch(apiPath(path), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`Request failed for ${path}`);
  return response.json() as Promise<T>;
}
