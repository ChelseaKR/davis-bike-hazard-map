/**
 * Storage for saved-area / saved-route push subscriptions.
 *
 * Mirrors the hazard/moderator stores: an in-memory implementation for
 * dev/tests and a Postgres one for production (used automatically when
 * DATABASE_URL is set, so subscriptions survive restarts and are shared
 * across processes).
 */
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import type { AlertSubscription, Watch } from '../../shared/alerts.ts';
import { runMigrations } from './migrate.ts';

/** Deterministic id from the push endpoint, so re-subscribing replaces cleanly. */
export function subscriptionId(endpoint: string): string {
  return createHash('sha1').update(endpoint).digest('hex').slice(0, 16);
}

export interface SubscriptionStore {
  upsert(sub: AlertSubscription): Promise<AlertSubscription>;
  remove(id: string): Promise<boolean>;
  all(): Promise<AlertSubscription[]>;
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
}

/** Row shape for push_subscriptions (created_at BIGINT comes back as string). */
interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  watch: Watch;
  label: string | null;
  created_at: string;
}

function rowToSubscription(r: SubscriptionRow): AlertSubscription {
  return {
    id: r.id,
    endpoint: r.endpoint,
    keys: { p256dh: r.p256dh, auth: r.auth },
    watch: r.watch,
    label: r.label ?? undefined,
    createdAt: Number(r.created_at),
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
    // either column is the same subscription: re-subscribing replaces cleanly.
    await this.pool.query(
      `INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, watch, label, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         endpoint = EXCLUDED.endpoint,
         p256dh   = EXCLUDED.p256dh,
         auth     = EXCLUDED.auth,
         watch    = EXCLUDED.watch,
         label    = EXCLUDED.label,
         created_at = EXCLUDED.created_at`,
      [
        sub.id,
        sub.endpoint,
        sub.keys.p256dh,
        sub.keys.auth,
        JSON.stringify(sub.watch),
        sub.label ?? null,
        sub.createdAt,
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
      'SELECT id, endpoint, p256dh, auth, watch, label, created_at FROM push_subscriptions',
    );
    return res.rows.map(rowToSubscription);
  }
}

/** Build the subscription store matching the hazard store (Postgres in prod). */
export async function createSubscriptionStore(databaseUrl: string): Promise<SubscriptionStore> {
  if (!databaseUrl) return new MemorySubscriptionStore();
  const store = new PostgresSubscriptionStore(new Pool({ connectionString: databaseUrl, max: 2 }));
  await store.init();
  return store;
}

/** Build an AlertSubscription record from a Web Push subscription + a watch. */
export function buildSubscription(
  endpoint: string,
  keys: { p256dh: string; auth: string },
  watch: Watch,
  now: number,
  label?: string,
): AlertSubscription {
  return { id: subscriptionId(endpoint), endpoint, keys, watch, label, createdAt: now };
}
