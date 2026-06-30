/**
 * Storage for saved-area / saved-route push subscriptions.
 *
 * In-memory only for now (the feature ships behind a flag — see config.pushEnabled
 * and docs). A Postgres-backed store mirrors the hazard/moderator stores and is
 * the documented production step; the interface is intentionally tiny so adding
 * it is mechanical.
 */
import { createHash } from 'node:crypto';
import type { AlertSubscription, Watch } from '../../shared/alerts.ts';

/** Deterministic id from the push endpoint, so re-subscribing replaces cleanly. */
export function subscriptionId(endpoint: string): string {
  return createHash('sha1').update(endpoint).digest('hex').slice(0, 16);
}

export interface SubscriptionStore {
  upsert(sub: AlertSubscription): Promise<AlertSubscription>;
  remove(id: string): Promise<boolean>;
  all(): Promise<AlertSubscription[]>;
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
