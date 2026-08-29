/**
 * Integration tests for the Postgres store. They run only when
 * TEST_DATABASE_URL points at a reachable Postgres (CI provides one via the
 * docker-compose service); otherwise the suite is skipped so unit runs without
 * a database stay green.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgresRepository } from '../../server/lib/pgRepository.ts';
import { MemoryRepository, TOMBSTONE_TTL_MS } from '../../server/lib/repository.ts';
import { createModeratorStore, type ModeratorStore } from '../../server/lib/moderators.ts';
import {
  createSubscriptionStore,
  buildSubscription,
  type SubscriptionStore,
} from '../../server/lib/subscriptions.ts';
import type { Watch } from '../../shared/alerts.ts';
import type { StoredHazard } from '../../server/lib/types.ts';

const URL = process.env.TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;


function hazard(over: Partial<StoredHazard> = {}): StoredHazard {
  return {
    id: 'h1',
    clientId: 'c1',
    category: 'pothole',
    severity: 'high',
    description: 'Deep pothole',
    preciseLocation: { lat: 38.5462, lng: -121.7361 },
    publicLocation: { lat: 38.5455, lng: -121.7355 },
    photo: { mime: 'image/jpeg' },
    status: 'pending',
    confirmations: 0,
    createdAt: 1000,
    updatedAt: 1000,
    expiresAt: 9_999_999_999_999,
    resolvedAt: null,
    handoff: null,
    handoffDelivery: null,
    moderation: [],
    source: 'report',
    ...over,
  };
}

suite('PostgresRepository', () => {
  let repo: PostgresRepository;

  beforeAll(async () => {
    repo = new PostgresRepository(URL!);
    await repo.init();
    // Idempotent init must not throw on a second run.
    await repo.init();
  });

  afterAll(async () => {
    await repo.close();
  });

  beforeEach(async () => {
    // Clean slate between tests.
    await repo['pool'].query('TRUNCATE hazards');
  });

  it('round-trips a record including the photo ref and moderation jsonb', async () => {
    await repo.insert(
      hazard({ moderation: [{ decision: 'approve', at: 1234, by: 'alice' }] }),
    );
    const got = await repo.findById('h1');
    expect(got).toEqual(
      hazard({ moderation: [{ decision: 'approve', at: 1234, by: 'alice' }] }),
    );
  });

  it('finds by client id and returns undefined for misses', async () => {
    await repo.insert(hazard({ id: 'h1', clientId: 'cabc' }));
    expect((await repo.findByClientId('cabc'))?.id).toBe('h1');
    expect(await repo.findByClientId('nope')).toBeUndefined();
    expect(await repo.findById('nope')).toBeUndefined();
  });

  it('merges a partial update transactionally', async () => {
    await repo.insert(hazard({ status: 'pending', confirmations: 0 }));
    const updated = await repo.update('h1', { status: 'approved', confirmations: 3 });
    expect(updated?.status).toBe('approved');
    expect(updated?.confirmations).toBe(3);
    // Untouched fields survive the merge.
    expect(updated?.description).toBe('Deep pothole');
    expect(await repo.update('missing', { confirmations: 1 })).toBeUndefined();
  });

  it('round-trips `source` (issue #111) and defaults it via the column DEFAULT for pre-migration rows', async () => {
    await repo.insert(hazard({ id: 'seed-h', clientId: 'seed-c', source: 'seed' }));
    await repo.insert(hazard({ id: 'report-h', clientId: 'report-c', source: 'report' }));
    expect((await repo.findById('seed-h'))?.source).toBe('seed');
    expect((await repo.findById('report-h'))?.source).toBe('report');

    // Simulate a row written before migrations/0008_hazard_source.sql existed:
    // insert bypassing the app's `source` column entirely and rely on the
    // column's own `DEFAULT 'report'` (exactly what the migration gives every
    // pre-existing hazard on a live deploy).
    await repo['pool'].query(
      `INSERT INTO hazards (id, client_id, category, severity, description,
         precise_lat, precise_lng, public_lat, public_lng, status,
         confirmations, created_at, updated_at, expires_at, moderation)
       VALUES ('legacy-h','legacy-c','pothole','high',NULL,38.54,-121.74,38.54,-121.74,
         'approved',0,1000,1000,9999999999999,'[]'::jsonb)`,
    );
    expect((await repo.findById('legacy-h'))?.source).toBe('report');
  });

  it('listActive filters by status, expiry, and bounding box, newest first', async () => {
    const now = 5000;
    await repo.insert(hazard({ id: 'a', clientId: 'a', status: 'approved', updatedAt: 10, expiresAt: now + 1, publicLocation: { lat: 38.54, lng: -121.74 } }));
    await repo.insert(hazard({ id: 'b', clientId: 'b', status: 'approved', updatedAt: 20, expiresAt: now + 1, publicLocation: { lat: 38.55, lng: -121.73 } }));
    await repo.insert(hazard({ id: 'pending', clientId: 'p', status: 'pending', updatedAt: 30, expiresAt: now + 1 }));
    await repo.insert(hazard({ id: 'expired', clientId: 'e', status: 'approved', updatedAt: 40, expiresAt: now - 1 }));
    await repo.insert(hazard({ id: 'faraway', clientId: 'f', status: 'approved', updatedAt: 50, expiresAt: now + 1, publicLocation: { lat: 40.0, lng: -120.0 } }));

    const all = await repo.listActive(now);
    expect(all.map((h) => h.id)).toEqual(['faraway', 'b', 'a']); // updatedAt desc; pending+expired excluded

    const inBox = await repo.listActive(now, { minLat: 38.5, minLng: -121.8, maxLat: 38.6, maxLng: -121.7 });
    expect(inBox.map((h) => h.id)).toEqual(['b', 'a']); // faraway culled
  });

  it('round-trips the hand-off jsonb and resolvedAt', async () => {
    await repo.insert(
      hazard({
        id: 'ho',
        clientId: 'ho',
        status: 'resolved',
        resolvedAt: 4242,
        handoff: {
          provider: 'gogov',
          reference: 'ho',
          externalStatus: 'Closed - Resolved',
          stage: 'resolved',
          submittedAt: 100,
          updatedAt: 200,
          note: null,
        },
      }),
    );
    const got = (await repo.findById('ho'))!;
    expect(got.resolvedAt).toBe(4242);
    expect(got.handoff?.stage).toBe('resolved');
    expect(got.handoff?.reference).toBe('ho');
  });

  it('listRecentlyResolved returns only resolved rows within the window, newest first', async () => {
    await repo.insert(hazard({ id: 'r-old', clientId: 'r-old', status: 'resolved', resolvedAt: 1000, publicLocation: { lat: 38.54, lng: -121.74 } }));
    await repo.insert(hazard({ id: 'r-new', clientId: 'r-new', status: 'resolved', resolvedAt: 3000, publicLocation: { lat: 38.55, lng: -121.73 } }));
    await repo.insert(hazard({ id: 'approved', clientId: 'ap', status: 'approved' }));
    await repo.insert(hazard({ id: 'r-far', clientId: 'r-far', status: 'resolved', resolvedAt: 2500, publicLocation: { lat: 40.0, lng: -120.0 } }));

    const recent = await repo.listRecentlyResolved(2000);
    expect(recent.map((h) => h.id)).toEqual(['r-new', 'r-far']); // r-old before the window; approved excluded

    const inBox = await repo.listRecentlyResolved(0, { minLat: 38.5, minLng: -121.8, maxLat: 38.6, maxLng: -121.7 });
    expect(inBox.map((h) => h.id)).toEqual(['r-new', 'r-old']); // r-far culled; resolved_at desc
  });

  it('listRecentlyResolved breaks same-millisecond resolved_at ties by insertion order', async () => {
    // All three ties share one resolved_at, so only the insert_seq tiebreak
    // can order them — bare ORDER BY resolved_at DESC leaves Postgres free to
    // return ties in any order, unlike the in-memory store's stable sort.
    await repo.insert(hazard({ id: 'tie-a', clientId: 'ta', status: 'resolved', resolvedAt: 7000 }));
    await repo.insert(hazard({ id: 'tie-b', clientId: 'tb', status: 'resolved', resolvedAt: 7000 }));
    await repo.insert(hazard({ id: 'tie-c', clientId: 'tc', status: 'resolved', resolvedAt: 7000 }));
    await repo.insert(hazard({ id: 'newer', clientId: 'n', status: 'resolved', resolvedAt: 8000 }));

    const got = await repo.listRecentlyResolved(0);
    // Newest resolved_at first; ties come back earliest-insert-first, matching
    // the in-memory store's insertion-order tiebreak.
    expect(got.map((h) => h.id)).toEqual(['newer', 'tie-a', 'tie-b', 'tie-c']);
  });

  it('pings the database for readiness', async () => {
    expect(await repo.ping()).toBe(true);
  });

  it('records applied migrations and is idempotent', async () => {
    const pool = (repo as unknown as { pool: import('pg').Pool }).pool;
    const { rows } = await pool.query<{ version: string }>(
      'SELECT version FROM schema_migrations ORDER BY version',
    );
    expect(rows.map((r) => r.version)).toContain('0001_init');
    const { runMigrations } = await import('../../server/lib/migrate.ts');
    expect(await runMigrations(pool)).toEqual([]); // nothing new to apply
  });

  it('reports pending-queue stats (count + oldest createdAt)', async () => {
    expect(await repo.pendingStats()).toEqual({ count: 0, oldestCreatedAt: null });
    await repo.insert(hazard({ id: 'p1', clientId: 'p1', status: 'pending', createdAt: 200 }));
    await repo.insert(hazard({ id: 'p2', clientId: 'p2', status: 'pending', createdAt: 100 }));
    await repo.insert(hazard({ id: 'a1', clientId: 'a1', status: 'approved', createdAt: 50 }));
    expect(await repo.pendingStats()).toEqual({ count: 2, oldestCreatedAt: 100 });
  });

  it('listPending pages the backlog oldest-first with a keyset cursor (FIX-04)', async () => {
    // Two rows share createdAt so the (created_at, id) tiebreak is exercised.
    await repo.insert(hazard({ id: 'pa', clientId: 'pa', status: 'pending', createdAt: 100 }));
    await repo.insert(hazard({ id: 'pb', clientId: 'pb', status: 'pending', createdAt: 100 }));
    await repo.insert(hazard({ id: 'pc', clientId: 'pc', status: 'pending', createdAt: 300 }));
    await repo.insert(hazard({ id: 'x1', clientId: 'x1', status: 'approved', createdAt: 50 }));

    const page1 = await repo.listPending({ limit: 2 });
    expect(page1.hazards.map((h) => h.id)).toEqual(['pa', 'pb']);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await repo.listPending({ limit: 2, cursor: page1.nextCursor! });
    expect(page2.hazards.map((h) => h.id)).toEqual(['pc']);
    expect(page2.nextCursor).toBeNull();
  });

  it('listPending returns no cursor when the page is exactly the backlog', async () => {
    await repo.insert(hazard({ id: 'p1', clientId: 'p1', status: 'pending', createdAt: 100 }));
    const page = await repo.listPending({ limit: 1 });
    expect(page.hazards.map((h) => h.id)).toEqual(['p1']);
    expect(page.nextCursor).toBeNull();
  });

  it('round-trips the hand-off delivery receipt and lists retry-due + failed rows (R3)', async () => {
    const retrying = {
      state: 'retrying' as const,
      dryRun: false,
      attempts: 2,
      lastAttemptAt: 900,
      nextRetryAt: 1000,
      lastError: '311 responded 502',
    };
    const failed = { ...retrying, state: 'failed' as const, attempts: 6, nextRetryAt: null };
    await repo.insert(hazard({ id: 'r1', clientId: 'r1', handoffDelivery: retrying }));
    await repo.insert(
      hazard({
        id: 'r2',
        clientId: 'r2',
        handoffDelivery: { ...retrying, nextRetryAt: 5000 },
      }),
    );
    await repo.insert(hazard({ id: 'f1', clientId: 'f1', handoffDelivery: failed }));
    await repo.insert(hazard({ id: 'none', clientId: 'none' }));

    expect((await repo.findById('r1'))?.handoffDelivery).toEqual(retrying);
    expect((await repo.listHandoffRetryDue(1000)).map((h) => h.id)).toEqual(['r1']);
    expect((await repo.listHandoffRetryDue(9000)).map((h) => h.id).sort()).toEqual(['r1', 'r2']);
    expect((await repo.listHandoffFailed()).map((h) => h.id)).toEqual(['f1']);
  });

  it('expire transitions rows past TTL and coarsens their precise location', async () => {
    const now = 5000;
    await repo.insert(hazard({ id: 'live', clientId: 'l', status: 'approved', expiresAt: now + 1 }));
    await repo.insert(
      hazard({
        id: 'dead',
        clientId: 'd',
        status: 'approved',
        expiresAt: now - 1,
        preciseLocation: { lat: 38.5462, lng: -121.7361 },
        publicLocation: { lat: 38.5455, lng: -121.7355 },
      }),
    );
    const n = await repo.expire(now);
    expect(n).toBe(1);
    const dead = (await repo.findById('dead'))!;
    expect(dead.status).toBe('expired');
    expect(dead.preciseLocation).toEqual(dead.publicLocation); // coarsened
    expect((await repo.findById('live'))?.status).toBe('approved');
  });

  it('hard-deletes a hazard by id', async () => {
    await repo.insert(hazard({ id: 'del', clientId: 'del' }));
    expect(await repo.deleteById('del')).toBe(true);
    expect(await repo.findById('del')).toBeUndefined();
    expect(await repo.deleteById('nope')).toBe(false);
  });
});

suite('PostgresModeratorStore', () => {
  let store: ModeratorStore;

  beforeAll(async () => {
    store = await createModeratorStore(URL!);
  });

  beforeEach(async () => {
    await (store as unknown as { pool: { query: (s: string) => Promise<unknown> } }).pool.query(
      'TRUNCATE moderators',
    );
  });

  it('upserts and reads back a moderator; updates the hash on conflict', async () => {
    await store.upsert({ username: 'alice', passwordHash: 'h1', createdAt: 1, tokenVersion: 0 });
    expect((await store.findByUsername('alice'))?.passwordHash).toBe('h1');
    expect(await store.count()).toBe(1);

    await store.upsert({ username: 'alice', passwordHash: 'h2', createdAt: 2, tokenVersion: 0 });
    expect((await store.findByUsername('alice'))?.passwordHash).toBe('h2');
    expect(await store.count()).toBe(1); // upsert, not a duplicate

    expect(await store.findByUsername('ghost')).toBeUndefined();
  });

  it('bumps the token version for session revocation', async () => {
    await store.upsert({ username: 'bob', passwordHash: 'h', createdAt: 1, tokenVersion: 0 });
    expect((await store.findByUsername('bob'))?.tokenVersion).toBe(0);
    expect(await store.bumpTokenVersion('bob')).toBe(1);
    expect((await store.findByUsername('bob'))?.tokenVersion).toBe(1);
  });
});

suite('PostgresSubscriptionStore', () => {
  let store: SubscriptionStore;

  const area: Watch = { kind: 'area', minLat: 38.5, minLng: -121.8, maxLat: 38.6, maxLng: -121.7 };
  const route: Watch = {
    kind: 'route',
    corridorMeters: 40,
    geometry: [
      { lat: 38.5421, lng: -121.7494 },
      { lat: 38.5447, lng: -121.7405 },
    ],
  };

  beforeAll(async () => {
    store = await createSubscriptionStore(URL!);
  });

  beforeEach(async () => {
    await (store as unknown as { pool: { query: (s: string) => Promise<unknown> } }).pool.query(
      'TRUNCATE push_subscriptions',
    );
  });

  it('round-trips a subscription including the watch jsonb and label', async () => {
    const sub = buildSubscription(
      'https://push.example/ep1',
      { p256dh: 'p256', auth: 'authkey' },
      area,
      1234,
      'Commute to campus',
    );
    await store.upsert(sub);
    expect(await store.all()).toEqual([sub]);
  });

  it('re-subscribing the same endpoint replaces, not duplicates', async () => {
    await store.upsert(
      buildSubscription('https://push.example/ep1', { p256dh: 'p1', auth: 'a1' }, area, 1),
    );
    const updated = buildSubscription(
      'https://push.example/ep1',
      { p256dh: 'p2', auth: 'a2' },
      route,
      2,
      'renamed',
    );
    await store.upsert(updated);
    expect(await store.all()).toEqual([updated]); // same endpoint ⇒ replaced
  });

  it('removes by id and reports misses', async () => {
    const sub = buildSubscription('https://push.example/ep2', { p256dh: 'p', auth: 'a' }, area, 1);
    await store.upsert(sub);
    expect(await store.remove(sub.id)).toBe(true);
    expect(await store.all()).toEqual([]);
    expect(await store.remove(sub.id)).toBe(false);
  });
});

/**
 * Memory/Postgres parity for the delta feed (FIX-05).
 *
 * The delta decides what a phone on the 30s poll draws and, through
 * `listRemovedSince`, what it stops drawing. Two hand-written implementations
 * of that predicate — one in TypeScript, one in SQL — agree only by inspection
 * unless something checks. These run the SAME fixture set through both stores
 * and compare the id sets, so a divergence fails rather than reaching riders on
 * whichever store production happens to use.
 */
