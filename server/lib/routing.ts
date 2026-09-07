/**
 * OSRM-compatible routing adapter (the road-graph source for the planner).
 *
 * We don't ship our own road graph: instead we proxy an OSRM HTTP backend
 * (`config.routingUrl`, default the public OSRM demo server) server-side, so the
 * browser only talks to our own origin (CSP stays `'self'`) and the result is
 * cacheable by the service worker. Like the 311 hand-off, this DEGRADES
 * GRACEFULLY: with no backend reachable it returns a single straight-line
 * "fallback" route so the UI (and tests) still work without a live router.
 *
 * The hazard-avoidance maths lives in shared/routing.ts; this file is only
 * "fetch candidate routes and normalise them".
 */
import type { GeoPoint } from '../../shared/types.ts';
import type { Route, RouteStep } from '../../shared/routing.ts';
import { haversineMeters } from '../../shared/geo.ts';

export interface RoutingConfig {
  /** OSRM base URL incl. profile, e.g. https://router.project-osrm.org/route/v1/cycling */
  routingUrl: string;
}

export interface RouteFetchResult {
  routes: Route[];
  source: 'osrm' | 'fallback';
}

/** Typical Davis cycling speed (~15 km/h) for the straight-line fallback ETA. */
const FALLBACK_SPEED_MPS = 4.2;

/**
 * Minimal shape of the bits of an OSRM response we read.
 *
 * Every number here is `unknown`, and that is deliberate. This body arrives from
 * `config.routingUrl` -- a URL an operator sets, defaulting to a public demo
 * server -- and reaches us as `(await res.json())`, a cast that TypeScript erases.
 * Declaring `distance: number` did not make it a number; it only stopped the
 * compiler from asking. `unknown` makes checking it the only way to use it, which
 * is what `metric()` and `point()` below are for.
 */
interface OsrmResponse {
  code?: string;
  routes?: OsrmRoute[];
}
interface OsrmRoute {
  distance?: unknown;
  duration?: unknown;
  geometry?: { coordinates?: unknown };
  legs?: { steps?: OsrmStep[] }[];
}
interface OsrmStep {
  distance?: unknown;
  name?: string;
  maneuver?: { location?: unknown; type?: string; modifier?: string };
}

/**
 * A distance or a duration, or `null` if the body did not supply one.
 *
 * `typeof value === 'number'` rejects the string `"1200"`, which would otherwise
 * flow into `cost: route.distanceMeters + penalty` in `shared/routing.ts` as
 * string CONCATENATION and rank the candidate routes by text. `Number.isFinite`
 * rejects `NaN` and both infinities: `NaN` compares false against everything, so
 * a NaN cost makes "the safest route" whichever candidate happened to come first.
 * Negative is refused too -- a negative leg length is not a short one.
 */
function metric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * One `[lng, lat]` pair from the body, or `null`.
 *
 * Coordinates are checked for the same reason the distances are, and for a worse
 * consequence: `rankRoutes` measures every hazard against this geometry, and a
 * pair of strings or NaNs makes every distance NaN, every hazard fall outside the
 * corridor, and the plan report **no hazards near this route**. A false "clear
 * route" is the one answer this product must never give.
 */
