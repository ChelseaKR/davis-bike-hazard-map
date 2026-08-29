/**
 * Delta feed for the 30s mobile poll (FIX-05).
 *
 * Exercises GET /api/hazards?updatedSince=<cursor> end-to-end via app.inject()
 * against the in-memory store: a cursor returns only changed rows, deletions
 * surface as id-only tombstones (no content), and an over-old cursor falls back
 * to the full feed (no deletedIds ⇒ the client fully refreshes).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../server/app.ts';
import { MemoryRepository } from '../../server/lib/repository.ts';
import { MemoryModeratorStore } from '../../server/lib/moderators.ts';
import { hashPassword } from '../../server/lib/password.ts';
import { serverConfig } from '../../server/config.ts';
import type { StoredHazard } from '../../server/lib/types.ts';

const DAY = 24 * 60 * 60 * 1000;
const MIN = 60 * 1000;
const NOW = 1_700_000_000_000;

const testConfig = {
  ...serverConfig,
  isProd: false,
  isTest: true,
  gogovWebhookUrl: '',
  gogovApiKey: '',
  gogovStatusUrl: '',
  gogovWebhookSecret: '',
  routingUrl: '',
  sessionSecret: 'test-session-secret',
  sessionTtlMs: 12 * 60 * 60 * 1000,
  resolvedVisibleDays: 7,
  corsOrigins: [],
  serveClient: false,
  rateLimit: { max: 10_000, windowMs: 60_000, reportsPerHour: 10_000 },
  ttlDays: { low: 14, moderate: 21, high: 30 },
} as typeof serverConfig;

const MOD_USER = 'mod';
const MOD_PASS = 'correct horse battery staple';

let app: FastifyInstance;
let repo: MemoryRepository;
/** Bearer token for the seeded moderator, refreshed per test. */
let modToken: string;

/**
 * Reaches the protected tombstone map so a test can stamp an exact instant.
 * `deleteById` stamps from the wall clock, which no injected `now()` can pin,
 * and the cursor boundary has to be probed at the exact millisecond.
 */
class ProbeRepository extends MemoryRepository {
  stampTombstone(id: string, at: number): void {
    this.tombstones.set(id, at);
  }
}

function storedHazard(id: string, over: Partial<StoredHazard> = {}): StoredHazard {
  return {
    id,
    clientId: `cid-${id}`,
    category: 'pothole',
    severity: 'high',
    description: null,
    preciseLocation: { lat: 38.5449, lng: -121.7405 },
    publicLocation: { lat: 38.5449, lng: -121.7405 },
    photo: null,
    status: 'approved',
    source: 'report',
    confirmations: 0,
    createdAt: NOW - DAY,
    updatedAt: NOW - 10 * MIN,
    expiresAt: NOW + DAY,
    resolvedAt: null,
    handoff: null,
    moderation: [],
    ...over,
  };
}

async function getFeed(query: string) {
  const res = await app.inject({ method: 'GET', url: `/api/hazards${query}` });
  return res.json() as { hazards: { id: string }[]; deletedIds?: string[]; serverTime?: number };
}

beforeEach(async () => {
  repo = new MemoryRepository();
  const moderators = new MemoryModeratorStore();
  await moderators.upsert({
    username: MOD_USER,
    passwordHash: await hashPassword(MOD_PASS),
    createdAt: NOW,
    tokenVersion: 0,
  });
  app = await buildApp({ repo, moderators, config: testConfig, now: () => NOW, logger: false });
  await app.ready();
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { 'content-type': 'application/json' },
    payload: { username: MOD_USER, password: MOD_PASS },
  });
  modToken = (login.json() as { token: string }).token;
});

