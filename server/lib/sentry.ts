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

export function initSentry(dsn: string, environment: string): void {
  if (!dsn) return;
  Sentry.init({ dsn, environment, tracesSampleRate: 0 });
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
