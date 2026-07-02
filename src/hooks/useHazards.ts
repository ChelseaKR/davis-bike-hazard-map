import { useCallback, useEffect, useRef, useState } from 'react';
import type { Hazard, HazardFilters } from '../../shared/types.ts';
import { fetchHazardFeed } from '../lib/api.ts';
import { applyFilters, sortByPriority } from '../lib/filters.ts';

interface UseHazardsResult {
  hazards: Hazard[];
  all: Hazard[];
  loading: boolean;
  error: string | null;
  /** Epoch ms of the last successful fetch, or null before the first one. */
  lastUpdatedAt: number | null;
  refresh: () => Promise<void>;
}

/** Merge a delta response into the current set: upsert by id, drop tombstones. */
export function mergeDelta(
  prev: Hazard[],
  changed: Hazard[],
  deletedIds: string[],
): Hazard[] {
  const byId = new Map(prev.map((h) => [h.id, h] as const));
  for (const h of changed) byId.set(h.id, h);
  for (const id of deletedIds) byId.delete(id);
  return [...byId.values()];
}

/**
 * Load the public hazard feed and apply filters client-side.
 *
 * Filtering locally (rather than refetching per filter change) keeps the map
 * snappy on mobile data and lets the list and map share one dataset.
 *
 * Refreshes after the first are delta polls: we send the server's own clock
 * back as an `updatedSince` cursor (immune to client clock skew) and merge the
 * few changed rows + id-only tombstones into `all`, so the recurring poll
 * costs bytes proportional to change, not feed size. Any response without the
 * delta fields (older server, or the server refusing a stale cursor) falls
 * back to a full replace.
 */
export function useHazards(filters: HazardFilters): UseHazardsResult {
  const [all, setAll] = useState<Hazard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  // Delta cursor: the `serverTime` of the last successful response, or null
  // before the first load (=> full fetch). A ref, not state — advancing it
  // must never re-render or re-create `refresh`.
  const sinceRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const since = sinceRef.current;
      const feed = await fetchHazardFeed(since != null ? { updatedSince: since } : undefined);
      if (since != null && feed.deletedIds && feed.serverTime != null) {
        const { hazards, deletedIds } = feed;
        setAll((prev) => mergeDelta(prev, hazards, deletedIds ?? []));
      } else {
        // Full feed (first load, stale cursor, or a server without deltas).
        setAll(feed.hazards);
      }
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
