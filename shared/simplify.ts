/**
 * Polyline simplification (Douglas–Peucker) — a privacy control.
 *
 * A saved route watch is a home↔work corridor: arguably the most sensitive
 * location data this system holds. Matching is corridor-based
 * (`shared/alerts.ts` uses distance-to-polyline), so precision beyond the
 * corridor width is pure liability. Before a route watch is stored, its
 * geometry is simplified to a tolerance matched to the location-fuzz scale
 * (~35 m — half the ~70 m public fuzz grid, `shared/geo.ts`), which keeps
 * corridor matching effectively unchanged while shedding the exact-GPS-trace
 * precision we never need.
 *
 * Distances use the same local planar approximation as
 * `distanceToRouteMeters` (`shared/routing.ts`): lat/lng scaled by
 * metres-per-degree at the segment's latitude — exact enough at city scale.
 */
import type { GeoPoint } from './types.ts';
import { pointToSegmentMeters } from './routing.ts';

/**
 * Simplify a polyline with Douglas–Peucker: keep only the points that deviate
 * more than `toleranceMeters` from the line through their neighbours.
 *
 * Guarantees: the first and last points are always kept, and every dropped
 * point lies within `toleranceMeters` of the simplified polyline. Iterative
 * (explicit stack) so a pathological 2,000-point input can't blow the call
 * stack. Never mutates the input.
 */
export function simplifyRoute(points: GeoPoint[], toleranceMeters: number): GeoPoint[] {
  if (points.length <= 2) return [...points];
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let maxDistance = 0;
    let farthest = -1;
    for (let i = first + 1; i < last; i++) {
      const d = pointToSegmentMeters(points[i], points[first], points[last]);
      if (d > maxDistance) {
        maxDistance = d;
        farthest = i;
      }
    }
    if (farthest !== -1 && maxDistance > toleranceMeters) {
      keep[farthest] = true;
      stack.push([first, farthest], [farthest, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}
