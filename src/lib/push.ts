/**
 * Browser-side Web Push registration for saved-route/area hazard alerts.
 *
 * STATUS: feature-flagged (config.pushEnabled). The server matcher, Postgres
 * subscription store, `web-push` delivery transport, and the service worker's
 * `push`/`notificationclick` handlers (public/push-sw.js) are all in place; the
 * remaining production steps are (1) provisioning a VAPID key pair and (2)
 * surfacing a "Watch this route/area" control in the UI.
 * This module is the client transport — it talks to the real PushManager and
 * our /api/alerts endpoints — and is covered by manual/e2e testing rather than
 * jsdom (jsdom has no Push API), so it is excluded from the unit-coverage gate.
 * Only the pure helpers below are unit-tested.
 */
import type { Watch } from '../../shared/alerts.ts';
import { subscribeAlert, unsubscribeAlert, type PushSubscriptionPayload } from './api.ts';

/** Is the Push API available in this browser + context (HTTPS / localhost)? */
export function isPushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * Decode a base64url VAPID public key into the Uint8Array the PushManager
 * expects as `applicationServerKey`. Pure and unit-tested.
 */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Serialise a browser PushSubscription into our API payload. Pure. */
export function toPayload(sub: PushSubscription): PushSubscriptionPayload {
  const json = sub.toJSON();
  return {
    endpoint: sub.endpoint,
    keys: {
      p256dh: json.keys?.p256dh ?? '',
      auth: json.keys?.auth ?? '',
    },
  };
}

/**
 * Subscribe this device to alerts for a saved watch. Asks permission, registers
 * with the PushManager using the server's VAPID public key, and stores the
 * subscription server-side. Returns the server subscription id.
 */
export async function registerHazardAlert(
  watch: Watch,
  vapidPublicKey: string,
  label?: string,
): Promise<string> {
  if (!isPushSupported()) throw new Error('Push notifications are not supported here.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');

  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
    }));

  const { id } = await subscribeAlert(toPayload(sub), watch, label);
  return id;
}

/** Remove a saved alert by its server id. */
export async function removeHazardAlert(id: string): Promise<void> {
  await unsubscribeAlert(id);
}
