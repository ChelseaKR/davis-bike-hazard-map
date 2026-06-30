/**
 * A small set of well-known Davis landmarks used as start/end presets in the
 * route planner.
 *
 * Presets keep the planner fully usable WITHOUT the map (accessibility: a
 * keyboard/screen-reader user can pick endpoints from a labelled <select>) and
 * WITHOUT a network (they ship in the bundle), while "Use my location" and
 * tapping the map remain available as enhancements.
 */
import type { GeoPoint } from '../../shared/types.ts';

export interface Landmark {
  name: string;
  point: GeoPoint;
}

export const DAVIS_LANDMARKS: Landmark[] = [
  { name: 'UC Davis Memorial Union', point: { lat: 38.5421, lng: -121.7494 } },
  { name: 'Downtown Davis (E St Plaza)', point: { lat: 38.5447, lng: -121.7405 } },
  { name: 'Davis Amtrak Station', point: { lat: 38.5419, lng: -121.7376 } },
  { name: 'Davis Food Co-op', point: { lat: 38.5462, lng: -121.7385 } },
  { name: 'North Davis (Covell & F)', point: { lat: 38.5611, lng: -121.7385 } },
  { name: 'South Davis (Montgomery Elementary)', point: { lat: 38.5318, lng: -121.7546 } },
  { name: 'West Davis (Lake Blvd & Arlington)', point: { lat: 38.5556, lng: -121.7745 } },
  { name: 'East Davis (Mace & 2nd)', point: { lat: 38.5435, lng: -121.7126 } },
  { name: 'Davis Community Park', point: { lat: 38.5519, lng: -121.7503 } },
  { name: 'Sutter Davis Hospital', point: { lat: 38.5571, lng: -121.7745 } },
];

/** Look up a landmark's point by name (exact match), or undefined. */
export function landmarkByName(name: string): GeoPoint | undefined {
  return DAVIS_LANDMARKS.find((l) => l.name === name)?.point;
}
