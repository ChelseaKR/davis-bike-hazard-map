import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  hazardMatchesWatch,
  matchingSubscriptions,
  type AlertSubscription,
  type Watch,
} from '../../shared/alerts.ts';
import {
  buildSubscription,
  subscriptionId,
  MemorySubscriptionStore,
} from '../../server/lib/subscriptions.ts';
import {
  notifyForHazard,
  isConfigured,
  buildAlertPayload,
  createWebPushSender,
  PushSubscriptionGoneError,
  type PushConfig,
} from '../../server/lib/pushNotify.ts';
import type { Hazard } from '../../shared/types.ts';

// The real transport is exercised against a mocked `web-push` module (the
// encrypted-payload wire protocol itself is the library's responsibility).
const webPushMock = vi.hoisted(() => ({
  setVapidDetails: vi.fn(),
  sendNotification: vi.fn(),
}));
vi.mock('web-push', () => ({ default: webPushMock }));

const CAMPUS = { lat: 38.5421, lng: -121.7494 };
const DOWNTOWN = { lat: 38.5447, lng: -121.7405 };

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
    { id: 'a', endpoint: 'https://push/a', keys: { p256dh: 'p', auth: 'x' }, watch: area, createdAt: 1 },
    { id: 'r', endpoint: 'https://push/r', keys: { p256dh: 'p', auth: 'x' }, watch: route, createdAt: 1 },
    {
      id: 'far',
      endpoint: 'https://push/far',
      keys: { p256dh: 'p', auth: 'x' },
      watch: { kind: 'area', minLat: 40, minLng: -120, maxLat: 41, maxLng: -119 },
      createdAt: 1,
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

describe('notifyForHazard', () => {
  const dryConfig: PushConfig = { enabled: false, vapidPublicKey: '', vapidPrivateKey: '', subject: '' };
  const liveConfig: PushConfig = {
    enabled: true,
    vapidPublicKey: 'pub',
    vapidPrivateKey: 'priv',
    subject: 'mailto:a@b.c',
  };
  const subs: AlertSubscription[] = [
    { id: 'a', endpoint: 'https://push/a', keys: { p256dh: 'p', auth: 'x' }, watch: area, createdAt: 1 },
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
