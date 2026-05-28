/**
 * OpenAQ metadata catalog — lookup tables for countries, instruments,
 * licenses, manufacturers, parameters, and providers. Mirrors the schema
 * AirMonitor's `local_openaq/` scripts produce. Caller passes the raw
 * OpenAQ v3 JSON (or an equivalent fixture); this module typesafe-parses
 * and exposes per-attribute lookups.
 */

export type OpenAqCountry = {
  id: number;
  code: string;
  name: string;
};

export type OpenAqInstrument = {
  id: number;
  name: string;
  manufacturerId?: number;
  manufacturerName?: string;
};

export type OpenAqManufacturer = {
  id: number;
  name: string;
};

export type OpenAqLicense = {
  id: number;
  name: string;
  attributionRequired?: boolean;
  shareAlike?: boolean;
};

export type OpenAqParameter = {
  id: number;
  name: string;
  units: string;
  displayName?: string;
};

export type OpenAqProvider = {
  id: number;
  name: string;
  sourceType?: string;
};

export type OpenAqCatalog = {
  countries: OpenAqCountry[];
  instruments: OpenAqInstrument[];
  manufacturers: OpenAqManufacturer[];
  licenses: OpenAqLicense[];
  parameters: OpenAqParameter[];
  providers: OpenAqProvider[];
};

export function emptyOpenAqCatalog(): OpenAqCatalog {
  return { countries: [], instruments: [], manufacturers: [], licenses: [], parameters: [], providers: [] };
}

/** Read an OpenAQ v3 `/countries` payload. */
export function ingestOpenAqCountries(payload: unknown): OpenAqCountry[] {
  const results = readResults(payload);
  return results
    .map((r) => ({
      id: numOrNaN(r.id),
      code: String(r.code ?? r.iso ?? ""),
      name: String(r.name ?? ""),
    }))
    .filter((c) => Number.isFinite(c.id) && c.code);
}

/** Read an OpenAQ v3 `/instruments` payload. */
export function ingestOpenAqInstruments(payload: unknown): OpenAqInstrument[] {
  const results = readResults(payload);
  return results
    .map((r) => ({
      id: numOrNaN(r.id),
      name: String(r.name ?? ""),
      manufacturerId: r.manufacturer ? numOrNaN((r.manufacturer as Record<string, unknown>).id) : undefined,
      manufacturerName: r.manufacturer ? String((r.manufacturer as Record<string, unknown>).name ?? "") : undefined,
    }))
    .filter((i) => Number.isFinite(i.id));
}

/** Read an OpenAQ v3 `/manufacturers` payload. */
export function ingestOpenAqManufacturers(payload: unknown): OpenAqManufacturer[] {
  const results = readResults(payload);
  return results
    .map((r) => ({ id: numOrNaN(r.id), name: String(r.name ?? "") }))
    .filter((m) => Number.isFinite(m.id));
}

/** Read an OpenAQ v3 `/licenses` payload. */
export function ingestOpenAqLicenses(payload: unknown): OpenAqLicense[] {
  const results = readResults(payload);
  return results
    .map((r) => ({
      id: numOrNaN(r.id),
      name: String(r.name ?? ""),
      attributionRequired: Boolean(r.attributionRequired),
      shareAlike: Boolean(r.shareAlike),
    }))
    .filter((l) => Number.isFinite(l.id));
}

/** Read an OpenAQ v3 `/parameters` payload. */
export function ingestOpenAqParameters(payload: unknown): OpenAqParameter[] {
  const results = readResults(payload);
  return results
    .map((r) => ({
      id: numOrNaN(r.id),
      name: String(r.name ?? ""),
      units: String(r.units ?? ""),
      displayName: r.displayName ? String(r.displayName) : undefined,
    }))
    .filter((p) => Number.isFinite(p.id));
}

/** Read an OpenAQ v3 `/providers` payload. */
export function ingestOpenAqProviders(payload: unknown): OpenAqProvider[] {
  const results = readResults(payload);
  return results
    .map((r) => ({
      id: numOrNaN(r.id),
      name: String(r.name ?? ""),
      sourceType: r.sourceType ? String(r.sourceType) : undefined,
    }))
    .filter((p) => Number.isFinite(p.id));
}

export function lookupCatalog<T extends { id: number }>(table: ReadonlyArray<T>) {
  const byId = new Map<number, T>();
  for (const row of table) byId.set(row.id, row);
  return { byId, list: () => [...table] };
}

function readResults(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload as Array<Record<string, unknown>>;
  if (payload && typeof payload === "object" && "results" in payload) {
    const r = (payload as { results?: unknown }).results;
    if (Array.isArray(r)) return r as Array<Record<string, unknown>>;
  }
  return [];
}

function numOrNaN(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}
