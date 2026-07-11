/**
 * Storage for saved-area / saved-route push subscriptions.
 *
 * In-memory only for now (the feature ships behind a flag — see config.pushEnabled
 * and docs). A Postgres-backed store mirrors the hazard/moderator stores and is
 * the documented production step; the interface is intentionally tiny so adding
 * it is mechanical.
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
import type { AlertSubscription, Watch } from '../../shared/alerts.ts';
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
