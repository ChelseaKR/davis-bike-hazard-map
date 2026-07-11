/**
 * Web Push delivery for saved-route/area alerts.
 *
 * GRACEFUL DEGRADATION + FLAG: real delivery (the `web-push` encrypted-payload
 * transport) is used only when PUSH_ENABLED and both VAPID keys are set; without
 * them this runs in "dry-run": it computes *who* would be notified and with
 * *what* payload, and returns that without sending — so the matching logic is
 * fully testable and turning the feature on is a config step, not a code change.
 * See the README ops section for the production checklist.
 */
import type { AlertSubscription, Watch } from '../../shared/alerts.ts';
import { matchingSubscriptions } from '../../shared/alerts.ts';
import type { Hazard } from '../../shared/types.ts';
import { CATEGORY_LABELS, SEVERITY_LABELS } from '../../shared/types.ts';

export interface PushConfig {
  enabled: boolean;
  vapidPublicKey: string;
  vapidPrivateKey: string;
  subject: string;
}

/** The notification body delivered to a matching subscriber. */
export interface AlertPayload {
  title: string;
  body: string;
  hazardId: string;
  url: string;
  /** Notification tag (severity) so the SW can collapse same-severity alerts. */
  tag: string;
}

export function buildAlertPayload(hazard: Hazard): AlertPayload {
  return {
    title: 'New bike hazard on a saved route',
    body: `${SEVERITY_LABELS[hazard.severity]} ${CATEGORY_LABELS[hazard.category].toLowerCase()} reported near you.`,
    hazardId: hazard.id,
    // Hash deep link resolved by the client shell (src/hooks/useViewState.ts):
    // opening the notification lands focused on the hazard, not the bare map.
    url: `/#/hazard/${encodeURIComponent(hazard.id)}`,
    tag: `hazard-${hazard.severity}`,
  };
}

export interface NotifyResult {
  /** Subscriptions whose watch matched the hazard. */
  matched: number;
  /** How many were actually sent (0 in dry-run). */
  sent: number;
  dryRun: boolean;
  payload: AlertPayload | null;
  /**
   * Ids of subscriptions the push service reported gone (HTTP 404/410) — the
   * caller should prune these via SubscriptionStore.remove.
   */
  dead: string[];
}

/**
 * Notify every subscriber whose saved watch contains the hazard. In dry-run
 * (feature disabled or no VAPID) it returns the match count without sending.
 * Never throws — a failed push must not break moderation.
 */
export async function notifyForHazard(
  hazard: Hazard,
  subscriptions: AlertSubscription[],
  config: PushConfig,
  send: PushSender = noopSender,
): Promise<NotifyResult> {
  const matched = matchingSubscriptions(hazard.location, subscriptions);
  if (matched.length === 0) {
    return { matched: 0, sent: 0, dryRun: !isConfigured(config), payload: null, dead: [] };
  }
  const payload = buildAlertPayload(hazard);
  if (!isConfigured(config)) {
    return { matched: matched.length, sent: 0, dryRun: true, payload, dead: [] };
  }
  let sent = 0;
  const dead: string[] = [];
  for (const sub of matched) {
    try {
      const ok = await send(sub, payload, config);
      if (ok) sent++;
    } catch (err) {
      // A permanently-gone endpoint is surfaced so the caller can prune it;
      // any other failure is best-effort (must not abort the rest).
      if (err instanceof PushSubscriptionGoneError) dead.push(sub.id);
    }
  }
  return { matched: matched.length, sent, dryRun: false, payload, dead };
}

export function isConfigured(config: PushConfig): boolean {
  return config.enabled && !!config.vapidPublicKey && !!config.vapidPrivateKey;
}

/** A pluggable sender so the real `web-push` transport can be injected/tested. */
export type PushSender = (
  sub: AlertSubscription,
  payload: AlertPayload,
  config: PushConfig,
) => Promise<boolean>;

/** Default sender: a stub, used whenever real delivery is not configured. */
const noopSender: PushSender = async () => false;

/**
 * Thrown by a sender when the push service says the subscription no longer
 * exists (HTTP 404/410) — the caller should delete it from the store.
 */
export class PushSubscriptionGoneError extends Error {
  constructor(public readonly statusCode: number) {
    super(`push subscription gone (HTTP ${statusCode})`);
    this.name = 'PushSubscriptionGoneError';
  }
}

/** The slice of the `web-push` API the sender uses (keeps the cast honest). */
type WebPushModule = Pick<typeof import('web-push'), 'setVapidDetails' | 'sendNotification'>;

/**
 * The real transport: encrypted Web Push via the `web-push` package. The module
 * is imported lazily (and VAPID details set once) so servers running dry-run
 * never load it. 404/410 responses become PushSubscriptionGoneError so
 * notifyForHazard can report dead subscriptions for pruning.
 */
export function createWebPushSender(): PushSender {
  let client: Promise<WebPushModule> | null = null;
  return async (sub, payload, config) => {
    client ??= import('web-push').then((mod) => {
      // web-push is CommonJS: under Node ESM its API arrives on `default`.
      const webPush =
        (mod as { default?: WebPushModule }).default ?? (mod as WebPushModule);
      webPush.setVapidDetails(config.subject, config.vapidPublicKey, config.vapidPrivateKey);
      return webPush;
    });
    const webPush = await client;
    try {
      await webPush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        JSON.stringify(payload),
        { TTL: 60 * 60 }, // an hour-stale hazard alert is better dropped than late
      );
      return true;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) throw new PushSubscriptionGoneError(status);
      throw err;
    }
  };
}

/** Re-exported for symmetry with the Postgres subscription store. */
export type { Watch };