function point(value: unknown): GeoPoint | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const [lng, lat] = value as unknown[];
  if (typeof lat !== 'number' || !Number.isFinite(lat)) return null;
  if (typeof lng !== 'number' || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/** Build a plain-language instruction from an OSRM maneuver. */
export function describeStep(step: OsrmStep): string {
  const type = step.maneuver?.type ?? 'continue';
  const modifier = step.maneuver?.modifier;
  const onto = step.name ? ` onto ${step.name}` : '';
  switch (type) {
    case 'depart':
      return step.name ? `Head out on ${step.name}` : 'Start riding';
    case 'arrive':
      return 'Arrive at your destination';
    case 'turn':
    case 'end of road':
    case 'fork':
    case 'ramp':
      return `${modifier ? `Turn ${modifier}` : 'Continue'}${onto}`;
    case 'roundabout':
    case 'rotary':
      return `Take the roundabout${onto}`;
    case 'merge':
      return `Merge${modifier ? ` ${modifier}` : ''}${onto}`;
    case 'new name':
    case 'continue':
    default:
      return `Continue${modifier && modifier !== 'straight' ? ` ${modifier}` : ''}${onto}`;
  }
}

/**
 * One OSRM route as a `Route`, or `null` if the body cannot support one.
 *
 * `null` is not an error path, it is the honest one: `fetchRoutes` already
 * promises a straight-line fallback "on any failure (no backend, network error,
 * MALFORMED BODY, no routes)", and until now a body that carried a geometry and
 * nothing else satisfied none of that and was returned as `source: 'osrm'` -- a
 * router's answer, with `distanceMeters` simply absent and every step's distance
 * defaulted to `0`.
 *
 * Refusing the whole route rather than the offending field is the point. A route
 * missing one step's distance is a route we cannot describe, and presenting it as
 * complete is the failure this repository keeps finding in its own output. The
 * fallback that replaces it is a straight line, is labelled `source: 'fallback'`
 * in the plan, and says so to the rider.
 */
function osrmToRoute(r: OsrmRoute): Route | null {
  const distanceMeters = metric(r.distance);
  const durationSeconds = metric(r.duration);
  if (distanceMeters === null || durationSeconds === null) return null;

  const coords = r.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const geometry: GeoPoint[] = [];
  for (const raw of coords) {
    const p = point(raw);
    if (p === null) return null;
    geometry.push(p);
  }

  const steps: RouteStep[] = [];
  for (const leg of r.legs ?? []) {
    for (const s of leg.steps ?? []) {
      const stepDistance = metric(s.distance);
      if (stepDistance === null) return null;
      // A maneuver with no location falls back to the route's start, which the
      // length check above guarantees exists. There is no `{ lat: 0, lng: 0 }`
      // here any more: null island is 9,000 km from the served place, and a
      // coordinate nobody supplied must not be invented at all.
      const located = point(s.maneuver?.location) ?? geometry[0];
      steps.push({
        instruction: describeStep(s),
        distanceMeters: stepDistance,
        location: located,
      });
    }
  }

  return { geometry, distanceMeters, durationSeconds, steps };
}

/** A degenerate, network-free route: a straight line from start to end. */
export function fallbackRoute(from: GeoPoint, to: GeoPoint): Route {
  const distanceMeters = haversineMeters(from, to);
  return {
    geometry: [from, to],
    distanceMeters,
    durationSeconds: distanceMeters / FALLBACK_SPEED_MPS,
    steps: [
      { instruction: 'Head toward your destination', distanceMeters, location: from },
      { instruction: 'Arrive at your destination', distanceMeters: 0, location: to },
    ],
  };
}

/**
 * Fetch candidate cycling routes between two points from the OSRM backend.
 * Never throws: on any failure (no backend, network error, malformed body, no
 * routes) it returns a single straight-line fallback route.
 */
export async function fetchRoutes(
  from: GeoPoint,
  to: GeoPoint,
  config: RoutingConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<RouteFetchResult> {
  if (!config.routingUrl) {
    return { routes: [fallbackRoute(from, to)], source: 'fallback' };
  }
  const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  const url =
    `${config.routingUrl.replace(/\/$/, '')}/${coords}` +
    `?overview=full&geometries=geojson&steps=true&alternatives=true`;
  try {
    const res = await fetchImpl(url, { headers: { accept: 'application/json' } });
    if (!res.ok) return { routes: [fallbackRoute(from, to)], source: 'fallback' };
    const body = (await res.json()) as OsrmResponse;
    // The geometry check that used to live here is inside `osrmToRoute` now,
    // alongside every other thing a usable route needs. Split across two
    // functions it was an invariant one of them merely assumed.
    const routes = (body.routes ?? [])
      .map(osrmToRoute)
      .filter((r): r is Route => r !== null);
    if (routes.length === 0) return { routes: [fallbackRoute(from, to)], source: 'fallback' };
    return { routes, source: 'osrm' };
  } catch {
    return { routes: [fallbackRoute(from, to)], source: 'fallback' };
  }
}
