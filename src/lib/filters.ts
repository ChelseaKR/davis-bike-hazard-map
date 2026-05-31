/**
 * Pure hazard-filtering logic, shared by the map and list views so both always
 * show exactly the same set (accessibility: the list is the map's equal).
 */
import type { Hazard, HazardFilters } from '../../shared/types.ts';
import { SEVERITY_RANK } from '../../shared/types.ts';

/** A hazard is "live" on the public map if approved/confirmed and unexpired. */
export function isLive(hazard: Hazard, now: number): boolean {
  const visible = hazard.status === 'approved';
  return visible && hazard.expiresAt > now;
}

/** Apply category / severity / recency filters to a hazard list. */
export function applyFilters(
  hazards: Hazard[],
  filters: HazardFilters,
  now: number = Date.now(),
): Hazard[] {
  const minRank = filters.minSeverity ? SEVERITY_RANK[filters.minSeverity] : -1;
  const cutoff = filters.withinDays
    ? now - filters.withinDays * 24 * 60 * 60 * 1000
    : -Infinity;
  const cats = filters.categories?.length ? new Set(filters.categories) : null;

  return hazards.filter((h) => {
    if (cats && !cats.has(h.category)) return false;
    if (SEVERITY_RANK[h.severity] < minRank) return false;
    if (h.updatedAt < cutoff) return false;
    return true;
  });
}

/** Sort by severity (worst first), then most-recently-updated. */
export function sortByPriority(hazards: Hazard[]): Hazard[] {
  return [...hazards].sort((a, b) => {
    const sev = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    return sev !== 0 ? sev : b.updatedAt - a.updatedAt;
  });
}
