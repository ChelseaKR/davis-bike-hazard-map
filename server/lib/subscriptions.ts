/**
 * Storage for saved-area / saved-route push subscriptions.
 *
 * Mirrors the hazard/moderator stores: an in-memory implementation for
 * dev/tests and a Postgres one for production (used automatically when
 * DATABASE_URL is set, so subscriptions survive restarts and are shared
 * across processes).
 *
 * PRIVACY (FIX-10): a saved watch is sensitive location data (a home↔work
 * corridor), so this module applies data minimization AT STORAGE TIME:
 *   - Route geometry is Douglas–Peucker-simplified to ~35 m (half the ~70 m
 *     public fuzz grid) before it is stored — matching is corridor-based, so
 *     GPS-trace precision is never needed.
 *   - Every subscription carries a 180-day TTL. Re-subscribing replaces the
 *     record (deterministic id from the endpoint), which is the renewal path;
 *     `prune()` drops expired records and runs before matching/delivery.
 * Inventory + retention are documented in docs/audits/privacy-notes.md.
 */
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import type { AlertSubscription, Watch } from '../../shared/alerts.ts';
import { runMigrations } from './migrate.ts';
import { simplifyRoute } from '../../shared/simplify.ts';
import { DEFAULT_FUZZ_METERS } from '../../shared/geo.ts';

/** Deterministic id from the push endpoint, so re-subscribing replaces cleanly. */
export function subscriptionId(endpoint: string): string {
  return createHash('sha1').update(endpoint).digest('hex').slice(0, 16);
}

/**
 * Stored-geometry precision for route watches: half the public fuzz grid
 * (~35 m). Deviations this small are invisible to corridor matching (corridors
 * are ≥ tens of metres) but strip the exact-trace precision we must not keep.
 */
export const WATCH_GEOMETRY_TOLERANCE_METERS = DEFAULT_FUZZ_METERS / 2;

/** Subscription time-to-live: 180 days; renewed whenever the user re-subscribes. */
export const SUBSCRIPTION_TTL_MS = 180 * 24 * 60 * 60 * 1000;

export interface SubscriptionStore {
  upsert(sub: AlertSubscription): Promise<AlertSubscription>;
  remove(id: string): Promise<boolean>;
  all(): Promise<AlertSubscription[]>;
  /** Delete expired subscriptions (expiresAt <= now); returns how many went. */
  prune(now: number): Promise<number>;
  init?(): Promise<void>;
}

export class MemorySubscriptionStore implements SubscriptionStore {
  private byId = new Map<string, AlertSubscription>();

  async upsert(sub: AlertSubscription): Promise<AlertSubscription> {
    this.byId.set(sub.id, sub);
    return sub;
  }
  async remove(id: string): Promise<boolean> {
    return this.byId.delete(id);
  }
  async all(): Promise<AlertSubscription[]> {
    return [...this.byId.values()];
  }
  async prune(now: number): Promise<number> {
    let removed = 0;
    for (const [id, sub] of this.byId) {
      if (sub.expiresAt <= now) {
        this.byId.delete(id);
        removed++;
      }
    }
    return removed;
  }
}

/** Row shape for push_subscriptions (BIGINT columns come back as strings). */
interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  watch: Watch;
  label: string | null;
  created_at: string;
  expires_at: string;
}

function rowToSubscription(r: SubscriptionRow): AlertSubscription {
  return {
    id: r.id,
    endpoint: r.endpoint,
    keys: { p256dh: r.p256dh, auth: r.auth },
    watch: r.watch,
    label: r.label ?? undefined,
    createdAt: Number(r.created_at),
    expiresAt: Number(r.expires_at),
  };
}

export class PostgresSubscriptionStore implements SubscriptionStore {
  constructor(private readonly pool: Pool) {}

  async init(): Promise<void> {
    // Idempotent — push_subscriptions lives in the shared migration set.
    await runMigrations(this.pool);
  }

  async upsert(sub: AlertSubscription): Promise<AlertSubscription> {
    // The id is a hash of the endpoint (see subscriptionId), so a conflict on
    // either column is the same subscription: re-subscribing replaces cleanly
    // — including the fresh expires_at, which is the FIX-10 renewal path.
    await this.pool.query(
      `INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, watch, label, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         endpoint = EXCLUDED.endpoint,
         p256dh   = EXCLUDED.p256dh,
         auth     = EXCLUDED.auth,
         watch    = EXCLUDED.watch,
         label    = EXCLUDED.label,
         created_at = EXCLUDED.created_at,
         expires_at = EXCLUDED.expires_at`,
      [
        sub.id,
        sub.endpoint,
        sub.keys.p256dh,
        sub.keys.auth,
        JSON.stringify(sub.watch),
        sub.label ?? null,
        sub.createdAt,
        sub.expiresAt,
      ],
    );
    return sub;
  }

  async remove(id: string): Promise<boolean> {
    const res = await this.pool.query('DELETE FROM push_subscriptions WHERE id = $1', [id]);
    return (res.rowCount ?? 0) > 0;
  }

  async all(): Promise<AlertSubscription[]> {
    const res = await this.pool.query<SubscriptionRow>(
      'SELECT id, endpoint, p256dh, auth, watch, label, created_at, expires_at FROM push_subscriptions',
    );
    return res.rows.map(rowToSubscription);
  }

  async prune(now: number): Promise<number> {
    const res = await this.pool.query('DELETE FROM push_subscriptions WHERE expires_at <= $1', [
      now,
    ]);
    return res.rowCount ?? 0;
  }
}

/** Build the subscription store matching the hazard store (Postgres in prod). */
export async function createSubscriptionStore(databaseUrl: string): Promise<SubscriptionStore> {
  if (!databaseUrl) return new MemorySubscriptionStore();
  const store = new PostgresSubscriptionStore(new Pool({ connectionString: databaseUrl, max: 2 }));
  await store.init();
  return store;
}

/**
 * Build an AlertSubscription record from a Web Push subscription + a watch.
 *
 * Applies the FIX-10 minimization: route geometry is simplified to corridor
 * precision before storage (corridorMeters is kept as given), and the record
 * expires `SUBSCRIPTION_TTL_MS` after `now`. Because the id is deterministic
 * per endpoint, re-subscribing upserts a fresh record — that is TTL renewal.
 */
export function buildSubscription(
  endpoint: string,
  keys: { p256dh: string; auth: string },
  watch: Watch,
  now: number,
  label?: string,
): AlertSubscription {
  const stored: Watch =
    watch.kind === 'route'
      ? { ...watch, geometry: simplifyRoute(watch.geometry, WATCH_GEOMETRY_TOLERANCE_METERS) }
      : watch;
  return {
    id: subscriptionId(endpoint),
    endpoint,
    keys,
    watch: stored,
    label,
    createdAt: now,
    expiresAt: now + SUBSCRIPTION_TTL_MS,
  };
}
