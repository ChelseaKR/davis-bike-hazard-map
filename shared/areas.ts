/**
 * Named areas of the served town, and the bucketing of points into them.
 *
 * Lives in `shared/` because both sides need the SAME boxes: the client renders
 * the coverage view, and the server tallies reports per area for it
 * (`GET /api/coverage`). Two copies of these boxes would let the two halves
 * disagree about which area a report is in, which is exactly the kind of quiet
 * mismatch the coverage view exists to prevent.
 *
 * The boxes themselves now live in the place pack (`place/davis.json`, loaded and
 * validated by `shared/place.ts`), not in this file. What stays here is the
 * bucketing rule, and it is unchanged:
 *
 * **Areas are approximate, ORDERED boxes; the first box that contains a point
 * wins**, with an "elsewhere" fallback for anything inside the pack's bounding box
 * but outside every named box. The Davis boxes genuinely overlap — `UC Davis
 * campus` overlaps `South Davis`, `West Davis` and `Central Davis` — and order is
 * what resolves the overlap. `place.ts` deliberately does not reject overlapping
 * areas for that reason, and `tests/unit/place.test.ts` pins the ordering so a
 * later "fix" cannot quietly reassign real reports.
 *
 * Every function here takes the pack as an optional last argument, defaulting to
 * the served pack. That is not decoration: it is how the tests drive a synthetic
 * second town through this exact code, which is the only way "the map is
 * parameterised over its town" can be a checked fact rather than a claim.
 */
import { PLACE, type PlaceArea, type PlacePack } from './place.ts';

/**
 * One named area.
 *
 * `exposureWeight` is a relative estimated cycling exposure (unitless, only
 * meaningful against the other areas' weights) — a deliberately COARSE stand-in
 * for "how much riding happens here", so the coverage view can flag where reports
 * are scarce *relative to ridership* rather than in absolute terms. It is NOT a
 * measured ridership or population figure; the literature (research roadmap
 * EV-SKEW) warns that exposure denominators are themselves uncertain and can
 * introduce bias, so it is surfaced qualitatively, always paired with the limits
 * note in CoverageView, and never presented as ground truth. See
 * `docs/audits/coverage-equity.md`.
 *
 * It is required and must be positive in the pack schema. A missing weight
 * silently defaulted to 1 would put a number nobody chose into that denominator.
 */
export type Area = PlaceArea;

/** The named areas of the served town, in bucketing order. */
export const PLACE_AREAS: readonly Area[] = PLACE.areas;

/** The fallback bucket for points inside the bounds but outside every named box. */
export const ELSEWHERE_AREA: string = PLACE.elsewhereAreaName;

/** One area's report tally. */
export interface AreaCount {
  name: string;
  count: number;
}

/** The named area containing a point, or the pack's "elsewhere" fallback. */
export function areaNameFor(
  point: { lat: number; lng: number },
  pack: PlacePack = PLACE,
): string {
  const a = pack.areas.find(
    (area) =>
      point.lat >= area.minLat &&
      point.lat <= area.maxLat &&
      point.lng >= area.minLng &&
      point.lng <= area.maxLng,
  );
  return a?.name ?? pack.elsewhereAreaName;
}

/**
 * Tally points per area. Every named area is always present (so zero-report
 * areas are visible — that's the point), with the "elsewhere" bucket appended
 * only when something lands outside the named boxes.
 */
export function tallyByArea(
  points: { lat: number; lng: number }[],
  pack: PlacePack = PLACE,
): AreaCount[] {
  const counts = new Map<string, number>(pack.areas.map((a) => [a.name, 0]));
  for (const p of points) {
    const key = areaNameFor(p, pack);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const named = pack.areas.map((a) => ({ name: a.name, count: counts.get(a.name) ?? 0 }));
  const elsewhere = counts.get(pack.elsewhereAreaName) ?? 0;
  return elsewhere > 0 ? [...named, { name: pack.elsewhereAreaName, count: elsewhere }] : named;
}
