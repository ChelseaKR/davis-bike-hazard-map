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
import type { GeoPoint, Hazard, HazardCategory, RouteProfileId, Severity } from './types.ts';
import { SEVERITY_RANK, ROUTE_PROFILE_IDS } from './types.ts';
export { ROUTE_PROFILE_IDS, DEFAULT_ROUTE_PROFILE_ID } from './types.ts';
export type { RouteProfileId } from './types.ts';
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
  /**
   * The rider profile whose weights apply. Absent means {@link ROUTE_PROFILES}'s
   * `default`, whose multipliers are all exactly 1 -- so an omitted profile is
   * byte-identical to the pre-profile behaviour, not merely close to it.
   */
  profile?: RouteProfile;
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
 * Named routing profiles (E2 / EXP-03).
 *
 * A profile is a *stated preference over reported hazards*, and nothing more. It
 * is not a claim about injury risk, it is not evidence, and **no profile makes a
 * route safe** — the hazards it weighs are reports the map received, not a survey
 * of the road. `family-safest` is an id for "avoids what a parent told us they
 * want avoided", and the copy that names it must not promise more than that.
 *
 * The weights are deliberately few and deliberately blunt. Every one of them is a
 * multiplier on the existing penalty, so a profile can only change *how much* a
 * reported hazard costs, never invent a hazard, never suppress one, and never
 * touch what the rider is told is on the route: `nearby` is the same list for
 * every profile.
 */
export interface RouteProfile {
  id: RouteProfileId;
  /** Scoring overrides applied on top of {@link DEFAULT_SCORING}. */
  scoring: Partial<Omit<RouteScoringOptions, 'now' | 'conditions' | 'profile'>>;
  /**
   * Per-category multipliers on a hazard's penalty. A category absent here is
   * multiplied by exactly 1, which is why `default` is byte-identical to the
   * pre-profile behaviour rather than merely close to it.
   */
  categoryMultipliers: Partial<Record<HazardCategory, number>>;
  /**
   * When true, a candidate carrying a high-severity corridor hazard ranks below
   * every candidate carrying none, whatever the distance.
   *
   * This is a **lexicographic** rule, not a large weight, and that is the point:
   * "never routes through a high-severity hazard when any alternative exists" is
   * an absolute statement, and a finite penalty — however large — is beaten by a
   * long enough detour. A weight that is *nearly* absolute would make the claim
   * true on the fixture and false on some real pair of endpoints nobody tried.
   */
  refuseHighSeverityWhenAlternativeExists: boolean;
}

export const ROUTE_PROFILES: Readonly<Record<RouteProfileId, RouteProfile>> = {
  // Unchanged behaviour, stated as a profile so there is no un-named path.
  default: {
    id: 'default',
    scoring: {},
    categoryMultipliers: {},
    refuseHighSeverityWhenAlternativeExists: false,
  },
  // P2 (parent / cargo bike): accept a large detour to avoid what was reported,
  // and refuse a high-severity hazard outright while any alternative exists.
  'family-safest': {
    id: 'family-safest',
    scoring: { highPenaltyMeters: 2400 },
    categoryMultipliers: {
      dangerous_intersection: 2.5,
      blocked_lane: 1.5,
      poor_visibility: 1.5,
      near_miss: 1.5,
    },
    refuseHighSeverityWhenAlternativeExists: true,
  },
  // P3 (e-bike): faster and heavier, so a detour costs less time and surface
  // hazards are hit harder. Not "safer" and not "riskier" — differently weighted.
  'e-bike': {
    id: 'e-bike',
    scoring: { highPenaltyMeters: 1200 },
    categoryMultipliers: {
      pothole: 1.5,
      surface_damage: 1.5,
      glass_debris: 1.3,
    },
    refuseHighSeverityWhenAlternativeExists: false,
  },
};

/** Thrown when a caller names a profile this build does not have. */
export class UnknownRouteProfileError extends Error {
  constructor(requested: string) {
    super(
      `unknown routing profile ${JSON.stringify(requested)}; expected one of: ` +
        `${[...ROUTE_PROFILE_IDS].sort().join(', ')}`,
    );
    this.name = 'UnknownRouteProfileError';
  }
}

/**
 * Resolve a profile id, refusing an unknown one.
 *
 * Fails closed rather than falling back to `default`: a rider who asked for
 * `family-safest` and was quietly given the default route would be told the map
 * had avoided things it had not. That is this project's own defect class — an
 * absence rendered as a value — sitting in the planner.
 */
