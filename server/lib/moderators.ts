/**
 * Moderator accounts.
 *
 * Only moderators have accounts — reporters never do (the no-reporter-accounts
 * privacy stance is unchanged). The store mirrors the hazard repository: an
 * in-memory implementation for dev/tests and a Postgres one for production.
 */
import { Pool } from 'pg';
import { hashPassword } from './password.ts';
import { runMigrations } from './migrate.ts';

/**
 * A fixed, valid hash of a value no one will ever use. Verify a submitted
 * password against THIS when the username is unknown, so a login attempt takes
 * the same time whether or not the account exists (anti-enumeration).
 */
export const DUMMY_PASSWORD_HASH =
  'scrypt$wRGbEqj0TZo6a3MoOpNdTg==$fKE+5yczFefoexO+ILwwTW7lfKbtPVzhjUHaXCr6Zzc=';

export interface Moderator {
  username: string;
  passwordHash: string;
  createdAt: number;
  /** Bumped to revoke all of this moderator's outstanding sessions. */
  tokenVersion: number;
}

export interface ModeratorStore {
  findByUsername(username: string): Promise<Moderator | undefined>;
  upsert(moderator: Moderator): Promise<void>;
  /** Invalidate all existing sessions for a moderator; returns the new version. */
  bumpTokenVersion(username: string): Promise<number>;
  count(): Promise<number>;
  init?(): Promise<void>;
}

export class MemoryModeratorStore implements ModeratorStore {
  private byName = new Map<string, Moderator>();

  async findByUsername(username: string): Promise<Moderator | undefined> {
    return this.byName.get(username);
  }
  async upsert(moderator: Moderator): Promise<void> {
    // Preserve an existing token version on re-seed (don't reset to 0).
    const existing = this.byName.get(moderator.username);
    this.byName.set(moderator.username, {
      ...moderator,
      tokenVersion: existing?.tokenVersion ?? moderator.tokenVersion ?? 0,
    });
  }
  async bumpTokenVersion(username: string): Promise<number> {
    const existing = this.byName.get(username);
    if (!existing) return 0;
    const next = existing.tokenVersion + 1;
    this.byName.set(username, { ...existing, tokenVersion: next });
    return next;
  }
  async count(): Promise<number> {
    return this.byName.size;
  }
}

export class PostgresModeratorStore implements ModeratorStore {
  constructor(private readonly pool: Pool) {}

  async init(): Promise<void> {
    // Idempotent — the moderators table lives in the shared migration set.
    await runMigrations(this.pool);
  }

  async findByUsername(username: string): Promise<Moderator | undefined> {
    const res = await this.pool.query<{
      username: string;
      password_hash: string;
      created_at: string;
      token_version: number;
    }>(
      'SELECT username, password_hash, created_at, token_version FROM moderators WHERE username = $1',
      [username],
    );
    const row = res.rows[0];
    return row
      ? {
          username: row.username,
          passwordHash: row.password_hash,
          createdAt: Number(row.created_at),
          tokenVersion: row.token_version,
        }
      : undefined;
  }

  async upsert(m: Moderator): Promise<void> {
    // token_version is intentionally not reset on re-seed.
    await this.pool.query(
      `INSERT INTO moderators (username, password_hash, created_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [m.username, m.passwordHash, m.createdAt],
    );
  }

  async bumpTokenVersion(username: string): Promise<number> {
    const res = await this.pool.query<{ token_version: number }>(
      `UPDATE moderators SET token_version = token_version + 1
       WHERE username = $1 RETURNING token_version`,
      [username],
    );
    return res.rows[0]?.token_version ?? 0;
  }

  async count(): Promise<number> {
    const res = await this.pool.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM moderators');
    return Number(res.rows[0]?.n ?? 0);
  }
}

/**
 * Ensure a bootstrap moderator exists. Idempotent: creates the account from
 * env credentials on first boot, then leaves it alone. Returns the username if
 * one was created, else null. Without credentials configured it is a no-op.
 */
export async function bootstrapModerator(
  store: ModeratorStore,
  username: string | undefined,
  password: string | undefined,
  now: number,
): Promise<string | null> {
  if (!username || !password) return null;
  if (await store.findByUsername(username)) return null;
  await store.upsert({
    username,
    passwordHash: await hashPassword(password),
    createdAt: now,
    tokenVersion: 0,
  });
  return username;
}

/** Build the moderator store matching the hazard store (Postgres in prod). */
export async function createModeratorStore(databaseUrl: string): Promise<ModeratorStore> {
  if (!databaseUrl) return new MemoryModeratorStore();
  const store = new PostgresModeratorStore(new Pool({ connectionString: databaseUrl, max: 2 }));
  await store.init();
  return store;
}