describe('GET /api/hazards delta feed', () => {
  it('full fetch (no cursor) returns every active hazard plus a serverTime cursor', async () => {
    await repo.insert(storedHazard('a'));
    await repo.insert(storedHazard('b'));

    const feed = await getFeed('');
    expect(feed.hazards.map((h) => h.id).sort()).toEqual(['a', 'b']);
    expect(feed.serverTime).toBe(NOW);
    // Full feed carries no tombstones — the client treats it as a full refresh.
    expect(feed.deletedIds).toBeUndefined();
  });

  it('returns only rows changed since the cursor', async () => {
    await repo.insert(storedHazard('old', { updatedAt: NOW - 20 * MIN }));
    await repo.insert(storedHazard('new', { updatedAt: NOW - 1 * MIN }));

    const feed = await getFeed(`?updatedSince=${NOW - 5 * MIN}`);
    expect(feed.hazards.map((h) => h.id)).toEqual(['new']);
    expect(feed.deletedIds).toEqual([]);
    expect(feed.serverTime).toBe(NOW);
  });

  it('surfaces a deletion as an id-only tombstone (no content)', async () => {
    await repo.insert(storedHazard('keep', { updatedAt: NOW - 1 * MIN }));
    await repo.insert(storedHazard('gone', { updatedAt: NOW - 20 * MIN }));

    const del = await app.inject({ method: 'DELETE', url: '/api/reports/cid-gone' });
    expect(del.statusCode).toBe(204);

    const feed = await getFeed(`?updatedSince=${NOW - 5 * MIN}`);
    // The removed id is reported as a bare string — never as a hazard object.
    expect(feed.deletedIds).toContain('gone');
    expect(feed.deletedIds!.every((id) => typeof id === 'string')).toBe(true);
    expect(feed.hazards.some((h) => h.id === 'gone')).toBe(false);
  });

  it('ignores an over-old cursor and returns the full feed (no deletedIds)', async () => {
    await repo.insert(storedHazard('a'));
    await repo.insert(storedHazard('b'));

    const feed = await getFeed(`?updatedSince=${NOW - 40 * DAY}`);
    expect(feed.hazards.map((h) => h.id).sort()).toEqual(['a', 'b']);
    expect(feed.deletedIds).toBeUndefined();
    expect(feed.serverTime).toBe(NOW);
  });
});

/**
 * The delta feed's whole reason to exist is that a phone on the 30s poll can
 * stay correct without refetching everything — which means every way a hazard
 * LEAVES the public feed has to arrive as an id in `deletedIds`. `mergeDelta`
 * (src/hooks/useHazards.ts) removes nothing else, and the cursor advances on
 * every poll, so a removal the delta omits is never corrected: the hazard stays
 * drawn on the map indefinitely. A hard delete is only one of four ways out.
 */
describe('GET /api/hazards delta feed reports removals, not just changes', () => {
  it('reports a TTL-expired hazard as a removal', async () => {
    await repo.insert(
      storedHazard('lapsed', { expiresAt: NOW - 1 * MIN, updatedAt: NOW - 20 * MIN }),
    );

    const feed = await getFeed(`?updatedSince=${NOW - 5 * MIN}`);

    // The handler sweeps expiry itself, so it performs this removal; it must
    // also report it. Silence here is a hazard drawn on a rider's map forever.
    expect(feed.deletedIds).toContain('lapsed');
    expect(feed.hazards.some((h) => h.id === 'lapsed')).toBe(false);
  });

  it('reports a moderator rejection as a removal', async () => {
    await repo.insert(storedHazard('spam', { status: 'pending', updatedAt: NOW - 20 * MIN }));

    const decided = await app.inject({
      method: 'POST',
      url: '/api/moderation/spam',
      headers: { authorization: `Bearer ${modToken}`, 'content-type': 'application/json' },
      payload: { decision: 'reject', reason: 'not a hazard' },
    });
    expect(decided.statusCode).toBe(200);
    expect((await repo.findById('spam'))?.status).toBe('rejected');

    const feed = await getFeed(`?updatedSince=${NOW - 5 * MIN}`);
    expect(feed.deletedIds).toContain('spam');
    expect(feed.hazards.some((h) => h.id === 'spam')).toBe(false);
  });

  it('reports a resolved hazard once its visible window runs out, and stops serving it', async () => {
    // resolvedVisibleDays is 7, so this one left the public feed three days ago
    // without anything writing to the row — nothing but the clock changed.
    await repo.insert(
      storedHazard('agedOut', {
        status: 'resolved',
        resolvedAt: NOW - 10 * DAY,
        updatedAt: NOW - 10 * DAY,
      }),
    );

    const full = await getFeed('');
    expect(full.hazards.some((h) => h.id === 'agedOut')).toBe(false);

    const feed = await getFeed(`?updatedSince=${NOW - 20 * DAY}`);
    expect(feed.deletedIds).toContain('agedOut');
    // The delta must not re-add what a fresh page load would not show.
    expect(feed.hazards.some((h) => h.id === 'agedOut')).toBe(false);
  });

  it('never names a hazard that is still on the map', async () => {
    await repo.insert(storedHazard('live', { updatedAt: NOW - 1 * MIN }));
    await repo.insert(
      storedHazard('justFixed', {
        status: 'resolved',
        resolvedAt: NOW - 1 * DAY,
        updatedAt: NOW - 1 * DAY,
      }),
    );

    const feed = await getFeed(`?updatedSince=${NOW - 5 * MIN}`);

    // Guards the opposite failure: a "removal" list that simply names everything
    // would satisfy the tests above and blank the map.
    expect(feed.deletedIds).not.toContain('live');
    expect(feed.deletedIds).not.toContain('justFixed');
    expect(feed.hazards.map((h) => h.id)).toContain('live');
  });

  it('never names a pending report, which the public feed has never carried', async () => {
    await repo.insert(storedHazard('unmoderated', { status: 'pending', updatedAt: NOW - 1 * MIN }));

    const feed = await getFeed(`?updatedSince=${NOW - 5 * MIN}`);

    // Naming it would leak the id of every unmoderated report to any poller.
    expect(feed.deletedIds).not.toContain('unmoderated');
    expect(feed.hazards.some((h) => h.id === 'unmoderated')).toBe(false);
  });

  it('reports an approved row past its TTL even if the expiry sweep has not run', async () => {
    // The route sweeps before it reads, so this branch is only reachable at the
    // store. Asserting it here keeps the removal set the exact complement of
    // the public feed rather than a side effect of one caller's ordering.
    const store = new MemoryRepository();
    await store.insert(storedHazard('unswept', { expiresAt: NOW - 1 * MIN }));

    const removed = await store.listRemovedSince(NOW - 5 * MIN, NOW, 7 * DAY);

    expect(removed).toContain('unswept');
    expect((await store.findById('unswept'))?.status).toBe('approved');
  });
});

