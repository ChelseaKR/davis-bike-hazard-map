/**
 * Server-side error reporting (Sentry).
 *
 * Deliberately server-only: the PWA stays lean on mobile data by beaconing
 * client errors to /api/client-errors (no client SDK in the bundle), and the
 * server forwards those to Sentry alongside its own. A no-op until SENTRY_DSN
 * is set, so dev/test never phone home.
 */
import * as Sentry from '@sentry/node';

let enabled = false;

/**
 * Initialise Sentry (no-op without a DSN).
 *
 * `tracesSampleRate` is non-zero by default so performance traces flow
 * (OBSERVABILITY-STANDARD flags a `0` rate); callers pass the env-configured
 * value. `sendDefaultPii` stays `false` so Sentry never auto-attaches request
 * headers, cookies, or user IP — our privacy invariant extends to error reports.
 */
export function initSentry(dsn: string, environment: string, tracesSampleRate = 0.1): void {
  if (!dsn) return;
  Sentry.init({ dsn, environment, tracesSampleRate, sendDefaultPii: false });
  enabled = true;
}

/** Capture a server-side exception (no-op when Sentry is disabled). */
export function captureError(err: unknown, context?: Record<string, unknown>): void {
  if (!enabled) return;
  Sentry.captureException(err, context ? { extra: context } : undefined);
}

/** Capture a client-reported error forwarded from /api/client-errors. */
export function captureClientError(report: Record<string, unknown>): void {
  if (!enabled) return;
  Sentry.captureMessage(`client: ${String(report.message ?? 'error')}`, {
    level: 'error',
    extra: report,
    tags: { origin: 'client', source: String(report.source ?? 'unknown') },
  });
}