export function resolveRouteProfile(id: string): RouteProfile {
  // `Object.hasOwn`, not an index-and-check. A plain object literal inherits
  // `constructor`, `toString`, `hasOwnProperty` and friends, so `ROUTE_PROFILES[id]`
  // is truthy for every one of those names and `resolveRouteProfile('constructor')`
  // returned a function rather than refusing. Found by the test that asks for them.
  if (!Object.hasOwn(ROUTE_PROFILES, id)) throw new UnknownRouteProfileError(id);
  return ROUTE_PROFILES[id as RouteProfileId];
}

/** Multiplier a profile puts on this category's penalty. 1 when it names none. */
export function profileWeight(category: HazardCategory, profile: RouteProfile): number {
  return profile.categoryMultipliers[category] ?? 1;
}

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
 * Fill in a partial scoring request: defaults, then the profile's overrides, then
 * whatever the caller stated explicitly.
 *
 * The order is load-bearing. A caller that sets `corridorMeters` wins over a
 * profile that sets it, because the server's corridor is a fact about the privacy
 * fuzz grid rather than a rider preference.
 *
 * Public, and used by every reader of `profile.scoring`, because there was very
 * nearly more than one. `scoreRoute` merged the overrides itself while
 * `hazardPenalty` -- exported, and called directly -- read `opts.highPenaltyMeters`
 * straight through, so the same profile produced a 3x penalty through one entry
 * point and a 1x penalty through the other. The test that compares the two found it.
 */
export function resolveScoringOptions(
  options?: Partial<RouteScoringOptions>,
): RouteScoringOptions {
  const profile = options?.profile ?? ROUTE_PROFILES.default;
  return {
    ...DEFAULT_SCORING,
    ...profile.scoring,
    now: options?.now ?? Date.now(),
    ...options,
  };
}

/**
 * Penalty (equivalent detour metres) a single hazard adds to a route, given its
 * closest distance to the line.
 *
 * `opts` must already be RESOLVED -- see {@link resolveScoringOptions}, which is
 * what `scoreRoute` calls. This function reads `opts.highPenaltyMeters` as given
 * and does not re-apply a profile's overrides on top of it, because doing so would
 * let the profile beat a value the caller stated explicitly. Falls off linearly across the corridor so a
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
    profileWeight(hazard.category, opts.profile ?? ROUTE_PROFILES.default) *
    proximity
  );
}

/** Score one route against the live hazard set. */
export function scoreRoute(
  route: Route,
  hazards: Hazard[],
  options?: Partial<RouteScoringOptions>,
): ScoredRoute {
  const opts = resolveScoringOptions(options);
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
  const profile = options?.profile ?? ROUTE_PROFILES.default;
  const scored = routes.map((r) => scoreRoute(r, hazards, options));
  if (!profile.refuseHighSeverityWhenAlternativeExists) {
    return scored.sort((a, b) => a.cost - b.cost);
  }
  // Lexicographic, not a large weight: candidates with no high-severity corridor
  // hazard come first as a group, and cost decides only inside each group. See
  // RouteProfile.refuseHighSeverityWhenAlternativeExists for why this is not a
  // number. `hasHighSeverityNearby` reads the corridor list scoreRoute built, so
  // the two can never disagree about what is on the route.
  return scored.sort((a, b) => {
    const aHigh = hasHighSeverityNearby(a);
    const bHigh = hasHighSeverityNearby(b);
    if (aHigh !== bHigh) return aHigh ? 1 : -1;
    return a.cost - b.cost;
  });
}

/** Does this scored candidate carry a high-severity hazard inside its corridor? */
export function hasHighSeverityNearby(scored: ScoredRoute): boolean {
  return scored.nearby.some((n) => n.hazard.severity === 'high');
}

/**
 * Did any scored candidate carry no corridor hazard at all?
 *
 * The evidence behind `RoutePlan.hazardFreeCandidate`. Kept next to
 * `rankRoutes` because it reads the per-candidate `nearby` arrays that
 * `rankRoutes` produces and that the plan then throws away.
 *
 * Callers must only ask this when a real search happened: with a single
 * straight-line fallback candidate the answer is arithmetically defined but
 * means nothing, and reporting it would be the same unsupported claim in a
 * different direction.
 */
