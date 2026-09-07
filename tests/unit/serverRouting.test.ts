import { describe, it, expect, vi } from 'vitest';
import { describeStep, fallbackRoute, fetchRoutes } from '../../server/lib/routing.ts';
import { isDarkAt, rankRoutes, type Route } from '../../shared/routing.ts';
import type { Hazard } from '../../shared/types.ts';

// Davis's latitude/longitude, local to this file for the same reason as in
// routing.test.ts: the assertions are about the solar math, not the pack.
const DAVIS_LAT = 38.5449;
const DAVIS_LNG = -121.7405;

const FROM = { lat: 38.5449, lng: -121.7405 };
const TO = { lat: 38.5462, lng: -121.7361 };

function osrmBody() {
  return {
    code: 'Ok',
    routes: [
      {
        distance: 1200,
        duration: 300,
        geometry: {
          coordinates: [
            [-121.7405, 38.5449],
            [-121.7383, 38.5455],
            [-121.7361, 38.5462],
          ],
        },
        legs: [
          {
            steps: [
              { distance: 600, name: '3rd St', maneuver: { type: 'depart', location: [-121.7405, 38.5449] } },
              { distance: 600, name: 'B St', maneuver: { type: 'turn', modifier: 'left', location: [-121.7383, 38.5455] } },
              { distance: 0, maneuver: { type: 'arrive', location: [-121.7361, 38.5462] } },
            ],
          },
        ],
      },
      {
        distance: 1400,
        duration: 360,
        geometry: { coordinates: [[-121.7405, 38.5449], [-121.7361, 38.5462]] },
        legs: [{ steps: [] }],
      },
    ],
  };
}

describe('describeStep', () => {
  it('renders common maneuvers in plain language', () => {
    expect(describeStep({ distance: 1, maneuver: { type: 'depart' }, name: '3rd St' })).toMatch(/Head out on 3rd St/);
    expect(describeStep({ distance: 1, maneuver: { type: 'turn', modifier: 'left' }, name: 'B St' })).toBe('Turn left onto B St');
    expect(describeStep({ distance: 1, maneuver: { type: 'arrive' } })).toMatch(/Arrive/);
    expect(describeStep({ distance: 1, maneuver: { type: 'roundabout' }, name: 'F St' })).toMatch(/roundabout onto F St/);
    expect(describeStep({ distance: 1, maneuver: { type: 'continue' } })).toBe('Continue');
  });
});

describe('fallbackRoute', () => {
  it('is a straight line with two steps and a positive distance', () => {
    const r = fallbackRoute(FROM, TO);
    expect(r.geometry).toEqual([FROM, TO]);
    expect(r.distanceMeters).toBeGreaterThan(0);
    expect(r.durationSeconds).toBeGreaterThan(0);
    expect(r.steps).toHaveLength(2);
  });
});

describe('fetchRoutes', () => {
  it('returns a fallback (no network) when no routingUrl is set', async () => {
    const fetchMock = vi.fn();
    const res = await fetchRoutes(FROM, TO, { routingUrl: '' }, fetchMock as unknown as typeof fetch);
    expect(res.source).toBe('fallback');
    expect(res.routes).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('parses OSRM alternatives into normalized routes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => osrmBody(),
    } as Response);
    const res = await fetchRoutes(FROM, TO, { routingUrl: 'https://osrm.test/route/v1/cycling' }, fetchMock as unknown as typeof fetch);
    expect(res.source).toBe('osrm');
    expect(res.routes).toHaveLength(2);
    expect(res.routes[0].geometry).toHaveLength(3);
    expect(res.routes[0].steps[0].instruction).toMatch(/3rd St/);
    expect(res.routes[0].steps[1].instruction).toBe('Turn left onto B St');
    // Coordinates are flipped from [lng,lat] to {lat,lng}.
    expect(res.routes[0].geometry[0]).toEqual({ lat: 38.5449, lng: -121.7405 });
    // The requested URL carries alternatives + geojson + steps.
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('alternatives=true');
    expect(url).toContain('geometries=geojson');
    expect(url).toContain(`${FROM.lng},${FROM.lat};${TO.lng},${TO.lat}`);
  });

  it('falls back gracefully on a non-2xx response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 } as Response);
    const res = await fetchRoutes(FROM, TO, { routingUrl: 'https://osrm.test' }, fetchMock as unknown as typeof fetch);
    expect(res.source).toBe('fallback');
  });

  it('falls back gracefully when the backend throws', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await fetchRoutes(FROM, TO, { routingUrl: 'https://osrm.test' }, fetchMock as unknown as typeof fetch);
    expect(res.source).toBe('fallback');
    expect(res.routes).toHaveLength(1);
  });

  it('falls back when OSRM returns no usable routes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ code: 'NoRoute', routes: [] }) } as Response);
    const res = await fetchRoutes(FROM, TO, { routingUrl: 'https://osrm.test' }, fetchMock as unknown as typeof fetch);
    expect(res.source).toBe('fallback');
  });
});

