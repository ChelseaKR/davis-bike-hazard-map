/**
 * Duplicate detection for the report flow (research roadmap R1).
 *
 * Ten reports of one pothole should become one confirmed item, not ten rows.
 * Before a cyclist files, we surface any *active* hazard of the same kind close
 * to where they are, so they can confirm it ("me too / still here") instead of
 * filing a duplicate — which feeds the lifecycle/routing weight that already
 * exists, and keeps the map legible. This is a nudge, never an auto-merge: the
 * reporter still decides.
 *
 * Pure and total so it is unit-testable and runs on the client with no network.
 */
import { haversineMeters } from '../../shared/geo.ts';
import type { GeoPoint, Hazard, HazardCategory } from '../../shared/types.ts';

export interface NearbyDuplicate {
  hazard: Hazard;
  distanceMeters: number;
}

/**
 * Radius within which a same-category report is treated as a likely duplicate.
 * A touch wider than the ~70 m privacy fuzz grid so a hazard published a cell
 * away from the true spot still surfaces, without pulling in the whole block.
 */
export const DEFAULT_DUPLICATE_RADIUS_M = 120;

/** Cap how many candidates we show, so the nudge stays scannable. */
export const DEFAULT_MAX_DUPLICATES = 3;

/**
 * Find active hazards of the same category near a point, nearest first.
 *
 * Only `approved` (live) hazards are candidates — you can't "confirm" a resolved
 * or expired one (the confirm endpoint rejects it), and a fixed hazard isn't a
 * duplicate of a fresh report.
 */
export function findNearbyDuplicates(
  hazards: Hazard[],
  location: GeoPoint,
  category: HazardCategory,
  opts: { radiusMeters?: number; max?: number } = {},
): NearbyDuplicate[] {
  const radius = opts.radiusMeters ?? DEFAULT_DUPLICATE_RADIUS_M;
  const max = opts.max ?? DEFAULT_MAX_DUPLICATES;
  return hazards
    .filter((h) => h.status === 'approved' && h.category === category)
    .map((h) => ({ hazard: h, distanceMeters: haversineMeters(location, h.location) }))
    .filter((c) => c.distanceMeters <= radius)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, max);
}
