/**
 * Hazard-aware bike routing: pure, framework-free geometry + scoring.
 *
 * The actual road graph comes from an OSRM-compatible backend (see
 * server/lib/routing.ts), proxied through our own API so the browser only ever
 * talks same-origin (CSP stays `'self'`, and the route response is cacheable by
 * the service worker for offline reuse). THIS module holds the part that makes
 * the planner *hazard-aware*: given candidate routes and the live hazard feed,
 * it penalises routes that pass close to reported hazards — weighted by severity,
 * recency, and community confirmations — and picks the safest reasonable one.
 *
 * Everything here is deterministic and dependency-free so it can be unit-tested
 * without a network, a map, or a clock.
 */
import type { GeoPoint, Hazard, HazardCategory, Severity } from './types.ts';
import { SEVERITY_RANK } from './types.ts';
import { haversineMeters } from './geo.ts';

const METERS_PER_DEG_LAT = 111_320;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A single turn-by-turn maneuver (the accessible equivalent of the polyline). */
export interface RouteStep {
  /** Human-readable instruction, e.g. "Turn left onto Russell Blvd". */
  instruction: string;
  /** Length of this step, in metres. */
  distanceMeters: number;
  /** Where the maneuver happens (for "show on map" / focus). */
  location: GeoPoint;
}

/** A candidate cycling route. */
export interface Route {
  /** Ordered polyline (lat/lng) describing the route geometry. */
  geometry: GeoPoint[];
  distanceMeters: number;
  durationSeconds: number;
  steps: RouteStep[];
}

/** A hazard found within the avoidance corridor of a route. */
export interface NearbyHazard {
  hazard: Hazard;
  /** Closest distance (m) from the hazard to the route polyline. */
  distanceMeters: number;
  /** This hazard's contribution to the route's penalty. */
  penalty: number;
}

/** A route plus the hazard analysis used to rank it. */
export interface ScoredRoute {
  route: Route;
  /** Hazards inside the corridor, closest first. */
  nearby: NearbyHazard[];
  /** Total weighted hazard penalty, expressed in equivalent metres of detour. */
  penalty: number;
  /** Ranking cost: distanceMeters + penalty (lower is better). */
  cost: number;
}

/**
 * Environmental conditions at planning time that change how much a hazard
 * matters. Kept deliberately small and explicit so scoring stays pure and the
 * plan can be honest about *why* a route was re-weighted.
 */
export interface RouteConditions {
  /** True after civil twilight (sun below −6°): darkness amplifies some hazards. */
  isDark: boolean;
}

export interface RouteScoringOptions {
  /** Corridor half-width (m): hazards within this of the line are considered. */
  corridorMeters: number;
  /** Penalty (equivalent detour metres) for a fresh high-severity hazard on the line. */
  highPenaltyMeters: number;
  /** Recency half-life (days): a hazard's weight halves every this-many days. */
  recencyHalfLifeDays: number;
  now: number;
  /** Time/environment conditions; absent means "assume neutral daytime". */
  conditions?: RouteConditions;
}

export const DEFAULT_SCORING: Omit<RouteScoringOptions, 'now'> = {
  corridorMeters: 30,
  highPenaltyMeters: 800,
  recencyHalfLifeDays: 14,
};

/**
 * Per-category multipliers applied when it's dark (after civil twilight).
 *
 * A `poor_visibility` hazard (an unlit path, a blind, badly-sighted crossing)
 * is materially more dangerous at night than in daylight, so we weight it up.
 * Categories absent from this table are unaffected by darkness (multiplier 1).
 */
export const NIGHT_MULTIPLIERS: Partial<Record<HazardCategory, number>> = {
  poor_visibility: 2,
};

/**
 * Condition multiplier for a hazard category. Returns 1 (no effect) unless it's
 * dark AND the category has a night multiplier. Pure and total.
 */
export function conditionWeight(
  category: HazardCategory,
  conditions?: RouteConditions,
): number {
  if (conditions?.isDark) return NIGHT_MULTIPLIERS[category] ?? 1;
  return 1;
}

/** Local equirectangular projection (metres) around a reference latitude. */
function toLocal(p: GeoPoint, refLat: number): { x: number; y: number } {
  const metersPerDegLng = METERS_PER_DEG_LAT * Math.cos((refLat * Math.PI) / 180);
  return { x: p.lng * metersPerDegLng, y: p.lat * METERS_PER_DEG_LAT };
}

/**
 * Shortest distance (m) from a point to a line segment a–b.
 *
 * Uses a local planar projection — exact enough at city scale and far cheaper
 * than per-segment haversine, which matters when scoring many hazards against
 * many route vertices.
 */