suite('delta feed: memory/Postgres parity', () => {
  const NOW = 5_000_000;
  const MIN = 60 * 1000;
  const RESOLVED_VISIBLE_MS = 7 * 24 * 60 * 60 * 1000;

  let pg: PostgresRepository;

  /** The same rows in both stores: one of every lifecycle state that matters. */
  const rows: StoredHazard[] = [
    // On the map, changed inside the window.
    hazard({ id: 'live', clientId: 'live', status: 'approved', updatedAt: NOW - MIN, expiresAt: NOW + MIN }),
    // On the map, unchanged since the cursor.
    hazard({ id: 'stale', clientId: 'stale', status: 'approved', updatedAt: NOW - 60 * MIN, expiresAt: NOW + MIN }),
    // Exactly on the cursor boundary.
    hazard({ id: 'boundary', clientId: 'boundary', status: 'approved', updatedAt: NOW - 10 * MIN, expiresAt: NOW + MIN }),
    // Left the map: swept to expired.
    hazard({ id: 'expired', clientId: 'expired', status: 'expired', updatedAt: NOW - MIN, expiresAt: NOW - 2 * MIN }),
    // Left the map: approved but past its TTL, sweep not yet run.
    hazard({ id: 'unswept', clientId: 'unswept', status: 'approved', updatedAt: NOW - 60 * MIN, expiresAt: NOW - MIN }),
    // Left the map: moderator rejection.
    hazard({ id: 'rejected', clientId: 'rejected', status: 'rejected', updatedAt: NOW - MIN, expiresAt: NOW + MIN }),
    // Still shown greyed: inside the resolved-visible window.
    hazard({ id: 'justFixed', clientId: 'justFixed', status: 'resolved', updatedAt: NOW - MIN, resolvedAt: NOW - MIN, expiresAt: NOW + MIN }),
    // Left the map an hour ago: resolved-visible window ran out. Outside the
    // 10-minute cursor below, inside the wide one.
    hazard({ id: 'agedOut', clientId: 'agedOut', status: 'resolved', updatedAt: NOW - RESOLVED_VISIBLE_MS - 60 * MIN, resolvedAt: NOW - RESOLVED_VISIBLE_MS - 60 * MIN, expiresAt: NOW + MIN }),
    // Never public, and must never be named in a removal.
    hazard({ id: 'pending', clientId: 'pending', status: 'pending', updatedAt: NOW - MIN, expiresAt: NOW + MIN }),
  ];

  beforeAll(async () => {
    pg = new PostgresRepository(URL!);
    await pg.init();
  });

  afterAll(async () => {
    await pg.close();
  });

  beforeEach(async () => {
    await pg['pool'].query('TRUNCATE hazards');
    await pg['pool'].query('TRUNCATE hazard_tombstones');
  });

  /** Load the fixtures into a fresh memory store and the live Postgres one. */
  async function bothStores(): Promise<[MemoryRepository, PostgresRepository]> {
    const mem = new MemoryRepository();
    for (const row of rows) {
      await mem.insert(row);
      await pg.insert(row);
    }
    return [mem, pg];
  }

  const ids = (list: StoredHazard[]) => list.map((h) => h.id).sort();
  const sorted = (list: string[]) => [...list].sort();

  it('listUpdatedSince returns the same rows from both stores', async () => {
    const [mem, store] = await bothStores();
    const since = NOW - 10 * MIN;

    const fromMemory = ids(await mem.listUpdatedSince(since, NOW));
    expect(sorted(await store.listUpdatedSince(since, NOW).then(ids))).toEqual(fromMemory);
    // Not vacuous: the cursor really does select a subset.
    expect(fromMemory).toEqual(['boundary', 'justFixed', 'live']);
  });

  it('listUpdatedSince culls by bbox identically in both stores', async () => {
    const [mem, store] = await bothStores();
    const box = { minLat: 38.5, minLng: -121.8, maxLat: 38.6, maxLng: -121.7 };
    const outside = { minLat: 10, minLng: 10, maxLat: 11, maxLng: 11 };
    const since = NOW - 10 * MIN;

    expect(ids(await store.listUpdatedSince(since, NOW, box))).toEqual(
      ids(await mem.listUpdatedSince(since, NOW, box)),
    );
    expect(ids(await store.listUpdatedSince(since, NOW, outside))).toEqual([]);
    expect(ids(await mem.listUpdatedSince(since, NOW, outside))).toEqual([]);
  });

  it('listRemovedSince names the same departures in both stores', async () => {
    const [mem, store] = await bothStores();
    const since = NOW - 10 * MIN;

    const fromMemory = sorted(await mem.listRemovedSince(since, NOW, RESOLVED_VISIBLE_MS));
    expect(sorted(await store.listRemovedSince(since, NOW, RESOLVED_VISIBLE_MS))).toEqual(
      fromMemory,
    );
    // The removal set is the complement of the public feed, not a catch-all:
    // `pending` was never public, `live`/`stale`/`boundary`/`justFixed` still
    // are, and `agedOut` departed before this cursor so it is not re-reported.
    expect(fromMemory).toEqual(['expired', 'rejected', 'unswept']);
  });

  it('listRemovedSince reports a resolved row once its visible window runs out, in both stores', async () => {
    const [mem, store] = await bothStores();
    // A cursor old enough to span the moment `agedOut` left the feed.
    const since = NOW - RESOLVED_VISIBLE_MS - 120 * MIN;

    const fromMemory = sorted(await mem.listRemovedSince(since, NOW, RESOLVED_VISIBLE_MS));
    expect(sorted(await store.listRemovedSince(since, NOW, RESOLVED_VISIBLE_MS))).toEqual(
      fromMemory,
    );
    expect(fromMemory).toContain('agedOut');
    expect(fromMemory).not.toContain('justFixed');
    expect(fromMemory).not.toContain('pending');
  });

  it('deleteById tombstones in Postgres exactly as it does in memory', async () => {
    const [mem, store] = await bothStores();
    const before = Date.now();
    expect(await mem.deleteById('live')).toBe(true);
    expect(await store.deleteById('live')).toBe(true);
    const after = Date.now();

    expect(await store.listTombstones(before)).toEqual(['live']);
    expect(await mem.listTombstones(before)).toEqual(['live']);
    expect(await store.listTombstones(after + 1)).toEqual([]);
    expect(await mem.listTombstones(after + 1)).toEqual([]);
    // A deleted row leaves no content behind in either store.
    expect(await store.findById('live')).toBeUndefined();
    expect(await mem.findById('live')).toBeUndefined();
  });

  it('expire() prunes tombstones past the TTL in both stores', async () => {
    const [mem, store] = await bothStores();
    await mem.deleteById('live');
    await store.deleteById('live');
    // Sweep at a clock far enough ahead that the tombstone is past its TTL.
    const future = Date.now() + TOMBSTONE_TTL_MS + MIN;
    await mem.expire(future);
    await store.expire(future);

    expect(await store.listTombstones(0)).toEqual([]);
    expect(await mem.listTombstones(0)).toEqual([]);
  });
});