// Mirrors the /api/route planner: derive `conditions` from the request clock at
// Davis, then rank. Same candidate routes + hazard, only the time changes.
describe('planner night-condition weighting (as wired in the route handler)', () => {
  const NOW = 1_700_000_000_000; // fixed clock for the hazard's recency
  const DAY = 24 * 60 * 60 * 1000;

  // Davis is PST (UTC−8) in January.
  const NOON = Date.UTC(2026, 0, 15, 20, 0, 0); // 12:00 PST → daylight
  const MIDNIGHT = Date.UTC(2026, 0, 16, 8, 0, 0); // 00:00 PST → dark

  const shorter: Route = {
    geometry: [
      { lat: 38.545, lng: -121.75 },
      { lat: 38.545, lng: -121.73 },
    ],
    distanceMeters: 1740,
    durationSeconds: 400,
    steps: [],
  };
  const longer: Route = {
    geometry: [
      { lat: 38.547, lng: -121.75 },
      { lat: 38.547, lng: -121.73 },
    ],
    distanceMeters: 1740 + 600,
    durationSeconds: 540,
    steps: [],
  };
  const poorVisibility: Hazard = {
    id: 'pv',
    category: 'poor_visibility',
    severity: 'moderate',
    description: null,
    location: { lat: 38.545, lng: -121.74 }, // on the shorter route
    photoUrl: null,
    thumbnailUrl: null,
    status: 'approved',
    confirmations: 0,
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: NOW + 30 * DAY,
  };

  function plan(at: number) {
    const isDark = isDarkAt(at, DAVIS_LAT, DAVIS_LNG);
    const ranked = rankRoutes([shorter, longer], [poorVisibility], {
      now: NOW,
      corridorMeters: 45,
      conditions: { isDark },
    });
    return { isDark, chosen: ranked[0].route };
  }

  it('by day keeps the shorter route (isDark=false)', () => {
    const { isDark, chosen } = plan(NOON);
    expect(isDark).toBe(false);
    expect(chosen).toBe(shorter);
  });

  it('at night diverts to the safer route and flags night weighting (isDark=true)', () => {
    const { isDark, chosen } = plan(MIDNIGHT);
    expect(isDark).toBe(true);
    expect(chosen).toBe(longer);
  });
});

// ------------------------------------------------------------------------------------
// A body the router cannot have meant.
//
// `fetchRoutes` documents itself as falling back "on any failure (no backend, network
// error, malformed body, no routes)". Until this suite existed, "malformed body" was
// only true of a body that failed to PARSE. A body that parsed, carried a geometry, and
// carried nothing else was returned as `source: 'osrm'` -- a router's answer -- with
// `distanceMeters` absent from the route and every step's distance defaulted to `0`.
//
// This matters past tidiness because `shared/routing.ts` ranks candidates on
// `cost: route.distanceMeters + penalty`:
//
//   * `undefined` makes the cost `NaN`, and every comparison against `NaN` is false, so
//     the "safest route" becomes whichever candidate happened to be first;
//   * the string `"1200"` makes `+` string CONCATENATION, so the routes are ranked by
//     text -- and `"1200" + 150` sorts above `"900" + 0`;
//   * a non-numeric coordinate makes every hazard-to-route distance `NaN`, every hazard
//     fall outside the corridor, and the plan report NO HAZARDS NEAR THIS ROUTE.
//
// The last of those is why these are refusals and not repairs. A false "clear route" is
// the one answer this product must never give.
// ------------------------------------------------------------------------------------

/** A well-formed single-route body, which each case below then breaks in one place. */
function goodBody() {
  return {
    code: 'Ok',
    routes: [
      {
        distance: 1200,
        duration: 300,
        geometry: {
          coordinates: [
            [-121.7405, 38.5449],
            [-121.7361, 38.5462],
          ],
        },
        legs: [{ steps: [{ distance: 1200, name: 'B St', maneuver: { type: 'depart', location: [-121.7405, 38.5449] } }] }],
      },
    ],
  };
}