/**
 * Boundary and scope coverage for the delta itself. The cursor comparison, the
 * bbox cull and the recently-resolved half of the feed each decide what a
 * client is told; none of them had a test that could tell right from wrong.
 */
describe('GET /api/hazards delta feed cursor, bbox and resolved coverage', () => {
  it('includes a row whose updatedAt equals the cursor exactly', async () => {
    const cursor = NOW - 5 * MIN;
    await repo.insert(storedHazard('onTheBoundary', { updatedAt: cursor }));

    const feed = await getFeed(`?updatedSince=${cursor}`);

    // The cursor is inclusive: the client seeds it from `serverTime`, so an
    // exclusive comparison drops every change made in that same millisecond.
    expect(feed.hazards.map((h) => h.id)).toContain('onTheBoundary');
  });

  it('culls delta rows outside the requested bbox', async () => {
    await repo.insert(storedHazard('inside', { updatedAt: NOW - 1 * MIN }));
    await repo.insert(
      storedHazard('outside', {
        updatedAt: NOW - 1 * MIN,
        publicLocation: { lat: 40.0, lng: -120.0 },
        preciseLocation: { lat: 40.0, lng: -120.0 },
      }),
    );

    const feed = await getFeed(`?updatedSince=${NOW - 5 * MIN}&bbox=38.5,-121.8,38.6,-121.7`);

    expect(feed.hazards.map((h) => h.id)).toEqual(['inside']);
  });

  it('carries a recently-resolved hazard as a changed row so a fix stays visible', async () => {
    await repo.insert(
      storedHazard('fixed', {
        status: 'resolved',
        resolvedAt: NOW - 1 * MIN,
        updatedAt: NOW - 1 * MIN,
      }),
    );

    const feed = await getFeed(`?updatedSince=${NOW - 5 * MIN}`);

    // Inside resolvedVisibleDays a fix is shown greyed, not removed.
    expect(feed.hazards.map((h) => h.id)).toContain('fixed');
    expect(feed.deletedIds).not.toContain('fixed');
  });
});

describe('delta tombstones', () => {
  it('includes a tombstone stamped exactly at the cursor', async () => {
    const store = new ProbeRepository();
    store.stampTombstone('erased', NOW - 5 * MIN);

    // Inclusive on both sides, or a deletion in the cursor's own millisecond
    // is lost with nothing to correct it.
    expect(await store.listTombstones(NOW - 5 * MIN)).toContain('erased');
    expect(await store.listTombstones(NOW - 5 * MIN + 1)).not.toContain('erased');
  });

  it('stamps a deletion at the instant it happens', async () => {
    await repo.insert(storedHazard('erasable'));

    const before = Date.now();
    const del = await app.inject({ method: 'DELETE', url: '/api/reports/cid-erasable' });
    expect(del.statusCode).toBe(204);
    const after = Date.now();

    // Pins the stamp inside the call. A stamp shifted into the past falls out
    // of a live client's cursor window (and gets pruned early); one shifted
    // into the future is reported forever.
    expect(await repo.listTombstones(before)).toContain('erasable');
    expect(await repo.listTombstones(after + 1)).not.toContain('erasable');
  });
});
