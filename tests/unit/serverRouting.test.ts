import { describe, it, expect, vi } from 'vitest';
import { describeStep, fallbackRoute, fetchRoutes } from '../../server/lib/routing.ts';
import { isDarkAt, rankRoutes, DAVIS_LAT, DAVIS_LNG, type Route } from '../../shared/routing.ts';
import type { Hazard } from '../../shared/types.ts';

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
    clientId: 'c',
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