export function pointToSegmentMeters(p: GeoPoint, a: GeoPoint, b: GeoPoint): number {
  const refLat = (a.lat + b.lat) / 2;
  const pp = toLocal(p, refLat);
  const pa = toLocal(a, refLat);
  const pb = toLocal(b, refLat);
  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return haversineMeters(p, a); // degenerate segment
  // Project p onto the segment, clamped to [0,1].
  let t = ((pp.x - pa.x) * dx + (pp.y - pa.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = pa.x + t * dx;
  const cy = pa.y + t * dy;
  return Math.hypot(pp.x - cx, pp.y - cy);
}

/** Closest distance (m) from a point to a route polyline. */
export function distanceToRouteMeters(p: GeoPoint, geometry: GeoPoint[]): number {
  if (geometry.length === 0) return Infinity;
  if (geometry.length === 1) return haversineMeters(p, geometry[0]);
  let min = Infinity;
  for (let i = 0; i < geometry.length - 1; i++) {
    const d = pointToSegmentMeters(p, geometry[i], geometry[i + 1]);
    if (d < min) min = d;
  }
  return min;
}

/** Severity multiplier: high hazards weigh markedly more than low ones. */
export function severityWeight(severity: Severity): number {
  // low → 1, moderate → 2, high → 4 (rank 0/1/2 ⇒ 2^rank).
  return 2 ** SEVERITY_RANK[severity];
}

/**
 * Recency multiplier in (floor, 1]. A hazard reported now weighs 1; its weight
 * halves every `halfLifeDays`. Floored so a stale-but-unexpired hazard still
 * nudges the route — old potholes are often still there.
 */
export function recencyWeight(updatedAt: number, now: number, halfLifeDays: number): number {
  const ageDays = Math.max(0, (now - updatedAt) / DAY_MS);
  const decayed = 0.5 ** (ageDays / halfLifeDays);
  return Math.max(0.15, decayed);
}

/** Confirmation multiplier: more independent sightings ⇒ more real ⇒ avoid more. */
export function confirmationWeight(confirmations: number): number {
  return 1 + Math.min(5, Math.max(0, confirmations)) * 0.1;
}

/**
 * Penalty (equivalent detour metres) a single hazard adds to a route, given its
 * closest distance to the line. Falls off linearly across the corridor so a
 * hazard right on the route costs the most and one at the corridor edge ~0.
 */
export function hazardPenalty(
  hazard: Hazard,
  distanceMeters: number,
  opts: RouteScoringOptions,
): number {
  if (distanceMeters >= opts.corridorMeters) return 0;
  const proximity = 1 - distanceMeters / opts.corridorMeters; // (0,1]
  const base = opts.highPenaltyMeters / severityWeight('high'); // per unit severity weight
  return (
    base *
    severityWeight(hazard.severity) *
    recencyWeight(hazard.updatedAt, opts.now, opts.recencyHalfLifeDays) *
    confirmationWeight(hazard.confirmations) *
    conditionWeight(hazard.category, opts.conditions) *
    proximity
  );
}

/** Score one route against the live hazard set. */
export function scoreRoute(
  route: Route,
  hazards: Hazard[],
  options?: Partial<RouteScoringOptions>,
): ScoredRoute {
  const opts: RouteScoringOptions = {
    ...DEFAULT_SCORING,
    now: options?.now ?? Date.now(),
    ...options,
  };
  const nearby: NearbyHazard[] = [];
  let penalty = 0;
  for (const hazard of hazards) {
    const distanceMeters = distanceToRouteMeters(hazard.location, route.geometry);
    if (distanceMeters >= opts.corridorMeters) continue;
    const p = hazardPenalty(hazard, distanceMeters, opts);
    penalty += p;
    nearby.push({ hazard, distanceMeters, penalty: p });
  }
  nearby.sort((a, b) => a.distanceMeters - b.distanceMeters);
  return { route, nearby, penalty, cost: route.distanceMeters + penalty };
}

/**
 * Rank candidate routes by hazard-aware cost and return them best-first.
 *
 * The cheapest *cost* (distance + hazard penalty) wins, so the planner will
 * accept a modestly longer route to dodge a cluster of fresh, high-severity
 * hazards, but won't take a wildly long detour to avoid one stale, low one.
 */
export function rankRoutes(
  routes: Route[],
  hazards: Hazard[],
  options?: Partial<RouteScoringOptions>,
): ScoredRoute[] {
  return routes
    .map((r) => scoreRoute(r, hazards, options))
    .sort((a, b) => a.cost - b.cost);
}

// Davis reference lat/lng for solar-position math. Kept local (rather than
// importing DAVIS_CENTER from validation.ts) so this scoring module stays
// dependency-free — validation.ts pulls in zod. Value matches DAVIS_CENTER.
/** Davis, CA reference latitude for civil-twilight math. */
export const DAVIS_LAT = 38.5449;
/** Davis, CA reference longitude for civil-twilight math. */
export const DAVIS_LNG = -121.7405;

/** Civil-twilight threshold: the sun sits below this altitude when it's "dark". */
const CIVIL_TWILIGHT_ALTITUDE_DEG = -6;

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/**
 * Sun altitude (degrees above the horizon) at a given instant and place.
 *
 * Standard NOAA solar-position approximation — no network, no ephemeris tables.
 * Accurate to well within the ~0.5° we need to decide "is it dark enough that
 * poor-visibility hazards matter more?" Pure and deterministic given its inputs.
 */
export function solarAltitudeDeg(epochMs: number, lat: number, lng: number): number {
  // Julian day and Julian century (J2000.0 epoch).
  const jd = epochMs / 86_400_000 + 2_440_587.5;
  const t = (jd - 2_451_545.0) / 36_525;

  // Geometric mean longitude and anomaly of the sun (degrees).
  const l0 = ((280.46646 + t * (36000.76983 + t * 0.0003032)) % 360 + 360) % 360;
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const mRad = toRad(m);

  // Orbital eccentricity and the sun's equation of the centre.
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const c =
    Math.sin(mRad) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * mRad) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * mRad) * 0.000289;

  // Apparent ecliptic longitude of the sun.
  const trueLong = l0 + c;
  const omega = 125.04 - 1934.136 * t;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(toRad(omega));

  // Obliquity of the ecliptic (with nutation correction).
  const eps0 =
    23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(toRad(omega));

  // Solar declination.
  const declRad = Math.asin(Math.sin(toRad(eps)) * Math.sin(toRad(lambda)));

  // Equation of time (minutes).
  const y = Math.tan(toRad(eps) / 2) ** 2;
  const l0Rad = toRad(l0);
  const eqTime =
    4 *
    toDeg(
      y * Math.sin(2 * l0Rad) -
        2 * e * Math.sin(mRad) +
        4 * e * y * Math.sin(mRad) * Math.cos(2 * l0Rad) -
        0.5 * y * y * Math.sin(4 * l0Rad) -
        1.25 * e * e * Math.sin(2 * mRad),
    );

  // True solar time (minutes) at this longitude, then the hour angle (degrees).
  const minutesUtc = ((epochMs % 86_400_000) + 86_400_000) % 86_400_000 / 60_000;
  let trueSolarTime = minutesUtc + eqTime + 4 * lng;
  trueSolarTime = ((trueSolarTime % 1440) + 1440) % 1440;
  let hourAngle = trueSolarTime / 4 - 180;
  if (hourAngle < -180) hourAngle += 360;

  // Solar zenith → altitude.
  const latRad = toRad(lat);
  const cosZenith =
    Math.sin(latRad) * Math.sin(declRad) +
    Math.cos(latRad) * Math.cos(declRad) * Math.cos(toRad(hourAngle));
  const zenith = Math.acos(Math.max(-1, Math.min(1, cosZenith)));
  return 90 - toDeg(zenith);
}

/**
 * True when it's dark (past civil twilight) at the given instant and place —
 * the signal that flips on night-aware hazard weighting.
 */
export function isDarkAt(epochMs: number, lat: number, lng: number): boolean {
  return solarAltitudeDeg(epochMs, lat, lng) < CIVIL_TWILIGHT_ALTITUDE_DEG;
}

/** The hazard-aware route plan the API returns and the client renders. */
export interface RoutePlan {
  /** 'osrm' when a real road graph was used; 'fallback' for a straight-line stub. */
  source: 'osrm' | 'fallback';
  from: GeoPoint;
  to: GeoPoint;
  /** The chosen (lowest hazard-aware cost) route. */
  route: Route;
  /** Hazards within the corridor of the CHOSEN route, closest first. */
  nearby: NearbyHazard[];
  /** How many candidate routes were considered before picking this one. */
  alternativesConsidered: number;
  /**
   * True when the plan was scored for darkness (past civil twilight in Davis),
   * which weights poor-visibility hazards higher. Surfaced so the UI can say so
   * honestly — the ranking changed *because* it's night.
   */
  nightWeighting?: boolean;
}
