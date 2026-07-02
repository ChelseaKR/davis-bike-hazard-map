/**
 * Geospatial helpers shared by client and server.
 *
 * The fuzzing function is a privacy control: the public feed must not expose a
 * reporter's precise location (which, for home-adjacent reports, can be a home
 * address). The server snaps every public coordinate to a fixed grid before it
 * is ever returned — see server/lib/repository.
 */
import type { GeoPoint } from './types.ts';
import { DAVIS_BOUNDS } from './validation.ts';

const EARTH_RADIUS_M = 6_371_000;
const METERS_PER_DEG_LAT = 111_320;

/** Great-circle distance between two points, in metres. */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Default privacy grid: ~70 m cells. Coarse enough to hide a single home. */
export const DEFAULT_FUZZ_METERS = 70;

/**
 * Snap a coordinate onto a fixed grid of `gridMeters` spacing.
 *
 * Published points land on grid *lines offset half a step from the rounding
 * grid* (see `snap`): each axis moves by at most one full step, so the
 * worst-case displacement is ~sqrt(2) x `gridMeters` on the diagonal (~99 m at
 * the default 70 m grid, plus <0.2 m of 6-decimal rounding slack). This is
 * deliberately the *edge* variant, not the cell centre a naive reading might
 * expect: switching to centres (`Math.floor(v/step) + 0.5`) would silently
 * shift every already-published point by one cell, so we keep the historical
 * grid and document the true bound instead. The bound is enforced by property
 * tests in `tests/unit/geo.test.ts`.
 *
 * Snapping (rather than random jitter) is deliberate: it is deterministic, so
 * repeated reports from the same spot map to the same published point and
 * cannot be averaged back to the true location, and it bounds the exposed
 * precision to the grid size regardless of how many reports exist. Note the
 * longitude step depends on the point's latitude, so exact-coordinate repeats
 * (and same-latitude neighbours within a cell) collapse to identical output.
 */
export function fuzzCoordinate(point: GeoPoint, gridMeters: number = DEFAULT_FUZZ_METERS): GeoPoint {
  const latStep = gridMeters / METERS_PER_DEG_LAT;
  const metersPerDegLng = METERS_PER_DEG_LAT * Math.cos(toRad(point.lat));
  // Near the poles cos -> 0; guard so we never divide by ~0 (irrelevant for
  // Davis, but keeps the function total).
  const lngStep = gridMeters / Math.max(1, metersPerDegLng);

  const lat = snap(point.lat, latStep);
  const lng = snap(point.lng, lngStep);
  return { lat: round6(lat), lng: round6(lng) };
}

/**
 * Snap onto grid lines offset half a `step` from the rounding grid.
 *
 * `Math.round(v/step)` moves at most half a step; the `+ 0.5` offset adds
 * another half, so the result is within **one full step** of the input (the
 * worst case, exactly one step, occurs at `v/step = n - 0.5`). Kept as-is —
 * see the `fuzzCoordinate` doc for why we do not "fix" this to cell centres.
 */
function snap(value: number, step: number): number {
  return (Math.round(value / step) + 0.5) * step;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** True if the point falls within the Davis bounding box. */
export function isWithinDavis(point: GeoPoint): boolean {
  return (
    point.lat >= DAVIS_BOUNDS.minLat &&
    point.lat <= DAVIS_BOUNDS.maxLat &&
    point.lng >= DAVIS_BOUNDS.minLng &&
    point.lng <= DAVIS_BOUNDS.maxLng
  );
}