async function planFrom(body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body } as Response);
  return fetchRoutes(FROM, TO, { routingUrl: 'https://router.test/route/v1/cycling' }, fetchMock as unknown as typeof fetch);
}

describe('fetchRoutes refuses a body it cannot read', () => {
  it('accepts the well-formed body this suite mutates, so the cases below mean something', async () => {
    const { routes, source } = await planFrom(goodBody());
    expect(source).toBe('osrm');
    expect(routes[0].distanceMeters).toBe(1200);
    expect(routes[0].steps[0].distanceMeters).toBe(1200);
  });

  const cases: [string, (b: ReturnType<typeof goodBody>) => void][] = [
    ['the route carries no distance', (b) => { delete (b.routes[0] as Record<string, unknown>).distance; }],
    ['the route carries no duration', (b) => { delete (b.routes[0] as Record<string, unknown>).duration; }],
    ['the distance is a string', (b) => { (b.routes[0] as Record<string, unknown>).distance = '1200'; }],
    ['the distance is NaN', (b) => { (b.routes[0] as Record<string, unknown>).distance = Number.NaN; }],
    ['the distance is infinite', (b) => { (b.routes[0] as Record<string, unknown>).distance = Number.POSITIVE_INFINITY; }],
    ['the distance is negative', (b) => { (b.routes[0] as Record<string, unknown>).distance = -5; }],
    ['a step carries no distance', (b) => { delete (b.routes[0].legs[0].steps[0] as Record<string, unknown>).distance; }],
    ['a step distance is a string', (b) => { (b.routes[0].legs[0].steps[0] as Record<string, unknown>).distance = 'lots'; }],
    ['a coordinate is a string', (b) => { (b.routes[0].geometry.coordinates[0] as unknown[])[1] = '38.5449'; }],
    ['a coordinate is NaN', (b) => { (b.routes[0].geometry.coordinates[0] as unknown[])[1] = Number.NaN; }],
    ['a latitude is off the globe', (b) => { (b.routes[0].geometry.coordinates[0] as unknown[])[1] = 91; }],
    ['a coordinate is not a pair', (b) => { (b.routes[0].geometry.coordinates as unknown[])[0] = [-121.7405]; }],
    ['the geometry has one point', (b) => { b.routes[0].geometry.coordinates = [[-121.7405, 38.5449]]; }],
  ];

  for (const [what, breakIt] of cases) {
    it(`falls back, rather than answering, when ${what}`, async () => {
      const body = goodBody();
      breakIt(body);
      const { routes, source } = await planFrom(body);
      expect(source).toBe('fallback');
      expect(routes).toHaveLength(1);
      // The fallback is a real straight line, not a shrug: it carries a measured
      // distance so nothing downstream inherits the hole that caused it.
      expect(routes[0].distanceMeters).toBeGreaterThan(0);
      expect(routes[0].durationSeconds).toBeGreaterThan(0);
      for (const step of routes[0].steps) {
        expect(typeof step.distanceMeters).toBe('number');
        expect(Number.isFinite(step.distanceMeters)).toBe(true);
      }
    });
  }

  it('keeps the good routes in a body where only one route is unusable', async () => {
    const body = goodBody();
    body.routes.push({
      distance: '900' as unknown as number,
      duration: 200,
      geometry: { coordinates: [[-121.7405, 38.5449], [-121.7361, 38.5462]] },
      legs: [{ steps: [] }],
    });
    const { routes, source } = await planFrom(body);
    expect(source).toBe('osrm');
    expect(routes).toHaveLength(1);
    expect(routes[0].distanceMeters).toBe(1200);
  });

  it('never invents a coordinate for a maneuver that has none', async () => {
    const body = goodBody();
    delete (body.routes[0].legs[0].steps[0].maneuver as Record<string, unknown>).location;
    const { routes, source } = await planFrom(body);
    expect(source).toBe('osrm');
    // The route's own start, which the geometry check guarantees exists -- and in
    // particular NOT { lat: 0, lng: 0 }, which is 9,000 km from the served place.
    expect(routes[0].steps[0].location).toEqual({ lat: 38.5449, lng: -121.7405 });
  });

  it('reports every distance it does return as a real number', async () => {
    const { routes } = await planFrom(goodBody());
    for (const route of routes) {
      expect(Number.isFinite(route.distanceMeters)).toBe(true);
      expect(Number.isFinite(route.durationSeconds)).toBe(true);
      for (const step of route.steps) expect(Number.isFinite(step.distanceMeters)).toBe(true);
    }
  });
});
