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
import type { AlertLocale, AlertSubscription, Watch } from '../../shared/alerts.ts';
import { DEFAULT_ALERT_LOCALE, matchingSubscriptions } from '../../shared/alerts.ts';
import type { HazardCategory, Hazard, Severity } from '../../shared/types.ts';
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
  /** BCP-47 tag of the copy in this payload, so the client can set `lang`. */
  locale: AlertLocale;
}

/**
 * Localized push copy, keyed by locale. English is the reference; the Spanish
 * strings are machine-drafted and **PENDING NATIVE-SPEAKER REVIEW** (i18n
 * REVIEW-GATE R3 — see docs/I18N.md). Push text lives here rather than in the
 * react-intl catalog because it is rendered server-side (no IntlProvider), so
 * it needs its own tiny, self-contained string table.
 */
interface PushStrings {
  title: string;
  /** Localized label maps so the body reads naturally per locale. */
  severity: Record<Severity, string>;
  category: Record<HazardCategory, string>;
  /** Assemble the body from an (already-localized) severity + category label. */
  body: (severity: string, category: string) => string;
}

const PUSH_STRINGS: Record<AlertLocale, PushStrings> = {
  en: {
    title: 'New bike hazard on a saved route',
    severity: SEVERITY_LABELS,
    category: CATEGORY_LABELS,
    body: (severity, category) => `${severity} ${category.toLowerCase()} reported near you.`,
  },
  // ⚠️ PENDING NATIVE-SPEAKER REVIEW (es) — machine-drafted, do not treat as final.
  es: {
    title: 'Nuevo peligro para ciclistas en una ruta guardada',
    severity: { low: 'Bajo', moderate: 'Moderado', high: 'Alto' },
    category: {
      pothole: 'Bache',
      surface_damage: 'Daño en la superficie',
      glass_debris: 'Vidrios / escombros',
      blocked_lane: 'Carril bici bloqueado',
      poor_visibility: 'Poca visibilidad',
      dangerous_intersection: 'Intersección peligrosa',
      other: 'Otro',
    },
    body: (severity, category) =>
      `Se reportó ${category.toLowerCase()} (gravedad ${severity.toLowerCase()}) cerca de ti.`,
  },
};

/**
 * Build the notification payload for a hazard in a subscriber's locale. Falls
 * back to English for an unknown/legacy locale so a payload is always produced.
 */
export function buildAlertPayload(
  hazard: Hazard,
  locale: AlertLocale = DEFAULT_ALERT_LOCALE,
): AlertPayload {
  const strings = PUSH_STRINGS[locale] ?? PUSH_STRINGS[DEFAULT_ALERT_LOCALE];
  return {
    title: strings.title,
    body: strings.body(strings.severity[hazard.severity], strings.category[hazard.category]),
    hazardId: hazard.id,
    url: '/',
    locale: PUSH_STRINGS[locale] ? locale : DEFAULT_ALERT_LOCALE,
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
  // Representative payload for the result/dry-run: the first matched subscriber's
  // locale (each subscriber is actually sent their own locale's payload below).
  const payload = buildAlertPayload(hazard, matched[0].locale ?? DEFAULT_ALERT_LOCALE);
  if (!isConfigured(config)) {
    return { matched: matched.length, sent: 0, dryRun: true, payload };
  }
  let sent = 0;
  // Build the payload per subscriber locale so each device gets localized copy.
  const byLocale = new Map<AlertLocale, AlertPayload>();
  for (const sub of matched) {
    const locale = sub.locale ?? DEFAULT_ALERT_LOCALE;
    let localized = byLocale.get(locale);
    if (!localized) {
      localized = buildAlertPayload(hazard, locale);
      byLocale.set(locale, localized);
    }
    try {
      const ok = await send(sub, localized, config);
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
