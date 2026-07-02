import { useCallback, useEffect, useRef, useState } from 'react';
import type { Hazard, HazardFilters } from '../../shared/types.ts';
import { fetchHazards } from '../lib/api.ts';
import { applyFilters, sortByPriority } from '../lib/filters.ts';

/**
 * Merge a delta poll's changed rows into the current set: upsert by id, then
 * drop any ids the server tombstoned. Returns the same array reference when
 * nothing changed so React can skip a re-render.
 */
function mergeDelta(current: Hazard[], changed: Hazard[], deletedIds: string[]): Hazard[] {
  if (changed.length === 0 && deletedIds.length === 0) return current;
  const byId = new Map(current.map((h) => [h.id, h]));
  for (const h of changed) byId.set(h.id, h);
  for (const id of deletedIds) byId.delete(id);
  return [...byId.values()];
}

interface UseHazardsResult {
  hazards: Hazard[];
  all: Hazard[];
  loading: boolean;
  error: string | null;
  /** Epoch ms of the last successful fetch, or null before the first one. */
  lastUpdatedAt: number | null;
  refresh: () => Promise<void>;
}

/**
 * Load the public hazard feed and apply filters client-side.
 *
 * Filtering locally (rather than refetching per filter change) keeps the map
 * snappy on mobile data and lets the list and map share one dataset.
 */
export function useHazards(filters: HazardFilters): UseHazardsResult {
  const [all, setAll] = useState<Hazard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  // Delta-poll cursor: the serverTime of our last successful fetch. Null until
  // the first full load, which forces that first fetch to be a full one.
  const sinceRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cursor = sinceRef.current;
      const feed = await fetchHazards(cursor != null ? { updatedSince: cursor } : undefined);
      if (cursor != null && feed.deletedIds !== undefined) {
        // Delta response: patch the existing set in place.
        setAll((prev) => mergeDelta(prev, feed.hazards, feed.deletedIds ?? []));
      } else {
        // Full feed (first load, or the server ignored a stale cursor).
        setAll(feed.hazards);
      }
      // Advance the cursor to the server's clock. If the response lacks a
      // serverTime, clear it so the next poll falls back to a full fetch.
      sinceRef.current = feed.serverTime ?? null;
      setLastUpdatedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load hazards.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const hazards = sortByPriority(applyFilters(all, filters));
  return { hazards, all, loading, error, lastUpdatedAt, refresh };
}
