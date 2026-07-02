import { describe, it, expect } from 'vitest';
import {
  pointToSegmentMeters,
  distanceToRouteMeters,
  severityWeight,
  recencyWeight,
  confirmationWeight,
  hazardPenalty,
  scoreRoute,
  rankRoutes,
  conditionWeight,
  NIGHT_MULTIPLIERS,
  isDarkAt,
  solarAltitudeDeg,
  DAVIS_LAT,
  DAVIS_LNG,
  DEFAULT_SCORING,
  type Route,
  type RouteScoringOptions,
} from '../../shared/routing.ts';
import type { Hazard, Severity } from '../../shared/types.ts';

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function hazard(over: Partial<Hazard> = {}): Hazard {
  return {
    id: 'h1',
    clientId: 'c1',
    category: 'pothole',
    severity: 'high',
    description: null,
    location: { lat: 38.545, lng: -121.74 },
    photoUrl: null,
    thumbnailUrl: null,
    status: 'approved',
    confirmations: 0,
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: NOW + 30 * DAY,
    ...over,
  };
}

// A short west→east route through central Davis (lng increases, lat constant).
const route: Route = {
  geometry: [
    { lat: 38.545, lng: -121.75 },
    { lat: 38.545, lng: -121.73 },
  ],
  distanceMeters: 1740,
  durationSeconds: 400,
  steps: [],
};

const opts = (over: Partial<RouteScoringOptions> = {}): RouteScoringOptions => ({
  ...DEFAULT_SCORING,
  now: NOW,
  ...over,
});

describe('pointToSegmentMeters', () => {
  it('is ~0 for a point on the segment', () => {
    const d = pointToSegmentMeters(
      { lat: 38.545, lng: -121.74 },
      route.geometry[0],
      route.geometry[1],
    );
    expect(d).toBeLessThan(1);
  });

  it('clamps to the nearest endpoint when the projection falls outside', () => {
    // Well west of the start point.
    const d = pointToSegmentMeters(
      { lat: 38.545, lng: -121.76 },
      route.geometry[0],
      route.geometry[1],
    );
    // ~one cell west of -121.75 at this latitude (~870 m).
    expect(d).toBeGreaterThan(700);
    expect(d).toBeLessThan(1000);
  });

  it('handles a degenerate (zero-length) segment', () => {
    const p = { lat: 38.546, lng: -121.74 };
    const a = { lat: 38.545, lng: -121.74 };
    expect(pointToSegmentMeters(p, a, a)).toBeGreaterThan(100);
  });
});

describe('distanceToRouteMeters', () => {
  it('returns Infinity for empty geometry and a point distance for a single vertex', () => {
    expect(distanceToRouteMeters({ lat: 38.5, lng: -121.7 }, [])).toBe(Infinity);
    expect(
      distanceToRouteMeters({ lat: 38.545, lng: -121.74 }, [{ lat: 38.545, lng: -121.74 }]),
    ).toBeLessThan(1);
  });

  it('takes the minimum across segments', () => {
    const d = distanceToRouteMeters({ lat: 38.545, lng: -121.735 }, route.geometry);
    expect(d).toBeLessThan(1);
  });
});

describe('weights', () => {
  it('severityWeight grows with severity', () => {
    const sev: Severity[] = ['low', 'moderate', 'high'];
    const ws = sev.map(severityWeight);
    expect(ws).toEqual([1, 2, 4]);
  });

  it('recencyWeight decays with age and is floored', () => {
    expect(recencyWeight(NOW, NOW, 14)).toBeCloseTo(1);
    expect(recencyWeight(NOW - 14 * DAY, NOW, 14)).toBeCloseTo(0.5, 2);
    // Very old → floored, not zero.
    expect(recencyWeight(NOW - 9999 * DAY, NOW, 14)).toBe(0.15);
  });

  it('confirmationWeight rises with confirmations and saturates at 5', () => {
    expect(confirmationWeight(0)).toBe(1);
    expect(confirmationWeight(3)).toBeCloseTo(1.3);
    expect(confirmationWeight(50)).toBeCloseTo(1.5);
  });
});

describe('hazardPenalty', () => {
  it('is zero at/outside the corridor', () => {
    expect(hazardPenalty(hazard(), 45, opts({ corridorMeters: 45 }))).toBe(0);
    expect(hazardPenalty(hazard(), 100, opts())).toBe(0);
  });

  it('a fresh high-severity hazard on the line ≈ highPenaltyMeters', () => {
    const p = hazardPenalty(hazard({ severity: 'high' }), 0, opts({ highPenaltyMeters: 800 }));
    expect(p).toBeCloseTo(800, 0);
  });

  it('falls off linearly toward the corridor edge', () => {
    const near = hazardPenalty(hazard(), 0, opts({ corridorMeters: 40 }));
    const mid = hazardPenalty(hazard(), 20, opts({ corridorMeters: 40 }));
    expect(mid).toBeCloseTo(near / 2, 0);
  });

  it('penalises high-severity more than low', () => {
    const high = hazardPenalty(hazard({ severity: 'high' }), 0, opts());
    const low = hazardPenalty(hazard({ severity: 'low' }), 0, opts());
    expect(high).toBeGreaterThan(low * 3);
  });
});

