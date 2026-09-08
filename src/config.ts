/**
 * Client runtime configuration.
 *
 * Values come from Vite env vars at build time (`VITE_*`) with safe defaults so
 * the app runs out of the box. No secrets live here — the client is public.
 */

export const config = {
  /** Base path for the API. Same-origin by default (server serves the SPA). */
  apiBase: import.meta.env.VITE_API_BASE ?? '/api',

  /** OpenStreetMap tile template. Free, no API key — cost guardrail. */
  tileUrl:
    import.meta.env.VITE_TILE_URL ??
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  // The tile provider's required attribution markup: "OpenStreetMap" is a
  // proper noun and the wording is the licence's own, carried verbatim into
  // Leaflet's attribution control.
  tileAttribution:
    // i18n-exempt: licence attribution markup, not translated copy.
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',

  /** Max edge length we downscale uploaded photos to (keeps mobile uploads small). */
  maxPhotoEdge: 1280,
  /** JPEG quality used when re-encoding photos after blur. */
  photoQuality: 0.82,

  /** How often the sync loop retries the queue while online, in ms. */
  syncIntervalMs: 30_000,

  /**
   * Public read-only dashboard mode. When `VITE_PUBLIC_DASHBOARD=true` the app
   * shows only the read-only views (map, list, coverage, route) and hides the
   * report/my-reports/moderation tabs — the graduation of the private beta into
   * a public hazard map.
   */
  publicDashboard: import.meta.env.VITE_PUBLIC_DASHBOARD === 'true',

  /**
   * Web-push alerts for saved areas. Off by default — turning it on requires
   * VAPID keys + a push service worker handler (see docs). When false the
   * saved-area UI and subscription calls are not rendered, so the PWA's offline
   * behaviour is unaffected.
   */
  pushEnabled: import.meta.env.VITE_PUSH_ENABLED === 'true',
} as const;
