/**
 * Lightweight, privacy-respecting client error reporting.
 *
 * We never collect PII: only the error message, stack, a short context label,
 * and the path (no query string) are sent to the same-origin API, which logs
 * them server-side. Reporting is best-effort and capped per session — telemetry
 * must never break or slow the app, so every failure is swallowed.
 */
import { config } from '../config.ts';

export interface ErrorContext {
  /** Where the error came from, e.g. 'react-error-boundary', 'window.onerror'. */
  source: string;
  /** Optional extra detail (component, handler) — must contain no PII. */
  detail?: string | null;
}

// Bound the blast radius of a tight error loop (e.g. a render error that retries).
const MAX_REPORTS_PER_SESSION = 25;
let reportedCount = 0;

/** Report a client-side error. Logs to the console and beacons the API. */
export function reportError(error: unknown, context: ErrorContext): void {
  // Always surface in the console for local debugging.
  console.error(`[${context.source}]`, error);

  if (reportedCount >= MAX_REPORTS_PER_SESSION) return;
  reportedCount += 1;

  const payload = {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? (error.stack ?? null) : null,
    source: context.source,
    detail: context.detail ?? null,
    // Path only — never the query string — so we leak nothing user-specific.
    path: typeof location !== 'undefined' ? location.pathname : null,
    at: Date.now(),
  };

  try {
    const body = JSON.stringify(payload);
    const url = `${config.apiBase}/client-errors`;
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
    } else if (typeof fetch !== 'undefined') {
      void fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {
        // best-effort
      });
    }
  } catch {
    // Telemetry must never throw.
  }
}

/** Test seam: reset the per-session report counter. */
export function resetTelemetryForTest(): void {
  reportedCount = 0;
}
