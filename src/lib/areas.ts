/**
 * Coverage-by-area bucketing for the equity view.
 *
 * The map can mislead: an empty area reads as "safe" when it often just means
 * "under-reported". Bucketing reports into named Davis areas surfaces that gap
 * explicitly — see docs/audits/coverage-equity.md.
 *
 * Areas are approximate, ordered boxes; the first box that contains a (fuzzed,
 * public) point wins, with an "Elsewhere in Davis" fallback.
 */
import type { Hazard } from '../../shared/types.ts';

export interface Area {
  name: string;
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

export const DAVIS_AREAS: Area[] = [
  { name: 'UC Davis campus', minLat: 38.53, maxLat: 38.545, minLng: -121.77, maxLng: -121.745 },
  { name: 'North Davis', minLat: 38.56, maxLat: 38.6, minLng: -121.8, maxLng: -121.7 },
  { name: 'South Davis', minLat: 38.5, maxLat: 38.535, minLng: -121.8, maxLng: -121.7 },
  { name: 'West Davis', minLat: 38.535, maxLat: 38.56, minLng: -121.8, maxLng: -121.755 },
  { name: 'East Davis', minLat: 38.535, maxLat: 38.56, minLng: -121.73, maxLng: -121.7 },
  { name: 'Central Davis', minLat: 38.535, maxLat: 38.56, minLng: -121.755, maxLng: -121.73 },
];

const ELSEWHERE = 'Elsewhere in Davis';

export interface AreaCount {
  name: string;
  count: number;
}

function areaFor(h: Hazard): string {
  const a = DAVIS_AREAS.find(
    (area) =>
      h.location.lat >= area.minLat &&
      h.location.lat <= area.maxLat &&
      h.location.lng >= area.minLng &&
      h.location.lng <= area.maxLng,
  );
  return a?.name ?? ELSEWHERE;
}

/**
 * Count hazards per area. Every named area is always present (so zero-report
 * areas are visible — that's the point), with "Elsewhere in Davis" appended
 * only when something lands outside the named boxes.
 */
export function bucketByArea(hazards: Hazard[]): AreaCount[] {
  const counts = new Map<string, number>(DAVIS_AREAS.map((a) => [a.name, 0]));
  for (const h of hazards) {
    const key = areaFor(h);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const named = DAVIS_AREAS.map((a) => ({ name: a.name, count: counts.get(a.name) ?? 0 }));
  const elsewhere = counts.get(ELSEWHERE) ?? 0;
  return elsewhere > 0 ? [...named, { name: ELSEWHERE, count: elsewhere }] : named;
}
