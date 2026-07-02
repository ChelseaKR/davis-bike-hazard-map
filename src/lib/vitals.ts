/**
 * Cookieless Core Web Vitals real-user monitoring (RUM).
 *
 * Reports field CLS, INP and LCP to the same-origin API. No cookies, no IPs,
 * no identifiers — the payload is only the metric name, value, rating and the
 * path (never the query string). Best-effort: every failure is swallowed so
 * telemetry can never break or slow the page.
 *
 * Mirrors the portfolio reference implementation (personal-site
 * src/lib/vitals.ts) per OBSERVABILITY-STANDARD section 8.
 */
import { onCLS, onINP, onLCP, type Metric } from 'web-vitals';
import { config } from '../config.ts';

/** Start Core Web Vitals reporting. Safe to call once at startup. */
export function reportWebVitals(): void {
  const send = (metric: Metric) => {
    const body = JSON.stringify({
      type: 'vital',
      name: metric.name,
      value: Math.round(metric.value * 1000) / 1000,
      rating: metric.rating,
      // Path only — never the query string — so we leak nothing user-specific.
      path: typeof location !== 'undefined' ? location.pathname : '/',
    });
    try {
      const url = `${config.apiBase}/metrics/web-vitals`;
      if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
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
  };
  onCLS(send);
  onINP(send);
  onLCP(send);
}
