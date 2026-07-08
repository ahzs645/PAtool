import { useEffect, useSyncExternalStore } from "react";

import { ensureDatasetHydrated, getActiveDataset, subscribeDataset } from "../lib/datasetStore";

/**
 * Subscribe to the active uploaded dataset (or null when running on the demo
 * fixtures). Triggers hydration from IndexedDB on first use.
 */
export function useActiveDataset() {
  useEffect(() => {
    void ensureDatasetHydrated();
  }, []);
  return useSyncExternalStore(subscribeDataset, getActiveDataset, getActiveDataset);
}
