import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  hazardMatchesWatch,
  matchingSubscriptions,
  type AlertSubscription,
  type Watch,
} from '../../shared/alerts.ts';
import { simplifyRoute } from '../../shared/simplify.ts';
import { distanceToRouteMeters } from '../../shared/routing.ts';
import {
  buildSubscription,
  subscriptionId,
  MemorySubscriptionStore,
  SUBSCRIPTION_TTL_MS,
  WATCH_GEOMETRY_TOLERANCE_METERS,
} from '../../server/lib/subscriptions.ts';
import {
  notifyForHazard,
  isConfigured,
  buildAlertPayload,
  createWebPushSender,
  PushSubscriptionGoneError,
  type PushConfig,
} from '../../server/lib/pushNotify.ts';
import type { GeoPoint, Hazard } from '../../shared/types.ts';

// The real transport is exercised against a mocked `web-push` module (the
// encrypted-payload wire protocol itself is the library's responsibility).
const webPushMock = vi.hoisted(() => ({
  setVapidDetails: vi.fn(),
  sendNotification: vi.fn(),
}));
vi.mock('web-push', () => ({ default: webPushMock }));

const CAMPUS = { lat: 38.5421, lng: -121.7494 };
const DOWNTOWN = { lat: 38.5447, lng: -121.7405 };
/** Far-future expiry for fixtures that aren't about TTL. */
const FOREVER = 9e15;

function hazard(loc = DOWNTOWN, over: Partial<Hazard> = {}): Hazard {
  return {
    id: 'h1',
    category: 'pothole',
    severity: 'high',
    description: null,
    location: loc,
    photoUrl: null,
    thumbnailUrl: null,
    status: 'approved',
    confirmations: 0,
    createdAt: 1,
    updatedAt: 1,
    expiresAt: 9e15,
    ...over,
  };
}

const area: Watch = { kind: 'area', minLat: 38.54, minLng: -121.745, maxLat: 38.55, maxLng: -121.735 };
const route: Watch = { kind: 'route', corridorMeters: 40, geometry: [CAMPUS, DOWNTOWN] };

describe('hazardMatchesWatch', () => {
  it('matches an area watch containing the point', () => {
    expect(hazardMatchesWatch(DOWNTOWN, area)).toBe(true);
    expect(hazardMatchesWatch(CAMPUS, area)).toBe(false); // campus lng < minLng
  });

  it('matches a route watch within the corridor', () => {
    expect(hazardMatchesWatch(DOWNTOWN, route)).toBe(true); // an endpoint is on the line
    expect(hazardMatchesWatch({ lat: 38.56, lng: -121.74 }, route)).toBe(false); // ~1.7 km off
  });
});

describe('matchingSubscriptions', () => {
  const subs: AlertSubscription[] = [
    { id: 'a', endpoint: 'https://push/a', keys: { p256dh: 'p', auth: 'x' }, watch: area, createdAt: 1, expiresAt: FOREVER },
    { id: 'r', endpoint: 'https://push/r', keys: { p256dh: 'p', auth: 'x' }, watch: route, createdAt: 1, expiresAt: FOREVER },
    {
      id: 'far',
      endpoint: 'https://push/far',
      keys: { p256dh: 'p', auth: 'x' },
      watch: { kind: 'area', minLat: 40, minLng: -120, maxLat: 41, maxLng: -119 },
      createdAt: 1,
      expiresAt: FOREVER,
    },
  ];
  it('returns only the watches that contain the hazard', () => {
    expect(matchingSubscriptions(DOWNTOWN, subs).map((s) => s.id).sort()).toEqual(['a', 'r']);
  });
});

describe('subscriptions store', () => {
  it('derives a stable id and upserts by it (no duplicates)', async () => {
    const store = new MemorySubscriptionStore();
    const s1 = buildSubscription('https://push/x', { p256dh: 'p', auth: 'a' }, area, 100, 'home');
    expect(s1.id).toBe(subscriptionId('https://push/x'));
    await store.upsert(s1);
    await store.upsert(buildSubscription('https://push/x', { p256dh: 'p2', auth: 'a2' }, route, 200));
    expect(await store.all()).toHaveLength(1); // same endpoint ⇒ replaced
    expect(await store.remove(s1.id)).toBe(true);
    expect(await store.all()).toHaveLength(0);
  });
});

