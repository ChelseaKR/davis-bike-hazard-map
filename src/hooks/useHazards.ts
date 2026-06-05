import { useCallback, useEffect, useState } from 'react';
import type { Hazard, HazardFilters } from '../../shared/types.ts';
import { fetchHazards } from '../lib/api.ts';
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

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAll(await fetchHazards());
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