export function hasHazardFreeCandidate(ranked: ScoredRoute[]): boolean {
  return ranked.some((r) => r.nearby.length === 0);
}

/**
 * The fastest candidate route considered, by raw travel time — the "honest
 * cost" comparison (EXP-03, Route honesty panel): what the hazard-aware pick
 * costs versus simply taking the quickest option, and what riding that
 * quicker option would still expose you to.
 */
export interface FastestAlternative {
  distanceMeters: number;
  durationSeconds: number;
  /** Corridor hazards the fastest candidate passes near, closest first. */
  nearby: NearbyHazard[];
}

/**
 * Find the fastest (lowest raw duration) candidate among already-ranked
 * routes and package it as the comparison against the chosen (`ranked[0]`)
 * route — or `null` when the chosen route already is the fastest one, i.e.
 * nothing was traded away to avoid hazards.
 *
 * Pure and independent of `rankRoutes`'s cost ordering: it only reads the raw
 * `route.durationSeconds` each candidate already carries.
 */
export function findFastestAlternative(ranked: ScoredRoute[]): FastestAlternative | null {
  if (ranked.length === 0) return null;
  const chosen = ranked[0];
  let fastest = chosen;
  for (const candidate of ranked) {
    if (candidate.route.durationSeconds < fastest.route.durationSeconds) fastest = candidate;
  }
  if (fastest.route === chosen.route) return null;
  return {
    distanceMeters: fastest.route.distanceMeters,
    durationSeconds: fastest.route.durationSeconds,
    nearby: fastest.nearby,
  };
}

// The reference latitude/longitude for solar-position math used to live here, as a
// hand-copied second pair of literals with a comment promising they matched
// `DAVIS_CENTER` — a promise nothing checked, in the module the place-pack issue
// (#181) forgot to list. They are gone rather than re-homed: every function below
// already takes `lat`/`lng` as arguments, so this module needs no place data at all,
// and callers read the centre off the place pack (`PLACE.center`). That keeps this
// scoring module dependency-free — `shared/place.ts` pulls in zod — while removing
// the possibility of the two values drifting apart.

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
   * Whether any candidate that was actually SCORED carried no corridor hazard
   * at all — the only evidence that can support (or refute) a claim about a
   * hazard-free route existing.
   *
   * `true`  — a hazard-free candidate was ranked and lost on cost. The planner
   *           traded it away on purpose (see {@link rankRoutes}); the rider is
   *           entitled to be told that rather than told none existed.
   * `false` — every candidate scored had at least one corridor hazard.
   * `null`  — NO SEARCH HAPPENED. `source === 'fallback'` returns one
   *           degenerate straight line, so there is nothing to have found and
   *           no claim of either kind is supportable.
   *
   * Issue #163: the UI previously derived "No hazard-free route was found" from
   * `nearby.length > 0` on the CHOSEN route alone. The per-candidate `nearby`
   * arrays are discarded when `plan.nearby` is assigned, so the client held no
   * evidence at all — including in the fallback path.
   */
  hazardFreeCandidate: boolean | null;
  /**
   * The fastest candidate route, when it differs from the chosen one — see
   * {@link findFastestAlternative}. `null` when the hazard-aware pick already
   * is the fastest option (or there was only one candidate): no trade-off
   * was made, so there is nothing honest to compare.
   */
  fastestAlternative: FastestAlternative | null;
  /**
   * True when the plan was scored for darkness (past civil twilight in Davis),
   * which weights poor-visibility hazards higher. Surfaced so the UI can say so
   * honestly — the ranking changed *because* it's night.
   */
  nightWeighting?: boolean;
  /** The rider profile this plan was asked for. Always the id the caller sent. */
  profile: RouteProfileId;
  /**
   * Whether the profile's weighting actually chose the route you were given.
   *
   * Three states, for the reason {@link RoutePlan.hazardFreeCandidate} has three:
   * an echo of the requested profile is not evidence that it did anything.
   *
   * `true`  -- more than one candidate was scored, so the weighting picked among
   *            them and a different profile could have produced a different route.
   * `false` -- exactly one candidate came back from the road graph. The weights
   *            were applied to it, but there was nothing to choose between, so the
   *            route is not one the profile selected.
   * `null`  -- NO SEARCH HAPPENED. `source === 'fallback'` is one straight line
   *            drawn between the endpoints; no road graph was consulted and no
   *            profile can be said to have routed anything.
   */
  profileApplied: boolean | null;
}