// --- FIX-10: geometry minimization -----------------------------------------

const METERS_PER_DEG_LAT = 111_320;
const REF_LAT = 38.545;
const metersPerDegLng = METERS_PER_DEG_LAT * Math.cos((REF_LAT * Math.PI) / 180);

/**
 * A north–south route (~1.1 km) with a small sinusoidal east–west wiggle of
 * `amplitudeMeters` — a stand-in for GPS-trace noise on a straight street.
 */
function wigglyRoute(points = 51, amplitudeMeters = 15): GeoPoint[] {
  const out: GeoPoint[] = [];
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    out.push({
      lat: 38.54 + 0.01 * t,
      lng: -121.74 + (amplitudeMeters * Math.sin(t * Math.PI * 6)) / metersPerDegLng,
    });
  }
  return out;
}

/** A point `offsetMeters` east of the wiggly route's base line, at fraction t. */
function eastOfLine(t: number, offsetMeters: number): GeoPoint {
  return { lat: 38.54 + 0.01 * t, lng: -121.74 + offsetMeters / metersPerDegLng };
}

describe('simplifyRoute (Douglas–Peucker, FIX-10 minimization)', () => {
  const original = wigglyRoute();
  const simplified = simplifyRoute(original, WATCH_GEOMETRY_TOLERANCE_METERS);

  it('drops sub-tolerance wiggle but keeps the endpoints', () => {
    expect(simplified.length).toBeLessThan(original.length);
    expect(simplified.length).toBeGreaterThanOrEqual(2);
    expect(simplified[0]).toEqual(original[0]);
    expect(simplified[simplified.length - 1]).toEqual(original[original.length - 1]);
  });

  it('never deviates more than the tolerance from the original points', () => {
    for (const p of original) {
      expect(distanceToRouteMeters(p, simplified)).toBeLessThanOrEqual(
        WATCH_GEOMETRY_TOLERANCE_METERS + 1e-6,
      );
    }
  });

  it('keeps a genuine corner (deviation far above tolerance)', () => {
    const corner: GeoPoint[] = [
      { lat: 38.54, lng: -121.75 },
      { lat: 38.55, lng: -121.75 }, // ~550 m off the direct chord
      { lat: 38.55, lng: -121.74 },
    ];
    expect(simplifyRoute(corner, WATCH_GEOMETRY_TOLERANCE_METERS)).toEqual(corner);
  });

  it('returns short polylines unchanged (copy, not the same array)', () => {
    const two: GeoPoint[] = [CAMPUS, DOWNTOWN];
    const out = simplifyRoute(two, 35);
    expect(out).toEqual(two);
    expect(out).not.toBe(two);
  });

  it('corridor matching is unchanged by simplification (match-equivalence)', () => {
    const corridorMeters = 100;
    const before: Watch = { kind: 'route', corridorMeters, geometry: original };
    const after: Watch = { kind: 'route', corridorMeters, geometry: simplified };
    // Sample points clearly inside / clearly outside the corridor (margin from
    // the corridor edge exceeds the simplification tolerance, so both answers
    // must agree — no edge-band ambiguity).
    const samples: Array<{ p: GeoPoint; inside: boolean }> = [
      { p: eastOfLine(0.1, 0), inside: true }, // on the base line
      { p: eastOfLine(0.5, 0), inside: true },
      { p: eastOfLine(0.9, 0), inside: true },
      { p: eastOfLine(0.25, 50), inside: true }, // well inside the corridor
      { p: eastOfLine(0.75, -50), inside: true },
      { p: eastOfLine(0.25, 300), inside: false }, // well outside
      { p: eastOfLine(0.75, -300), inside: false },
      { p: { lat: 38.56, lng: -121.74 }, inside: false }, // past the north end
    ];
    for (const { p, inside } of samples) {
      expect(hazardMatchesWatch(p, before)).toBe(inside);
      expect(hazardMatchesWatch(p, after)).toBe(inside);
    }
  });

  it('buildSubscription stores route geometry simplified, corridor unchanged', () => {
    const dense: Watch = { kind: 'route', corridorMeters: 100, geometry: wigglyRoute() };
    const sub = buildSubscription('https://push/route', { p256dh: 'p', auth: 'a' }, dense, 1_000);
    expect(sub.watch.kind).toBe('route');
    if (sub.watch.kind !== 'route') throw new Error('unreachable');
    expect(sub.watch.geometry.length).toBeLessThan(dense.geometry.length);
    expect(sub.watch.corridorMeters).toBe(100);
    // The caller's watch object is not mutated.
    expect(dense.geometry).toHaveLength(51);
  });

  it('buildSubscription stores area watches verbatim', () => {
    const sub = buildSubscription('https://push/area', { p256dh: 'p', auth: 'a' }, area, 1_000);
    expect(sub.watch).toEqual(area);
  });
});

