/**
 * Web Push delivery for saved-route/area alerts.
 *
 * GRACEFUL DEGRADATION + FLAG: actual Web Push requires VAPID keys and the
 * encrypted-payload protocol (the `web-push` package). Until those are
 * provisioned this runs in "dry-run": it computes *who* would be notified and
 * with *what* payload, and returns that without sending — so the matching logic
 * is fully testable and wired in, and turning the feature on is a config +
 * dependency step, not a code rewrite. See docs for the production checklist.
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
}

export function buildAlertPayload(hazard: Hazard): AlertPayload {
  return {
    title: 'New bike hazard on a saved route',
    body: `${SEVERITY_LABELS[hazard.severity]} ${CATEGORY_LABELS[hazard.category].toLowerCase()} reported near you.`,
    hazardId: hazard.id,
    url: '/',
  };
}

export interface NotifyResult {
  /** Subscriptions whose watch matched the hazard. */
  matched: number;
  /** How many were actually sent (0 in dry-run). */
  sent: number;
  dryRun: boolean;
  payload: AlertPayload | null;
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
    return { matched: 0, sent: 0, dryRun: !isConfigured(config), payload: null };
  }
  const payload = buildAlertPayload(hazard);
  if (!isConfigured(config)) {
    return { matched: matched.length, sent: 0, dryRun: true, payload };
  }
  let sent = 0;
  for (const sub of matched) {
    try {
      const ok = await send(sub, payload, config);
      if (ok) sent++;
    } catch {
      // Best-effort: a dead subscription shouldn't abort the rest.
    }
  }
  return { matched: matched.length, sent, dryRun: false, payload };
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

/** Default sender: a stub. Wire `web-push` here once VAPID keys exist. */
const noopSender: PushSender = async () => false;

/** Re-exported for symmetry / future Postgres wiring. */
export type { Watch };
