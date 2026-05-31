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
  tileAttribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',

  /** Max edge length we downscale uploaded photos to (keeps mobile uploads small). */
  maxPhotoEdge: 1280,
  /** JPEG quality used when re-encoding photos after blur. */
  photoQuality: 0.82,

  /** How often the sync loop retries the queue while online, in ms. */
  syncIntervalMs: 30_000,
} as const;