describe('scoreRoute', () => {
  it('collects only hazards inside the corridor, closest first', () => {
    const hazards = [
      hazard({ id: 'on', location: { lat: 38.545, lng: -121.74 } }), // on the line
      hazard({ id: 'near', location: { lat: 38.5452, lng: -121.738 } }), // ~22 m off
      hazard({ id: 'far', location: { lat: 38.55, lng: -121.74 } }), // ~550 m off
    ];
    const scored = scoreRoute(route, hazards, opts({ corridorMeters: 45 }));
    expect(scored.nearby.map((n) => n.hazard.id)).toEqual(['on', 'near']);
    expect(scored.penalty).toBeGreaterThan(0);
    expect(scored.cost).toBe(route.distanceMeters + scored.penalty);
  });

  it('a hazard-free route has zero penalty (cost = distance)', () => {
    const scored = scoreRoute(route, [hazard({ location: { lat: 38.56, lng: -121.74 } })], opts());
    expect(scored.penalty).toBe(0);
    expect(scored.cost).toBe(route.distanceMeters);
  });
});

describe('rankRoutes', () => {
  it('prefers a slightly longer route that avoids a hazard cluster', () => {
    const direct = route; // passes right through the hazard
    const detour: Route = {
      geometry: [
        { lat: 38.547, lng: -121.75 },
        { lat: 38.547, lng: -121.73 },
      ],
      distanceMeters: route.distanceMeters + 250, // a bit longer
      durationSeconds: 460,
      steps: [],
    };
    const hazards = [
      hazard({ severity: 'high', confirmations: 3, location: { lat: 38.545, lng: -121.74 } }),
    ];
    const ranked = rankRoutes([direct, detour], hazards, opts({ corridorMeters: 45 }));
    expect(ranked[0].route).toBe(detour); // the safer one wins despite being longer
    expect(ranked[0].cost).toBeLessThan(ranked[1].cost);
  });

  it('keeps the shortest route when there are no hazards', () => {
    const longer: Route = { ...route, distanceMeters: route.distanceMeters + 500 };
    const ranked = rankRoutes([longer, route], [], opts());
    expect(ranked[0].route).toBe(route);
  });
});

// A fixed winter date so the twilight math is fully deterministic. Davis is on
// PST (UTC−8) in January, so local clock time = UTC − 8h.
const NOON_LOCAL = Date.UTC(2026, 0, 15, 20, 0, 0); // 12:00 PST
const NIGHT_LOCAL = Date.UTC(2026, 0, 16, 7, 0, 0); // 23:00 PST

describe('isDarkAt (civil twilight)', () => {
  it('is false at Davis noon and true at 23:00 local', () => {
    // Sanity on the underlying altitude: sun up at noon, well down at 23:00.
    expect(solarAltitudeDeg(NOON_LOCAL, DAVIS_LAT, DAVIS_LNG)).toBeGreaterThan(0);
    expect(solarAltitudeDeg(NIGHT_LOCAL, DAVIS_LAT, DAVIS_LNG)).toBeLessThan(-6);
    expect(isDarkAt(NOON_LOCAL, DAVIS_LAT, DAVIS_LNG)).toBe(false);
    expect(isDarkAt(NIGHT_LOCAL, DAVIS_LAT, DAVIS_LNG)).toBe(true);
  });
});

describe('conditionWeight / night hazard weighting', () => {
  it('doubles a poor_visibility hazard only when it is dark; other categories are unchanged', () => {
    expect(NIGHT_MULTIPLIERS.poor_visibility).toBe(2);
    // Poor visibility: 1 by day, 2 at night.
    expect(conditionWeight('poor_visibility')).toBe(1);
    expect(conditionWeight('poor_visibility', { isDark: false })).toBe(1);
    expect(conditionWeight('poor_visibility', { isDark: true })).toBe(2);
    // Potholes don't care about darkness.
    expect(conditionWeight('pothole', { isDark: true })).toBe(1);
  });

  it('gives a poor_visibility hazard a higher penalty at night, leaving other categories flat', () => {
    const pv = hazard({ category: 'poor_visibility', severity: 'moderate' });
    const dayPv = hazardPenalty(pv, 0, opts());
    const nightPv = hazardPenalty(pv, 0, opts({ conditions: { isDark: true } }));
    expect(nightPv).toBeCloseTo(dayPv * 2, 6);
    expect(nightPv).toBeGreaterThan(dayPv);

    // A non-visibility hazard is identical day vs night.
    const pothole = hazard({ category: 'pothole', severity: 'moderate' });
    const dayPot = hazardPenalty(pothole, 0, opts());
    const nightPot = hazardPenalty(pothole, 0, opts({ conditions: { isDark: true } }));
    expect(nightPot).toBe(dayPot);
  });
});

describe('rankRoutes diverges by time of day', () => {
  it('picks the shorter route by day but the safer one at night when a poor_visibility hazard sits on the short route', () => {
    // Shorter route (on lat 38.545) carries a poor_visibility hazard.
    const shorter: Route = {
      geometry: [
        { lat: 38.545, lng: -121.75 },
        { lat: 38.545, lng: -121.73 },
      ],
      distanceMeters: 1740,
      durationSeconds: 400,
      steps: [],
    };
    // A parallel route ~220 m north — longer, but clear of the hazard.
    const longer: Route = {
      geometry: [
        { lat: 38.547, lng: -121.75 },
        { lat: 38.547, lng: -121.73 },
      ],
      distanceMeters: 1740 + 600,
      durationSeconds: 540,
      steps: [],
    };
    const hazards = [
      hazard({
        category: 'poor_visibility',
        severity: 'moderate',
        location: { lat: 38.545, lng: -121.74 },
      }),
    ];

    // By day: the poor_visibility penalty (~400) is smaller than the 600 m
    // detour, so the shorter route still wins.
    const byDay = rankRoutes([shorter, longer], hazards, opts());
    expect(byDay[0].route).toBe(shorter);

    // At night: the penalty doubles (~800) and now exceeds the detour, so the
    // planner diverges and takes the longer, safer route.
    const byNight = rankRoutes([shorter, longer], hazards, opts({ conditions: { isDark: true } }));
    expect(byNight[0].route).toBe(longer);
  });
});
