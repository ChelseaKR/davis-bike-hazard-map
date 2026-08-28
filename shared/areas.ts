/**
 * Named Davis areas, and the bucketing of points into them.
 *
 * Lives in `shared/` because both sides need the SAME boxes: the client renders
 * the coverage view, and the server tallies reports per area for it
 * (`GET /api/coverage`). Two copies of these boxes would let the two halves
 * disagree about which area a report is in, which is exactly the kind of quiet
 * mismatch the coverage view exists to prevent.
 *
 * Areas are approximate, ordered boxes; the first box that contains a point
 * wins, with an "Elsewhere in Davis" fallback for anything inside the Davis
 * bounding box but outside every named box.
 */

export interface Area {
  name: string;
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
  /**
   * Relative estimated cycling *exposure* for the area (unitless weight, only
   * meaningful relative to the other areas' weights). This is a deliberately
   * COARSE heuristic — a rough stand-in for "how much riding happens here" so
   * the coverage view can flag where reports are scarce *relative to ridership*
   * rather than in absolute terms. It is NOT a measured ridership/population
   * figure; the literature (research roadmap EV-SKEW) warns that exposure
   * denominators are themselves uncertain and can introduce bias, so this is
   * surfaced qualitatively, always paired with the limits note in CoverageView,
   * and never presented as ground truth. See docs/audits/coverage-equity.md.
   */
  exposureWeight: number;
}

export const DAVIS_AREAS: Area[] = [
  { name: 'UC Davis campus', minLat: 38.53, maxLat: 38.545, minLng: -121.77, maxLng: -121.745, exposureWeight: 5 },
  { name: 'North Davis', minLat: 38.56, maxLat: 38.6, minLng: -121.8, maxLng: -121.7, exposureWeight: 3 },
  { name: 'South Davis', minLat: 38.5, maxLat: 38.535, minLng: -121.8, maxLng: -121.7, exposureWeight: 2 },
  { name: 'West Davis', minLat: 38.535, maxLat: 38.56, minLng: -121.8, maxLng: -121.755, exposureWeight: 3 },
  { name: 'East Davis', minLat: 38.535, maxLat: 38.56, minLng: -121.73, maxLng: -121.7, exposureWeight: 3 },
  { name: 'Central Davis', minLat: 38.535, maxLat: 38.56, minLng: -121.755, maxLng: -121.73, exposureWeight: 4 },
];

export const ELSEWHERE_AREA = 'Elsewhere in Davis';

/** One area's report tally. */
export interface AreaCount {
  name: string;
  count: number;
}

/** The named area containing a point, or the "Elsewhere in Davis" fallback. */
export function areaNameFor(point: { lat: number; lng: number }): string {
  const a = DAVIS_AREAS.find(
    (area) =>
      point.lat >= area.minLat &&
      point.lat <= area.maxLat &&
      point.lng >= area.minLng &&
      point.lng <= area.maxLng,
  );
  return a?.name ?? ELSEWHERE_AREA;
}

/**
 * Tally points per area. Every named area is always present (so zero-report
 * areas are visible — that's the point), with "Elsewhere in Davis" appended
 * only when something lands outside the named boxes.
 */
export function tallyByArea(points: { lat: number; lng: number }[]): AreaCount[] {
  const counts = new Map<string, number>(DAVIS_AREAS.map((a) => [a.name, 0]));
  for (const p of points) {
    const key = areaNameFor(p);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const named = DAVIS_AREAS.map((a) => ({ name: a.name, count: counts.get(a.name) ?? 0 }));
  const elsewhere = counts.get(ELSEWHERE_AREA) ?? 0;
  return elsewhere > 0 ? [...named, { name: ELSEWHERE_AREA, count: elsewhere }] : named;
}