// --- FIX-10: TTL + renewal ---------------------------------------------------

describe('subscription TTL (180 days, renew on re-subscribe)', () => {
  it('buildSubscription stamps expiresAt = createdAt + TTL', () => {
    const sub = buildSubscription('https://push/x', { p256dh: 'p', auth: 'a' }, area, 1_000);
    expect(sub.createdAt).toBe(1_000);
    expect(sub.expiresAt).toBe(1_000 + SUBSCRIPTION_TTL_MS);
    expect(SUBSCRIPTION_TTL_MS).toBe(180 * 24 * 60 * 60 * 1000);
  });

  it('prune removes expired subscriptions and leaves live ones matchable', async () => {
    const store = new MemorySubscriptionStore();
    const expired = buildSubscription('https://push/old', { p256dh: 'p', auth: 'a' }, area, 0);
    const live = buildSubscription('https://push/new', { p256dh: 'p', auth: 'a' }, area, 1_000);
    await store.upsert(expired);
    await store.upsert(live);

    const now = SUBSCRIPTION_TTL_MS + 500; // old one lapsed; new one still live
    expect(await store.prune(now)).toBe(1);
    const remaining = await store.all();
    expect(remaining.map((s) => s.id)).toEqual([live.id]);
    // The notify path prunes then matches: an expired watch can never fire.
    expect(matchingSubscriptions(DOWNTOWN, remaining).map((s) => s.id)).toEqual([live.id]);
    // Pruning is idempotent and the expired id is really gone.
    expect(await store.prune(now)).toBe(0);
    expect(await store.remove(expired.id)).toBe(false);
  });

  it('re-subscribing (upsert by deterministic id) refreshes expiresAt', async () => {
    const store = new MemorySubscriptionStore();
    await store.upsert(buildSubscription('https://push/x', { p256dh: 'p', auth: 'a' }, area, 100));
    await store.upsert(buildSubscription('https://push/x', { p256dh: 'p', auth: 'a' }, area, 9_999));
    const all = await store.all();
    expect(all).toHaveLength(1); // renewal, not a duplicate
    expect(all[0].expiresAt).toBe(9_999 + SUBSCRIPTION_TTL_MS);
  });
});

