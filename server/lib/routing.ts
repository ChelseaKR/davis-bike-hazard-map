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

/** Minimal shape of the bits of an OSRM response we read. */
interface OsrmResponse {
  code?: string;
  routes?: OsrmRoute[];
}
interface OsrmRoute {
  distance: number;
  duration: number;
  geometry?: { coordinates?: [number, number][] };
  legs?: { steps?: OsrmStep[] }[];
}
interface OsrmStep {
  distance: number;
  name?: string;
  maneuver?: { location?: [number, number]; type?: string; modifier?: string };
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

function osrmToRoute(r: OsrmRoute): Route {
  const coords = r.geometry?.coordinates ?? [];
  const geometry: GeoPoint[] = coords.map(([lng, lat]) => ({ lat, lng }));
  const steps: RouteStep[] = [];
  for (const leg of r.legs ?? []) {
    for (const s of leg.steps ?? []) {
      const loc = s.maneuver?.location;
      steps.push({
        instruction: describeStep(s),
        distanceMeters: s.distance ?? 0,
        location: loc ? { lat: loc[1], lng: loc[0] } : geometry[0] ?? { lat: 0, lng: 0 },
      });
    }
  }
  return {
    geometry,
    distanceMeters: r.distance,
    durationSeconds: r.duration,
    steps,
  };
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
    const routes = (body.routes ?? [])
      .filter((r) => Array.isArray(r.geometry?.coordinates) && r.geometry!.coordinates!.length >= 2)
      .map(osrmToRoute);
    if (routes.length === 0) return { routes: [fallbackRoute(from, to)], source: 'fallback' };
    return { routes, source: 'osrm' };
  } catch {
    return { routes: [fallbackRoute(from, to)], source: 'fallback' };
  }
}
