/**
 * A small set of well-known landmarks used as start/end presets in the route
 * planner.
 *
 * Presets keep the planner fully usable WITHOUT the map (accessibility: a
 * keyboard/screen-reader user can pick endpoints from a labelled <select>) and
 * WITHOUT a network (they ship in the bundle), while "Use my location" and
 * tapping the map remain available as enhancements.
 *
 * The list itself lives in the place pack (`place/davis.json`), which is where a
 * second town supplies its own. The pack loader refuses any landmark outside the
 * pack's bounds, because such a preset would offer the rider a start point the
 * report validator would then refuse.
 */
import { PLACE, type PlaceLandmark, type PlacePack } from '../../shared/place.ts';
import type { GeoPoint } from '../../shared/types.ts';

export type Landmark = PlaceLandmark;

export const PLACE_LANDMARKS: readonly Landmark[] = PLACE.landmarks;

/** Look up a landmark's point by name (exact match), or undefined. */
export function landmarkByName(name: string, pack: PlacePack = PLACE): GeoPoint | undefined {
  return pack.landmarks.find((l) => l.name === name)?.point;
}
