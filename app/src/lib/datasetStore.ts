import type { NetworkTimeSeries, PasCollection, PatSeries, PurpleAirImportSummary } from "@patool/shared";

// A dataset the user uploaded, held in memory and persisted to IndexedDB so it
// survives reloads. When one is active, staticApi.ts serves the whole app from
// it instead of the committed demo fixtures.
export type ActiveDataset = {
  name: string;
  importedAt: string;
  summary: PurpleAirImportSummary;
  warnings: string[];
  collection: PasCollection;
  seriesById: Record<string, PatSeries>;
  network: NetworkTimeSeries;
};

const DB_NAME = "patool";
const STORE = "datasets";
const KEY = "active";

let active: ActiveDataset | null = null;
let hydrated = false;
let hydration: Promise<void> | null = null;
const listeners = new Set<() => void>();

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbRead(): Promise<ActiveDataset | null> {
  if (!hasIndexedDb()) return null;
  const db = await openDb();
  try {
    return await new Promise<ActiveDataset | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as ActiveDataset | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function idbWrite(value: ActiveDataset | null): Promise<void> {
  if (!hasIndexedDb()) return;
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      if (value === null) store.delete(KEY);
      else store.put(value, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Load any persisted dataset into memory exactly once. Safe to await repeatedly. */
export function ensureDatasetHydrated(): Promise<void> {
  if (hydrated) return Promise.resolve();
  if (!hydration) {
    hydration = idbRead()
      .then((value) => {
        active = value;
      })
      .catch(() => {
        active = null;
      })
      .finally(() => {
        hydrated = true;
        emit();
      });
  }
  return hydration;
}

export function getActiveDataset(): ActiveDataset | null {
  return active;
}

export async function setActiveDataset(dataset: ActiveDataset): Promise<void> {
  active = dataset;
  hydrated = true;
  await idbWrite(dataset).catch(() => {
    /* keep the in-memory dataset even if persistence fails (e.g. private mode) */
  });
  emit();
}

export async function clearActiveDataset(): Promise<void> {
  active = null;
  hydrated = true;
  await idbWrite(null).catch(() => {});
  emit();
}

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeDataset(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
