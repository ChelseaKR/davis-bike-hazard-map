/**
 * Integration tests for the Postgres store. They run only when
 * TEST_DATABASE_URL points at a reachable Postgres (CI provides one via the
 * docker-compose service); otherwise the suite is skipped so unit runs without
 * a database stay green.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgresRepository } from '../../server/lib/pgRepository.ts';
import { createModeratorStore, type ModeratorStore } from '../../server/lib/moderators.ts';
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
    moderation: [],
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
