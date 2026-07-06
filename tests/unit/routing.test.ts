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
