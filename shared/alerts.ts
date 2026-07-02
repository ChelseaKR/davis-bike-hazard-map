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

/**
 * Locales a push subscriber can be notified in. Kept here (framework-free) so
 * the server, the validation schema, and the push payload table all agree on
 * the supported set. Mirrors the client's SUPPORTED_LANGUAGES (src/i18n/config).
 */
export const ALERT_LOCALES = ['en', 'es'] as const;
export type AlertLocale = (typeof ALERT_LOCALES)[number];

/** The site default / reference locale for push text (English fallback). */
export const DEFAULT_ALERT_LOCALE: AlertLocale = 'en';

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
  /**
   * The locale the subscriber wants push text in (negotiated on their device at
   * subscribe time). Absent on legacy records ⇒ the notifier defaults to
   * DEFAULT_ALERT_LOCALE ('en'). See server/lib/pushNotify.ts.
   */
  locale?: AlertLocale;
  createdAt: number;
}

/** Pick the subscriptions whose watch contains a hazard location. */
export function matchingSubscriptions(
  location: GeoPoint,
  subscriptions: AlertSubscription[],
): AlertSubscription[] {
  return subscriptions.filter((s) => hazardMatchesWatch(location, s.watch));
}
