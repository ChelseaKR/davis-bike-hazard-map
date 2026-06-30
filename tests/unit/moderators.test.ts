/**
 * Moderator store selection + the Postgres adapter's pure data-mapping layer.
 *
 * The integration suite (pgRepository.test.ts) exercises the real SQL against a
 * live Postgres when TEST_DATABASE_URL is set. Here we unit-test the JS the
 * adapter wraps around the driver — snake_case -> camelCase, numeric coercion,
 * and the "row missing" fallbacks — with a fake pool, no database required.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import {
  MemoryModeratorStore,
  PostgresModeratorStore,
  createModeratorStore,
} from '../../server/lib/moderators.ts';

/** A minimal pg Pool whose query() returns a scripted result set. */
function fakePool(rows: unknown[]) {
  const query = vi.fn().mockResolvedValue({ rows });
  return { pool: { query } as unknown as Pool, query };
}

describe('createModeratorStore', () => {
  it('returns the in-memory store when no database URL is configured', async () => {
    const store = await createModeratorStore('');
    expect(store).toBeInstanceOf(MemoryModeratorStore);
    expect(await store.count()).toBe(0);
  });
});

describe('PostgresModeratorStore mapping', () => {
  it('maps a DB row into a Moderator (snake_case + numeric coercion)', async () => {
    const { pool, query } = fakePool([
      { username: 'alice', password_hash: 'h', created_at: '1700', token_version: 2 },
    ]);
    const got = await new PostgresModeratorStore(pool).findByUsername('alice');
    expect(got).toEqual({ username: 'alice', passwordHash: 'h', createdAt: 1700, tokenVersion: 2 });
    // Parameterized — never string-interpolated.
    expect(query).toHaveBeenCalledWith(expect.stringContaining('WHERE username = $1'), ['alice']);
  });

  it('returns undefined when no moderator matches', async () => {
    const { pool } = fakePool([]);
    expect(await new PostgresModeratorStore(pool).findByUsername('ghost')).toBeUndefined();
  });

  it('upsert issues a parameterized insert-on-conflict', async () => {
    const { pool, query } = fakePool([]);
    await new PostgresModeratorStore(pool).upsert({
      username: 'a',
      passwordHash: 'h',
      createdAt: 5,
      tokenVersion: 0,
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO moderators'), [
      'a',
      'h',
      5,
    ]);
  });

  it('bumpTokenVersion returns the new version, or 0 when the row is gone', async () => {
    const present = fakePool([{ token_version: 4 }]);
    expect(await new PostgresModeratorStore(present.pool).bumpTokenVersion('a')).toBe(4);

    const missing = fakePool([]);
    expect(await new PostgresModeratorStore(missing.pool).bumpTokenVersion('a')).toBe(0);
  });

  it('count parses the COUNT(*)::text result, defaulting to 0', async () => {
    expect(await new PostgresModeratorStore(fakePool([{ n: '7' }]).pool).count()).toBe(7);
    expect(await new PostgresModeratorStore(fakePool([]).pool).count()).toBe(0);
  });
});