describe('notifyForHazard', () => {
  const dryConfig: PushConfig = { enabled: false, vapidPublicKey: '', vapidPrivateKey: '', subject: '' };
  const liveConfig: PushConfig = {
    enabled: true,
    vapidPublicKey: 'pub',
    vapidPrivateKey: 'priv',
    subject: 'mailto:a@b.c',
  };
  const subs: AlertSubscription[] = [
    { id: 'a', endpoint: 'https://push/a', keys: { p256dh: 'p', auth: 'x' }, watch: area, createdAt: 1, expiresAt: FOREVER },
  ];

  it('isConfigured reflects enabled + VAPID presence', () => {
    expect(isConfigured(dryConfig)).toBe(false);
    expect(isConfigured(liveConfig)).toBe(true);
    expect(isConfigured({ ...liveConfig, vapidPrivateKey: '' })).toBe(false);
  });

  it('dry-runs (computes matches, sends nothing) when not configured', async () => {
    const res = await notifyForHazard(hazard(), subs, dryConfig);
    expect(res.matched).toBe(1);
    expect(res.sent).toBe(0);
    expect(res.dryRun).toBe(true);
    expect(res.payload?.hazardId).toBe('h1');
  });

  it('reports no matches without a payload', async () => {
    const res = await notifyForHazard(hazard({ lat: 38.6, lng: -121.6 }), subs, dryConfig);
    expect(res.matched).toBe(0);
    expect(res.payload).toBeNull();
  });

  it('sends via the injected sender when configured', async () => {
    const send = vi.fn().mockResolvedValue(true);
    const res = await notifyForHazard(hazard(), subs, liveConfig, send);
    expect(res.dryRun).toBe(false);
    expect(res.sent).toBe(1);
    expect(send).toHaveBeenCalledOnce();
  });

  it('keeps going when one send throws (best-effort)', async () => {
    const two = [...subs, { ...subs[0], id: 'b', endpoint: 'https://push/b' }];
    const send = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(true);
    const res = await notifyForHazard(hazard(), two, liveConfig, send);
    expect(res.matched).toBe(2);
    expect(res.sent).toBe(1);
    expect(res.dead).toEqual([]); // a transient failure is NOT a prune signal
  });

  it('collects gone subscriptions (404/410) for pruning and keeps sending', async () => {
    const two = [...subs, { ...subs[0], id: 'b', endpoint: 'https://push/b' }];
    const send = vi
      .fn()
      .mockRejectedValueOnce(new PushSubscriptionGoneError(410))
      .mockResolvedValueOnce(true);
    const res = await notifyForHazard(hazard(), two, liveConfig, send);
    expect(res.sent).toBe(1);
    expect(res.dead).toEqual(['a']); // the 410 endpoint, by subscription id
  });

  it('uses the no-op sender by default (configured but nothing wired ⇒ sent 0)', async () => {
    const res = await notifyForHazard(hazard(), subs, liveConfig);
    expect(res.dryRun).toBe(false);
    expect(res.matched).toBe(1);
    expect(res.sent).toBe(0); // default sender is a stub until web-push is wired
  });

  it('buildAlertPayload describes the hazard (with a severity tag)', () => {
    const p = buildAlertPayload(hazard());
    expect(p.title).toMatch(/saved route/i);
    expect(p.body).toMatch(/high pothole/i);
    expect(p.tag).toBe('hazard-high');
  });
});

describe('createWebPushSender (real transport, mocked web-push)', () => {
  const config: PushConfig = {
    enabled: true,
    vapidPublicKey: 'pub',
    vapidPrivateKey: 'priv',
    subject: 'mailto:a@b.c',
  };
  const sub: AlertSubscription = {
    id: 'a',
    endpoint: 'https://push/a',
    keys: { p256dh: 'p', auth: 'x' },
    watch: area,
    createdAt: 1,
    expiresAt: Number.MAX_SAFE_INTEGER,
  };
  const payload = buildAlertPayload(hazard());

  beforeEach(() => {
    webPushMock.setVapidDetails.mockClear();
    webPushMock.sendNotification.mockReset();
  });

  it('sets VAPID details once and sends the JSON payload', async () => {
    webPushMock.sendNotification.mockResolvedValue({ statusCode: 201 });
    const send = createWebPushSender();
    expect(await send(sub, payload, config)).toBe(true);
    expect(await send(sub, payload, config)).toBe(true);
    expect(webPushMock.setVapidDetails).toHaveBeenCalledTimes(1); // lazy, once
    expect(webPushMock.setVapidDetails).toHaveBeenCalledWith('mailto:a@b.c', 'pub', 'priv');
    expect(webPushMock.sendNotification).toHaveBeenCalledWith(
      { endpoint: sub.endpoint, keys: sub.keys },
      JSON.stringify(payload),
      { TTL: 60 * 60 },
    );
  });

  it('maps a 410 (and 404) response to PushSubscriptionGoneError', async () => {
    webPushMock.sendNotification.mockRejectedValue(
      Object.assign(new Error('subscription gone'), { statusCode: 410 }),
    );
    const send = createWebPushSender();
    await expect(send(sub, payload, config)).rejects.toBeInstanceOf(PushSubscriptionGoneError);

    webPushMock.sendNotification.mockRejectedValue(
      Object.assign(new Error('not found'), { statusCode: 404 }),
    );
    await expect(send(sub, payload, config)).rejects.toBeInstanceOf(PushSubscriptionGoneError);
  });

  it('rethrows other transport errors untouched (best-effort upstream)', async () => {
    webPushMock.sendNotification.mockRejectedValue(
      Object.assign(new Error('push service 5xx'), { statusCode: 502 }),
    );
    const send = createWebPushSender();
    await expect(send(sub, payload, config)).rejects.toThrow('push service 5xx');
  });
});
