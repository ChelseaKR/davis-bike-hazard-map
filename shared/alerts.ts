/**
 * Saved-route / saved-area alert matching (pure, framework-free).
 *
 * A user can save a WATCH — either a bounding-box area or a route corridor — and
 * be notified when a newly-approved hazard falls inside it. The geometry test
 * here is the testable heart of the feature; the transport (Web Push) lives in
 * server/lib/pushNotify.ts and is feature-flagged (needs VAPID infra).
 */
import type { GeoPoint } from './types.ts';
import { distanceToRouteMeters } from './routing.ts';

export interface AreaWatch {
  kind: 'area';
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

export interface RouteWatch {
  kind: 'route';
  /** Corridor half-width (m): a hazard within this of the line matches. */
  corridorMeters: number;
  /** The saved route polyline (lat/lng). */
  geometry: GeoPoint[];
}

export type Watch = AreaWatch | RouteWatch;

/** Does a (public, fuzzed) hazard location fall inside a saved watch? */
export function hazardMatchesWatch(location: GeoPoint, watch: Watch): boolean {
  if (watch.kind === 'area') {
    return (
      location.lat >= watch.minLat &&
      location.lat <= watch.maxLat &&
      location.lng >= watch.minLng &&
      location.lng <= watch.maxLng
    );
  }
  return distanceToRouteMeters(location, watch.geometry) <= watch.corridorMeters;
}

/** A push subscription paired with the watch it should fire for. */
export interface AlertSubscription {
  /** Stable id (hash of the endpoint) so re-subscribing replaces, not duplicates. */
  id: string;
  /** A standard Web Push subscription (endpoint + keys). */
  endpoint: string;
  keys: { p256dh: string; auth: string };
  watch: Watch;
  /** Optional human label for the saved watch ("Commute to campus"). */
  label?: string;
  createdAt: number;
  /**
   * TTL: the subscription stops matching and is pruned once `now >= expiresAt`.
   * Re-subscribing (same endpoint ⇒ same deterministic id ⇒ upsert replaces)
   * is the renewal path. Privacy control: a saved watch is sensitive location
   * data and must not live in storage unbounded (see docs/audits/privacy-notes.md).
   */
  expiresAt: number;
}

/** Pick the subscriptions whose watch contains a hazard location. */
export function matchingSubscriptions(
  location: GeoPoint,
  subscriptions: AlertSubscription[],
): AlertSubscription[] {
  return subscriptions.filter((s) => hazardMatchesWatch(location, s.watch));
}
